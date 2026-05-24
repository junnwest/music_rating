# sillajuku

Every record you've loved — rated, cataloged, and remembered. A music platform for listeners with taste.

**Stack:** Next.js 14 (App Router) · React Native (Expo SDK 54) · Supabase (auth + database) · Spotify API · Tailwind CSS

**Monorepo:** `apps/web` (Next.js) · `apps/mobile` (Expo) · `packages/shared` (TypeScript types)

---

## ⚠️ Current state (2026-05-24)

The 2026-05-22 Spotify-quota hardening (Upstash Redis caches, DB-only homepage/personalized/recommendations) is live and verified. The 2026-05-23 session added 404-resilience fixes. The 2026-05-24 morning session closed the last user-visible failure path: **search now degrades to a DB-backed fallback when Spotify is rate-limited**. The 2026-05-24 evening session began building an **iTunes-first multi-source catalog** to reduce Spotify dependency structurally (not just at runtime). See the [debugging section](#-debugging-spotify-related-production-issues) below for Spotify issues.

### Genre backfill — three-tier pipeline (in progress, partially running)

5,318 releases in the DB; only ~329 (6%) had genre data as of session start. The strategy — in order of priority:

| Tier | Script | Status |
|------|--------|--------|
| 1 — iTunes | `npm run backfill:genres` | **Running on this machine as of session end.** ~24 min remaining when session closed (2,550/~4,989 processed). State saved every 50 records to `apps/web/scripts/backfill-genres-itunes-state.json`. Re-run the same command to resume if interrupted. |
| 2 — Last.fm | `npm run backfill:genres:lastfm` | Script built but **not started yet**. Run only after Tier 1 finishes. Requires `LASTFM_API_KEY` in `.env.local`. |
| 3 — Hand-curated overrides | `npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts` | Dry-run passed (86 rows ready). **Not yet applied to DB.** Run after Tier 2. |

**⚠️ Run these in order. Do not run Tier 2 or 3 until Tier 1 finishes.** Tier 2 queries the same `genres IS NULL` rows; running it while Tier 1 is still working causes wasted API calls.

### iTunes catalog ingest — partial run, needs reset + resume

A new script (`apps/web/scripts/ingest-itunes.ts`) ingests full discographies for 126 curated Korean artists directly from iTunes (no Spotify, no rate limits). **Current state is messy** — read carefully before resuming:

- **Artists 1–80**: Ran before the DB schema migration was applied (the `itunes_id` column didn't exist yet), so all inserts failed silently. These artists appear in the state file as "done" but contributed **0 records** to the DB. **Must be reset and re-run.**
- **Artists 81–95**: Ran after schema was fixed; inserts succeeded normally.
- **Artists 96–126**: Hit iTunes 429 → 403 (IP block) at artist 96 (Nafla). State file shows these as unprocessed. Wait for IP block to lift (usually 30–60 min), then run `npm run itunes:seed` — it resumes from where it left off.

**To reset and re-run artists 1–80:**
```bash
cd apps/web
# Delete the state file to start fresh (artists 81–95 will re-run but upsert safely — no data loss)
rm scripts/itunes-state.json
npm run itunes:seed
```

Alternatively: edit `itunes-state.json` and remove only the first 80 artist IDs from `processedIds` (more surgical but tedious).

### Scripts impact from Spotify deprecations
- ❌ `npm run backfill:genres` **now points to the iTunes script** (renamed from old Spotify-based script). Old Spotify backfill is dead — `backfill-genres.ts` still exists but don't use it.
- ❌ `npm run expand:related` — broken (Spotify deprecated `/artists/{id}/related-artists` in late 2024). Don't run.
- ✅ `npm run expand:discography` — still works (60 artists/day, fetches via `/artists/{id}/albums`)
- ✅ `npm run expand:genre` — still works (uses `/search?q=genre:"..."`)
- ✅ `npm run itunes:seed` — new; builds catalog from iTunes for 126 curated Korean artists

### New environment variables (check both devices)
`LASTFM_API_KEY` was added to `.env.local` on this machine. **Copy it to the other device before running any Last.fm scripts there.** Full list of all required vars is in `apps/web/.env.example`.

### Verified during 404 hardening (no separate verification step required)
- Upstash Redis is receiving cache writes (`spotify:album:*`, `search:albums:*`, `spotify:rate-limited-until`)
- Dev server restarts no longer cost Spotify calls (caches persist across restarts)

---

## 🔧 Debugging Spotify-related production issues

**If you see any of these symptoms in prod, this is almost always Spotify rate-limiting:**

- `/api/search` returns 500 or empty results
- Album pages show "Spotify returned null" in Vercel logs
- Search UI shows the amber "Showing cached results" banner
- Recommendations / explore feels suddenly thinner than usual

### Step 1 — Confirm it's the circuit breaker

```bash
curl -s "https://www.sillajuku.com/api/search?query=test&type=releases"
```

If the response is `{"error":"Spotify circuit breaker open: Xs remaining", ...}` OR returns `{ releases: [...], degraded: true }`, then a Spotify 429 has tripped the breaker in Redis. Confirm by checking Upstash → key `spotify:rate-limited-until` (its value is the UTC timestamp in ms when the breaker auto-clears).

### Step 2 — Find what tripped it (THIS IS THE PART PEOPLE FORGET)

**Check Vercel logs** for the path that actually got the 429. Grep filters worth knowing:

| Log filter | What it tells you |
|------------|-------------------|
| `[spotify] 429 path=` | The exact Spotify endpoint that tripped the breaker (web server side). Added 2026-05-24. |
| `[scriptCircuit] published 429 from` | A local script tripped the breaker (not real user traffic). Names the script. |
| `Spotify circuit breaker open` | Symptom, not cause — these are calls that *got blocked by* the breaker after it was already tripped. Look earlier. |
| `[search] Spotify ... failed, falling back to DB` | Search degraded to DB fallback. Symptom. |

If the **Vercel free tier** is hiding old logs, just wait for the next 429 — instrumentation now logs the path live, so the next incident is self-diagnosing.

### Step 3 — Common root causes

1. **A script bypassing the web server** — `backfill-genres`, `expand-catalog`, `ingest-music`, `seed-prestige`, `seed-rankings` all use the same Spotify credentials. As of 2026-05-24 they refuse to start when the breaker is open and publish their own 429s to the same Redis key, but check the script logs.
2. **Cold-cache traffic burst** — server restart wipes the in-memory token cache and a surge of recommendation grid loads can burn quota fast. The Upstash Redis cache (added 2026-05-22) reduces this risk significantly.
3. **A long-running personalized/recommendations call** — heavy fan-out to many Spotify endpoints from a single page load.

### Step 4 — Recovery options

- **Wait it out** — the breaker TTL matches Spotify's `Retry-After`, so it auto-clears. Production already degrades gracefully (search → DB fallback, albums → basic-row fallback, banner shown to users).
- **Manually clear** — `DEL spotify:rate-limited-until` in Upstash. Only useful if you believe the breaker tripped on a transient blip — if Spotify is genuinely in cooldown, the next API call just re-trips it.
- **Do NOT run scripts during a cooldown** — they now refuse to start, but if you bypass that check you'll prolong the outage.

---

## Local development

### Web

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `apps/web/.env.local` (copy from `.env.example` then fill in values):
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   SPOTIFY_CLIENT_ID=
   SPOTIFY_CLIENT_SECRET=
   SEED_SECRET=pick-any-random-string
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   LASTFM_API_KEY=           # needed for backfill:genres:lastfm
   ```
   ⚠️ **Two-device reminder:** if you add a new env var on one machine, copy it to the other manually. `.env.local` is gitignored and never synced.

3. Run the dev server:
   ```bash
   npm run dev:web
   ```

### Mobile (React Native / Expo)

1. Install dependencies:
   ```bash
   cd apps/mobile && npm install
   ```

2. Create `apps/mobile/.env` (copy from `.env.example`):
   ```
   EXPO_PUBLIC_SUPABASE_URL=
   EXPO_PUBLIC_SUPABASE_ANON_KEY=
   # URL of the deployed web app — used to proxy Spotify search and OAuth redirects
   EXPO_PUBLIC_API_URL=https://sillajuku.com
   ```

3. Start Expo:
   ```bash
   cd apps/mobile && npx expo start
   ```
   Scan the QR code with the **Expo Go** app on your iPhone (requires Expo Go SDK 54).

---

## Supabase setup

Schema is managed via **Supabase CLI migrations** — no manual SQL editor needed.

### Install the CLI (Windows)

Download the binary from GitHub releases and add to PATH:
```
https://github.com/supabase/cli/releases/latest → supabase_windows_amd64.tar.gz
```
Extract `supabase.exe` to a folder and add that folder to your system PATH.

### First-time setup (one time only)

```bash
supabase login
supabase link --project-ref mmbptchpetwdievhrdsj
supabase db push
```

`db push` runs every file in `supabase/migrations/` in order.

### Adding a new schema change

```bash
supabase migration new <short_description>
# edit the generated file in supabase/migrations/
supabase db push
```

---

## Deployment checklist

### Before going live

- [x] Set all environment variables in Vercel
- [x] Run all migrations (`supabase db push`) — all 13 tables + RLS policies applied
- [x] Add jurisdiction to Terms of Service (Republic of Korea)
- [x] Enable Google OAuth in Supabase Auth dashboard
- [x] Enable Spotify OAuth in Supabase Auth dashboard
- [x] Replace contact emails in privacy/terms pages → `admin@sillajuku.com`
- [x] Add `sillajuku://auth/callback` to **Supabase → Authentication → URL Configuration → Redirect URLs** (required for mobile OAuth)
- [ ] Enable Supabase Auth email confirmations if desired (Auth → Email Templates)

### After first deployment

- [ ] **Seed the ranking categories** (6 curated categories):
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-rankings \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```
- [ ] **Seed the homepage genre rows:**
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-curated \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```
- [ ] **Seed default ranking votes** — fill in `scripts/seed-votes.ts` with albums, then run:
  ```bash
  SEED_SECRET=your-secret NEXT_PUBLIC_SITE_URL=https://your-domain.com npx ts-node scripts/seed-votes.ts
  ```

### After launch (once real users are voting)

- [ ] **Remove or reduce seed votes** — once real votes overtake seeds:
  ```bash
  curl -X DELETE https://your-domain.com/api/admin/seed-votes \
    -H "x-seed-secret: YOUR_SEED_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}'
  ```
- [ ] **Revisit FilterBuilder genre map** — update `genresByCountry` in `components/FilterBuilder.tsx` based on real usage data.
- [ ] **Re-curate ranking categories** — add year-specific categories via `app/api/admin/seed-rankings/route.ts`.

---

## gstack skills

gstack is installed at `~/.claude/skills/gstack`. Skills are available as slash commands in Claude Code.

| Stage | Skill | When to use |
|---|---|---|
| Planning | `/office-hours` | Before writing any code — 6 forcing questions |
| | `/plan-eng-review` | Lock in architecture, data flow, edge cases |
| | `/autoplan` | Runs CEO → design → eng review in one shot |
| Building | `/review` | Pre-merge code review |
| | `/investigate` | Stuck on a bug — systematic root-cause process |
| UI / design | `/design-review` | Audit live UI, rate dimensions, fix AI slop |
| | `/design-shotgun` | Generate 4–6 design variants, compare, iterate |
| QA | `/qa` | Real browser — clicks through flows, finds bugs, commits fixes |
| | `/qa-only` | Same as `/qa` but report-only, no code changes |
| Security | `/cso` | OWASP Top 10 + STRIDE — run before any auth feature ships |
| Shipping | `/ship` | Sync main, run tests, push, open PR |
| | `/land-and-deploy` | Merge PR, wait for CI + deploy, verify production |
| Post-deploy | `/canary` | Watch for console errors, perf regressions |
| Debugging | `/browse` | Give Claude a real browser |

---

## Pre-launch roadmap

Target: **mid-June 2026** (earlier the better).

### Data collection

| Phase | What it does | Status |
|-------|-------------|--------|
| Phase 1 — seed catalog | 315 curated Korean/Japanese/Western classics | ✓ done (306/315) |
| RS500 baseline | Rolling Stone 500 seeds "all-time" ranking | ✓ done (481 seeded) |
| Phase 2 — discography expansion | All albums from every artist in DB | in progress (76/331 artists) |
| Phase 3 — related artists | One hop from seeded artists | ❌ blocked — Spotify deprecated `/artists/{id}/related-artists` in late 2024 |
| Phase 4 — genre sweeps | 12 genre tags with popularity threshold | available; not yet started |

Phase 1 + RS500 is the hard requirement for launch — both done. Phase 2 still works and is the main lever for catalog growth pre-launch. Phase 3 is dead until rewritten against another data source (Last.fm `artist.getSimilar`). Phase 4 still works.

```bash
npm run expand:discography   # run once per day (~60 artists/batch) — WORKS
npm run expand:genre         # genre-tag sweep, adds tagged albums — WORKS
# npm run expand:related     # BROKEN — Spotify endpoint deprecated. Don't run.
```

---

### Week 4 — May 31–Jun 6: remaining

- [ ] **Rate limiting** — `/api/check-username`, `/api/rankings/vote`, `/api/follow` via `@upstash/ratelimit` + Upstash Redis
- [ ] **Per-user rate limit on `/api/search`** — added to scope on 2026-05-23 after the search-route audit; caps abuse and protects Spotify quota under burst load
- [ ] **DB-FTS-first search rewrite** — `/api/search` currently calls Spotify on every uncached query; the GIN FTS index from migration `20260517000000_indexes_and_fts.sql` is built but unused. Rewrite the route to query Postgres FTS first and only fall through to Spotify when DB returns < N results. Self-healing via existing `saveBasicReleases` writeback. (2026-05-24: partial progress — DB fallback now exists for the rate-limited path via `searchReleasesInDb` / `searchArtistsInDb` with pg_trgm indexes, but the happy path still calls Spotify first.)
- [ ] **Upstash Redis caching** — ranking leaderboards, album avg rating + count, homepage genre rows; invalidate on write
- [ ] **Apply 88-album genre overrides** — `apps/web/scripts/genre-overrides.json` is ready; run `npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts` from `apps/web`. ~10 seconds.
- [ ] Korean translation (i18n setup with next-intl; language toggle in settings)
- [x] **404 hardening + Spotify circuit breaker** (2026-05-23) — `/api/search` persists results to `releases`; `lib/spotify.ts` has a Redis circuit breaker that short-circuits all Spotify calls during a 429 window
- [x] **Search graceful degradation + script breaker cooperation + 429 instrumentation** (2026-05-24) — `/api/search` returns DB results with `degraded: true` instead of 500 when Spotify is rate-limited; degraded banner in search UI; `lib/spotify.ts` logs `[spotify] 429 path=...` for log-grep diagnosis; all 5 scripts read+publish the shared circuit breaker key via `scripts/spotify-circuit.ts`; debugging runbook in this README
- [x] **React Native app** (Expo SDK 54) — core screens built (see Mobile App Status below)
- [ ] EAS build + App Store (iOS) + Play Store (Android) submission
  - ⚠️ Apple review takes 1–2 weeks — submit by Jun 1 to hit mid-June

### Week 5 — Jun 7–14: QA + production deploy

- [ ] Create dummy/test account and QA all social flows end-to-end
- [ ] Production deployment (custom domain, all env vars set, migrations pushed)
- [ ] Seed all ranking categories with baseline data
- [ ] **Fix N+1 queries in `/api/reviews/route.ts`** — batch author profile + likes fetches
- [ ] **Replace `releases(*)` wildcard in `ProfilePanel.tsx`** — specify only `id, title, artist, cover_url`
- [ ] **Add env var validation at startup** — fail fast if `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing (e.g. `instrumentation.ts`)
- [ ] **Add `router` to useEffect deps in `AuthForm.tsx`**
- [ ] **Add error UI to `PersonalizedFeed.tsx`** — fallback state if recommendations fetch fails
- [ ] **Standardize API error response shape** — consistent `{ ok: true }` / `{ error: '...' }` across all routes
- [ ] **Replace silent `catch {}` blocks with `console.error`**
- [ ] **Collect country on onboarding** — add a country field to the onboarding flow (one migration + one step); cannot be backfilled retroactively; needed for demographic data in label/investor pitches
- [ ] Final bug fixes + buffer for App Store review delays

### Post-launch

- [ ] **사업자등록 (개인사업자)** — register on 홈택스 (hometax.go.kr); free, ~1-2 days approval; unlocks Kakao 비즈 앱
- [ ] **KakaoTalk login** — after 사업자등록: convert Kakao app to 비즈 앱, enable `account_email` in 동의항목, set `available: true` in `settings/page.tsx`
- [ ] **US LLC via Stripe Atlas** — once revenue is consistent; ~$500 one-time; needed for App Store/Play Store payouts at scale
- [ ] **Apple login** — requires Apple Developer account ($99/yr); code already stubbed, enable in Supabase dashboard
- [ ] Wrapped page — needs months of user data to be meaningful
- [ ] Remove/reduce seed votes once real community votes overtake the baseline
- [ ] **Typesense for fuzzy search** — typo-tolerant search on top of PostgreSQL; not needed for launch
- [ ] **Insights + History page** — `/profile/[username]/insights`: rating timeline, genre evolution, taste drift. Needs ~1–3 months post-launch data.
- [ ] **Music ingestion script** (`scripts/ingest-music.ts`) — Korean (full), Japanese (curated ~80 artists), Western essentials (~200 artists)

---

### Recommendation algorithm roadmap

Current: genre-based + artist-based pools with random shuffle. Presentation trick, not a real algorithm.

| Stage | Users | Approach |
|---|---|---|
| Now | 0–500 | Genre + artist pools, shuffled |
| Phase 1 | 500–5k | **Item-based collaborative filtering in SQL** — co-rated-highly albums. Computable in Postgres, no ML infra. |
| Phase 2 | 5k+ | **Matrix factorization via `pgvector`** — user and album embeddings, nearest neighbor queries |

Phase 1 trigger: once ~500 users, build the SQL co-rating query and surface on the For You page.

---

## Music catalog ingestion

### iTunes-first pipeline (new as of 2026-05-24)

For Korean artists, prefer iTunes over Spotify — no auth, no rate limits, consistent taxonomy.

```bash
# Seed full discographies for 126 curated Korean artists
npm run itunes:seed
npm run itunes:seed:dry    # dry run — shows what would be inserted

# Expand a single artist by iTunes artist ID
npm run itunes:artist -- <itunesArtistId>
```

State saved to `scripts/itunes-state.json` after every artist. Re-running resumes from where it left off.

**⚠️ See "Current state" section above before running** — artists 1–80 need a state reset due to a schema issue during the first run.

### Spotify-based pipeline (original)

#### Phase 1 — Seed catalog (done: 306/315)

```bash
npm run ingest           # full run
npm run ingest:retry     # re-attempt not-found entries
```

For missing albums, add native-script overrides to `scripts/search-overrides.json`:
```json
"Artist Name|Album Name": { "query": "아티스트 앨범명" }
```

#### Phase 2 — Discography expansion (in progress: 76/331 artists)

```bash
npm run expand:discography
# override batch size:
npx tsx --env-file=.env.local scripts/expand-catalog.ts discography --max-artists=40
```

State saved to `scripts/expand-state.json` after every artist. Quota hit = script exits with exact wait time.

#### Phase 3 — Related artist expansion

```bash
# ❌ BROKEN — Spotify deprecated this endpoint in late 2024. Do not run.
# npm run expand:related
```

#### Phase 4 — Genre sweeps

```bash
npm run expand:genre
```

### Genre backfill pipeline

Run these in order. Each script resumes from its own state file if interrupted.

```bash
# Tier 1: iTunes (no auth, fast — ~50 min for 5k releases at 600ms/req)
npm run backfill:genres           # or --dry-run to preview
# State: scripts/backfill-genres-itunes-state.json

# Tier 2: Last.fm fallback (catches artists not on iTunes — e.g. Korean underground)
# Requires LASTFM_API_KEY in .env.local
npm run backfill:genres:lastfm    # or --dry-run to preview
# State: scripts/backfill-genres-lastfm-state.json

# Tier 3: Hand-curated overrides (88 high-value rows pre-filled)
npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts
# or: ... scripts/apply-genre-overrides.ts --dry-run
```

---

## Mobile app status

### Implemented (Expo Go compatible, no dev build required)

| Screen | Status | Notes |
|--------|--------|-------|
| Home | ✓ | Genre carousels, "See all" → genre browse, search icon auto-focuses |
| Search / Explore | ✓ | 3-column grid, community picks, personalized recs, people search, Spotify fallback |
| Album detail | ✓ | Rating, reviews, tracklist, artist link, inline review modal, "In Rankings" chips |
| Artist page | ✓ | Full discography |
| Genre browse | ✓ | Infinite scroll, paginated |
| Rankings list | ✓ | All categories |
| Rankings leaderboard | ✓ | Silla Score normalized 0–100 |
| Rankings builder | ✓ | Up/down reorder + tie support (`=` button); drag-and-drop requires dev build |
| Activity feed | ✓ | Following / everyone toggle |
| My profile | ✓ | Stats, score distribution, top genres, essentials (pin 6), recent ratings grid (3-col), taste DNA, taste collisions, taste contradictions |
| Friends | ✓ | Search bar, follow/unfollow, follow-back, suggested accounts |
| Login | ✓ | Email, Google OAuth, Spotify OAuth; Kakao + Apple stubbed (coming soon) |
| Onboarding | ✓ | 3-step setup |
| Other user profiles | ✓ | Taste DNA, score distribution, top genres, essentials, recent ratings grid, taste collisions/contradictions |
| Settings | ✓ | Edit display name, username, bio |
| Notifications | ✓ | Mark-all-read |
| Listen Later | ✓ | Basic |

### Still missing vs web

- **Home personalized feed** — static genre carousels only; web shows a dynamic personalized feed
- **Settings** — web has 5 organized tabs (account, preferences, notifications, privacy, danger zone)
- **Notifications** — web has filters + clear all
- **Listen Later** — web has full list management
- **Help page** — searchable FAQ + contact form
- **Privacy & Terms** — legal pages

### Architecture notes (mobile)

- **No native modules** — intentionally avoids packages that require a dev build (no `react-native-reanimated`, no `react-native-gesture-handler`). Drag-and-drop rankings will need EAS build when added.
- **Supabase client** — configured with `AsyncStorage` for session persistence and PKCE OAuth support.
- **Spotify search** — proxied through the web app (`EXPO_PUBLIC_API_URL/api/search`); mobile has no direct Spotify credentials.
- **Recommendation pool** — both web and mobile query the `recommendable_releases` view (albums + EPs only, must have cover art). Change the view definition once to affect both apps.
- **OAuth deep link** — `sillajuku://auth/callback` must be in Supabase Redirect URLs allowlist.
- **FK schema** — all `user_id` columns reference `profiles(id)` (not `auth.users`), making PostgREST joins traversable within the public schema. Cascade chain: `auth.users` → `profiles` → all dependent tables.

---

## Architecture notes

- **DB-first:** Album and artist data cached to DB on first visit — Spotify only called on cache miss. `saveBasicReleases` is now called from `/api/search` AND from the recommendations/personalized routes, so any album returned from Spotify (search or fallback) gets persisted, and future `/album/[id]` loads skip Spotify entirely. Spotify integration is metadata only, not content streaming.
- **Spotify rate limits:** Account-wide client-credentials limit; exceeding it triggers `Retry-After` headers of up to 80+ minutes. Scripts batch at 60 artists/day and exit cleanly on quota hit. Never delete state files mid-run (`scripts/ingest-state.json`, `scripts/expand-state.json`). Restarts no longer cost Spotify calls since the 2026-05-22 Upstash migration.
- **Spotify circuit breaker** (`lib/spotify.ts`, 2026-05-23) — Redis key `spotify:rate-limited-until` stores a timestamp when Spotify returns a 429. While the key is live, all concurrent `spotifyFetch` calls short-circuit immediately via `SpotifyCircuitOpenError` (~30ms Redis ping) instead of each hitting Spotify and waiting up to `MAX_RETRY_WAIT_SEC = 10` seconds. Breaker auto-clears via TTL matching `Retry-After`. 2026-05-24: every fresh 429 also logs `[spotify] 429 path=... retryAfter=...s untilUtc=...` so the offending endpoint is greppable in Vercel logs.
- **Scripts cooperate with the circuit breaker** (`scripts/spotify-circuit.ts`, 2026-05-24) — The five scripts that hit Spotify directly (`backfill-genres`, `expand-catalog`, `ingest-music`, `seed-prestige`, `seed-rankings`) share Spotify credentials with the web server, so a script burst can trigger an account-wide 429 that breaks production. They now (a) refuse to start when the prod breaker is open via `assertSpotifyCircuitClosed()`, and (b) publish their own 429s to the same Redis key via `recordSpotify429(retryAfterSec, source)` so the web app stops hammering Spotify too.
- **Search degrades to DB on Spotify failure** (`/api/search`, 2026-05-24) — when any Spotify call throws (circuit open, 429, network error), the route returns `{ releases | artists, degraded: true }` from `searchReleasesInDb` / `searchArtistsInDb` (ilike against `releases.title` ∪ `releases.artist` and `artists.name`, backed by pg_trgm GIN indexes from migration `20260524000000_search_trigram_indexes.sql`). `AlbumSearchForm` shows an amber banner when `degraded: true`. Tracks return empty array (no local `tracks` table).
- **Spotify endpoint deprecations (late 2024):** `/artists/{id}` no longer returns useful `genres` (mostly `[]`) and `/artists/{id}/related-artists` returns 404. `scripts/backfill-genres.ts` and `expand:related` mode in `scripts/expand-catalog.ts` are therefore dead. Hand-curated overrides for high-value rows: `apps/web/scripts/genre-overrides.json` + `apply-genre-overrides.ts`. Long-tail genre backfill needs a Last.fm rewrite.
- **Album page fallback chain** — `getCachedAlbum` (DB row with tracklist) → `getSpotifyAlbum` (Spotify, retries once, hits circuit breaker first) → `getBasicRelease` (DB row without tracklist; still renders a usable page) → `notFound()`. The basic-row fallback ensures click-through from search never 404s even during Spotify outages.
- **Supabase region:** Seoul. ~180–220ms latency for Western users — acceptable while Korea-focused; address with read replicas at Western expansion.
- **Supabase free tier:** 500MB storage (~100,000 albums). Paid tier ($25/mo) gives 8GB.
- **Service role key** — server-side only for aggregate queries. Never exposed to client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, resets on server restart. Covers artists, albums, artist IDs, album detail, and recommendations.
- **ISR** — artist album pages revalidate every 3600s.
- **Migrations** — all schema changes in `supabase/migrations/`, applied with `supabase db push`.
- **`recommendable_releases` view** — both web and mobile query this view instead of `releases` directly; encodes shared eligibility rules (albums + EPs only, must have `cover_url`). Uses `LOWER(release_type)` comparison — DB stores `'Album'`/`'EP'` with capital first letter. Edit the view migration to change recommendation rules across both apps at once.
- **Singles filtering** — enforced at every layer: `recommendable_releases` view, `include_groups=album,ep,compilation` in Spotify artist-albums API calls, `.not('release_type', 'ilike', 'single')` on all DB queries, and post-fetch `releaseType === 'Single'` guards in route handlers.
- **CSP (`next.config.mjs`)** — includes explicit `wss://*.supabase.co` for Safari (Safari does not automatically allow WebSocket when only `https://` is listed in `connect-src`), `us-assets.i.posthog.com` for PostHog session replay, and `lh3.googleusercontent.com` for Google OAuth avatars.
- **Server Component error handling** — `RecommendationGrid` wraps Supabase queries in try/catch so a transient network failure (common on mobile) falls through to the Spotify fallback instead of bubbling to the error boundary.
- **Next.js route groups** — all pages live under `app/(main)/` or `app/(auth)/`. Never create directories directly under `app/` without a route group — empty ghost directories cause "No default component for parallel route" errors.

## Known issues

- **`notFound()` returns HTTP 200 instead of 404** on `/album/[mbid]` and `/rankings/[slug]`. The `not-found.tsx` body renders correctly (user sees the friendly "Page not found" page); only the HTTP status code is wrong. Reproduced in both dev and prod with Next.js 14.2.35. Truly nonexistent routes (no `page.tsx` at all) return 404 correctly. Other pages with `notFound()` but without cookie reads (`/artist`, `/genre`, `/explore`) also return 404 correctly. Removing `export const revalidate` and adding `export const dynamic = 'force-dynamic'` did not fix it. Affects SEO and analytics, not user-visible UX. Post-launch fix candidates: (a) Next.js 15/16 upgrade with breaking-change migration, (b) refactor album page to defer all cookie-reading code into a child Server Component that mounts only after `notFound()` check.
