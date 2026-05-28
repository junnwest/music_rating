# sillajuku

Every record you've loved — rated, cataloged, and remembered. A music platform for listeners with taste.

**Stack:** Next.js 14 (App Router) · React Native (Expo SDK 54) · Supabase (auth + database) · Spotify API · Tailwind CSS

**Monorepo:** `apps/web` (Next.js) · `apps/mobile` (Expo) · `packages/shared` (TypeScript types)

---

## ⚠️ Current state (2026-05-28)

The 2026-05-22 Spotify-quota hardening is live. 2026-05-23 added 404-resilience and Spotify circuit breaker. 2026-05-24 morning closed the last user-visible failure: **search degrades to DB fallback when Spotify is rate-limited**. 2026-05-24 evening made the structural shift: **Spotify API is no longer used for data collection**. A full non-Spotify catalog pipeline (Wikipedia → iTunes queue → Last.fm similar → miss-driven ingestion) was built and is ready to run. 2026-05-24 night added **multilingual catalog support**: language-agnostic `_native` columns + two-phase backfill pipeline. 2026-05-25 early morning completed **Phase 1 of the native name backfill** (Wikipedia langlinks): ~247 of ~536 artists now have `name_native` set. **iTunes genre backfill (`backfill:genres`) is now complete** — 2,864 releases matched (66%), 1,494 no match. 2026-05-27 completed the **UUID migration**: `releases.id` is now a source-agnostic UUID; `spotify_id` and `itunes_id` are the source-specific lookup columns. iTunes search results are now saved to DB as first-class releases. 2026-05-27 added **multi-signal search**: pg_trgm fuzzy matching, full-text `ts_rank`, popularity signal (`ratings_count` + live trigger), and a scored `search_releases` SQL function. 2026-05-28 added **semantic search**: Jina v3 embeddings (`vector(1024)`), HNSW index, hybrid `search_releases()` RPC — lexical + cosine similarity — 5,359 releases embedded. 2026-05-28 fixed: Apple CDN images (mzstatic.com) added to CSP; artist pages no longer 404 when Spotify is unavailable; iTunes artist IDs removed from search fallback. **`queue:ingest` complete: 4,568 inserted, 251 enriched, 149 skipped, 12 no-match, 0 failed.** 2026-05-28 evening: **album + artist detail pages are now DB-first** — Spotify is only called for genuinely-unknown deep-link IDs, eliminating the per-visitor Spotify cost. 2026-05-28 (later): added **multi-service streaming buttons** (Spotify / YouTube Music / Tidal) on album pages and per-track; **inline star ratings** on Explore cards, ranking leaderboards, and ranking builder suggestions; **individual track ratings** (new `track_ratings` table — migration at `supabase/migrations/20260526000000_track_ratings.sql`, apply via Supabase SQL editor); **My Rankings** dashboard at `/my-rankings` with grid of ranking cards (All, Albums, EPs, Songs, per-genre), clickable to full detail pages, plus "Recommended for You" section. See the [debugging section](#-debugging-spotify-related-production-issues) below for Spotify runtime issues.

### ► START HERE — next session checklist

#### ~~Step 0 — check the genre backfill~~ ✅ Done (2,864 matched, 66% match rate)

#### ~~Step 1 — supplement genres with Last.fm~~ ✅ Done (1,587 enriched)

#### ~~Step 0 — UUID migration~~ ✅ Done (2026-05-27)

`releases.id` is now a UUID. `spotify_id` and `itunes_id` are the source-specific lookup columns. All dependent tables (`ratings`, `reviews`, `rating_history`, `list_items`, `pinned_albums`, `ranking_votes`, `ranking_seed_entries`, `user_ranking_entries`, `curated_releases`) have been migrated. iTunes search results are now saved to DB on every fallback search. **Deploy the current code before running any backfill scripts.**

#### ~~Step 2 — run native name backfill Phase 2 (releases)~~ ✅ Done (2026-05-28)

Phase 1 (artists via Wikipedia) ✅ done — ~247 of ~536 artists have `name_native`. Phase 2 (releases via iTunes local stores) ✅ done — many K-pop/Korean indie releases legitimately have no native-script title on iTunes; those were skipped correctly.

~~Run `fix-native-names.sql` in Supabase SQL editor~~ ✅ Done (2026-05-27) — 13 artist corrections applied (2 Korean, 11 Japanese). Owen native name corrected (오언 → 오왼).

#### ~~Step 3 — ingest the Wikipedia artist queue~~ ✅ Done (2026-05-28)

`queue:ingest` completed: **4,568 releases inserted, 251 enriched, 149 skipped, 12 artists with no iTunes match, 0 failed**. Catalog grew by ~4,800 rows.

Run `fix-native-names-english-stage.sql` in Supabase SQL editor if not already (sets Korean names for IU, IVE, NewJeans, aespa, BLACKPINK, EXO, TWICE, and ~40 more K-pop acts with English-only stage names).

#### Step 3b — backfill the new releases (in progress 2026-05-28 evening)

| Script | Status |
|--------|--------|
| `npm run backfill:genres` | 🔄 running — drains the 1,624 null-genre rows from the new iTunes ingest |
| `npm run backfill:embeddings` | ✅ Done — 3,854 embedded, 0 failed; full catalog total ~9,213 |
| `npm run backfill:native:releases` | ⬜ next — hold until `backfill:genres` finishes (both hit iTunes) |
| `npm run queue:discover` | ⬜ after — adds Last.fm similar artists to the queue, then loop |

`backfill:embeddings` uses Jina (different API) so it runs safely in parallel with the iTunes-based `backfill:genres`. Do **not** start `backfill:native:releases` until `backfill:genres` is done — they'll compete for the same iTunes rate-limit budget.

#### ~~Step 4 — fill missing cover art~~ ✅ Done (2026-05-28)

15 releases filled (all via iTunes). No remaining gaps.

#### ~~Step 5 — semantic search embeddings~~ ✅ Done (2026-05-28)

5,359 in the initial pass + 3,854 in the post-ingest re-run = **9,213 releases embedded** (0 failed). All non-single rows are now in the hybrid `search_releases()` HNSW index. `JINA_API_KEY` must be set in Vercel environment variables for hybrid search to work in production.

---

### Genre pipeline — status as of session end

| Step | Script | Status |
|------|--------|--------|
| iTunes backfill (Tier 1) | `npm run backfill:genres` | ✅ Done — 2,864 matched (66%), 1,494 no match |
| Last.fm fallback (Tier 2) | `npm run backfill:genres:lastfm` | ✅ Done (previous session) |
| Hand-curated overrides (Tier 3) | `apply-genre-overrides.ts` | ✅ Done (68 applied) |
| **Last.fm enrichment (supplementary)** | `npm run enrich:genres:lastfm` | ✅ Done — 1,587 enriched, 137 already covered, 3,716 no Last.fm match |

`enrich:genres:lastfm` merges Last.fm tags with existing iTunes genres (e.g., iTunes wrote "k-pop", Last.fm adds "r&b" → stored "k-pop,r&b"). It runs on all releases, not just null-genre ones.

### Catalog pipeline — completed setup

- ✅ Migration `20260525000000_catalog_ingestion_queue.sql` applied — `artist_ingestion_queue` and `search_misses` tables exist in prod
- ✅ Migration `20260525000002_native_language_columns.sql` applied — `title_native`, `artist_native`, `native_language` on `releases`; `name_native`, `native_language` on `artists`; trigram indexes on all native columns
- ✅ Migration `20260525000003_native_language_constraint.sql` applied — CHECK constraint: `native_language ~ '^[a-z]{2}$'`
- ✅ Wikipedia queue built — **760 artists** queued; `name_native` backfilled onto all rows (2026-05-27 re-run)
- ✅ `normalize-releases.ts` run — 135 dates padded, 3,286 genres lowercased, 0 release_types to fix
- ✅ `backfill:native:artists` (Phase 1) — ~247/536 artists have `name_native`
- ✅ `backfill:native:releases` (Phase 2) — run 2026-05-28; many skipped (English-titled releases on iTunes KR store)
- ✅ `backfill:covers` — run 2026-05-28; 15 releases filled, 0 remaining
- ✅ `queue:ingest` — done 2026-05-28: 4,568 inserted, 251 enriched, 149 skipped, 12 no-match, 0 failed
- ✅ Ghost-row cleanup (2026-05-28) — 13 legacy `releases` rows with `title="Unknown"` AND `artist="Unknown"` deleted; all orphaned (0 ratings/reviews/pins/ranking entries). Source: legacy ingest path no longer present in current code; nothing in the live codebase writes literal `"Unknown"`/`"Unknown"`.
- 🔄 `backfill:genres` — running 2026-05-28 evening (1,624 null-genre rows from new iTunes ingest)
- ✅ `backfill:embeddings` (re-run) — done 2026-05-28 evening: 3,854 embedded, 0 failed; full catalog total ~9,213

### Catalog normalization — done

`normalize-releases.ts` fixed three historical inconsistencies across all 5,421 Spotify-sourced rows:
- Partial `release_date` values (e.g., "2024" → "2024-01-01") — **135 rows fixed**
- Mixed-case `genres` (e.g., "K-Pop" → "k-pop") — **3,286 rows fixed** (lower than dry run because iTunes backfill was running in parallel and pre-fixed some rows)
- Lowercase `release_type` values — **0 found** (already correct)

All new write paths (iTunes queue ingest, vote route) enforce these formats at insert time.

### Spotify API — retired from data collection

Spotify is no longer used to collect catalog data. Every data-collection script and npm command that relied on Spotify is either dead or superseded. The web server still uses Spotify at runtime for search fallback and album detail, protected by the circuit breaker. See the [new catalog pipeline](#catalog-pipeline--non-spotify) below.

### New environment variables (check both devices)
`LASTFM_API_KEY` was added to `.env.local`. **Copy it to the other device before running any Last.fm scripts there.** Full list in `apps/web/.env.example`.

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
| Phase 2 — Wikipedia artist queue | ~759 Korean artists from 19 Wikipedia categories | ✓ done — 759 artists queued (re-run `queue:build` once to backfill `name_native`) |
| Phase 3 — iTunes queue ingest | Full discographies for all queued artists (no auth, no rate limits) | **Not yet run** — `npm run queue:ingest` |
| Phase 4 — Last.fm similar discovery | Finds related artists for everyone in DB | **Not yet run** — `npm run queue:discover` |
| Phase 4b — Native name backfill | Wikipedia langlinks (artists) + iTunes local store (releases) for `name_native`/`title_native` | **Phase 1 ✅ done** (~247/536 artists); Phase 2 pending (run after genre backfill finishes) — `npm run backfill:native:releases` |
| Phase 5 — miss-driven ingestion | `search_misses` table populated on every cache miss; ingest nightly | Logging active, no ingest job yet |
| ~~Phase 3 related~~ | ~~Spotify `/artists/{id}/related-artists`~~ | ❌ Dead — Spotify deprecated this endpoint in late 2024 |
| ~~Discography expansion~~ | ~~Spotify `/artists/{id}/albums`~~ | Superseded by iTunes queue ingest |

**New pipeline run order (loop until queue stable):**
```bash
cd apps/web
npm run queue:build          # re-run once to backfill name_native on existing 759 rows
npm run queue:ingest         # drain queue via iTunes (no auth, no rate limits)
npm run queue:discover       # find similar artists via Last.fm, add to queue
# repeat queue:ingest → queue:discover until queue is empty
npm run backfill:native      # fill native names for existing artists + releases
npm run backfill:covers      # fill any remaining null cover_url (iTunes → Last.fm → MusicBrainz → Spotify)
```

---

### Week 4 — May 31–Jun 6: remaining

- [ ] **Rate limiting** — `/api/check-username`, `/api/rankings/vote`, `/api/follow` via `@upstash/ratelimit` + Upstash Redis
- [ ] **Per-user rate limit on `/api/search`** — added to scope on 2026-05-23 after the search-route audit; caps abuse and protects Spotify quota under burst load
- [ ] **DB-FTS-first search rewrite** — `/api/search` currently calls Spotify on every uncached query; the GIN FTS index from migration `20260517000000_indexes_and_fts.sql` is built but unused. Rewrite the route to query Postgres FTS first and only fall through to Spotify when DB returns < N results. Self-healing via existing `saveBasicReleases` writeback. (2026-05-24: partial progress — DB fallback now exists for the rate-limited path via `searchReleasesInDb` / `searchArtistsInDb` with pg_trgm indexes, but the happy path still calls Spotify first.)
- [ ] **Upstash Redis caching** — ranking leaderboards, album avg rating + count, homepage genre rows; invalidate on write
- [ ] Korean i18n (next-intl; language toggle in settings) — DB schema is ready (`native_language` columns), UI display in AlbumCard is done; remaining work is route-level i18n and language toggle
- [x] **Genre overrides applied** (2026-05-24) — 68 hand-curated overrides applied; `genre-overrides.json` workflow complete
- [x] **404 hardening + Spotify circuit breaker** (2026-05-23) — `/api/search` persists results to `releases`; `lib/spotify.ts` has a Redis circuit breaker that short-circuits all Spotify calls during a 429 window
- [x] **Search graceful degradation + script breaker cooperation + 429 instrumentation** (2026-05-24) — `/api/search` returns DB results with `degraded: true` instead of 500 when Spotify is rate-limited; degraded banner in search UI; `lib/spotify.ts` logs `[spotify] 429 path=...` for log-grep diagnosis; all 5 scripts read+publish the shared circuit breaker key via `scripts/spotify-circuit.ts`; debugging runbook in this README
- [x] **Non-Spotify catalog pipeline** (2026-05-24) — Wikipedia → iTunes queue → Last.fm similar → miss-driven; all scripts built and tested (dry run); migrations applied
- [x] **Multilingual catalog** (2026-05-24) — `title_native`/`artist_native`/`native_language` columns on releases; `name_native`/`native_language` on artists; language-agnostic ISO 639-1 design; `detectLanguage()` from Unicode ranges; search queries native columns; `AlbumCard` displays native names; `backfill-native-names.ts` two-phase pipeline for existing rows; `build-artist-queue` + `ingest-itunes-queue` enriched for new ingestion
- [x] **Column consistency guarantee** (2026-05-24) — all 9+ write paths to `releases` audited; all inconsistencies fixed; `normalize-releases.ts` corrected 153 dates + 3,687 genre casings in historical data
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

### Catalog pipeline — non-Spotify

As of 2026-05-24, Spotify is no longer used for data collection. The new pipeline is:

```
Wikipedia categories → artist_ingestion_queue → iTunes discography ingest
                                                        ↓
                                          Last.fm similar discovery → queue (loop)
                                                        ↓
                                          search_misses table → nightly ingest job
```

#### Step 1 — Build the Wikipedia artist queue

Scrapes 19 Korean music Wikipedia categories (K-pop groups, solo male/female, hip-hop, rock, indie, jazz, trot, electronic, ballad, Korean pop) using the MediaWiki JSON API. Cleans disambiguation suffixes ("IU (singer)" → "IU"). Upserts to `artist_ingestion_queue`.

```bash
npm run queue:build        # populate queue
npm run queue:build:dry    # preview (no DB writes)
```

State: table-based (re-run is idempotent — skips artists already in queue). User-Agent: `sillajuku-catalog-builder/1.0`.

#### Step 2 — iTunes queue ingest

For each pending artist in the queue: searches iTunes for the artist ID, fetches their full discography, upserts releases. No auth, no API key, no rate limit beyond iTunes throttling (650ms/req delay with exponential backoff on 429/403).

```bash
npm run queue:ingest             # drain all pending artists
npm run queue:ingest:dry         # dry run
npm run queue:ingest -- --limit=50   # process only 50 artists
```

- Deduplicates by `itunes_id` first, then title+artist ilike match
- Enriched path only backfills `cover_url` if existing record has none (preserves Spotify art)
- Marks each queue row as `done` / `failed` / `skipped`; re-run to resume

#### Step 3 — Last.fm similar artist discovery

For every artist in the `artists` DB table, calls Last.fm `artist.getSimilar` and adds similar artists to `artist_ingestion_queue` (source: `lastfm_similar`). Then run `queue:ingest` again. Loop until the queue stabilizes.

```bash
npm run queue:discover        # discover similar artists
npm run queue:discover:dry    # preview
```

Requires `LASTFM_API_KEY` in `.env.local`. State file: `scripts/discover-lastfm-similar-state.json`.

#### Step 4b — Native name backfill (existing DB rows)

Fills `name_native` / `native_language` on artists and `title_native` / `artist_native` / `native_language` on releases for rows that already exist. Language-agnostic: covers Korean, Japanese, Chinese, and any future CJK language automatically.

- **Phase 1** (artists) — Wikipedia langlinks. For each artist, looks up the English Wikipedia article and picks the first non-Latin-script language title. Priority: ko → ja → zh → any other detected script (Arabic, Thai, Devanagari, Cyrillic, Hebrew, Greek). ~2 requests per artist, 350ms delay each. Much better coverage than MusicBrainz.
- **Phase 2** (releases) — iTunes local store. For each artist whose language was set by phase 1, fetches their discography from the local country store (KR / JP / TW). Only runs on releases from known Asian artists — Western releases are skipped with zero API calls.

```bash
npm run backfill:native:artists   # phase 1 only
npm run backfill:native:releases  # phase 2 only (requires phase 1 first)
npm run backfill:native           # both phases back-to-back
npm run backfill:native:dry       # preview, no DB writes
```

State saved every 20 records to `scripts/backfill-native-names-state.json`. Safe to Ctrl+C and resume anytime.

#### Step 5 — Cover art backfill

Finds all releases with `cover_url IS NULL` and runs a 4-tier fallback per release:
1. iTunes: `artworkUrl600` from search
2. Last.fm: `album.getInfo` → image[extralarge]
3. MusicBrainz → Cover Art Archive (1 req/s limit)
4. Spotify: search per album (last resort; skip with `--skip-spotify`)

```bash
npm run backfill:covers              # full run (all 4 tiers)
npm run backfill:covers:dry          # preview
npm run backfill:covers:no-spotify   # skip tier 4 (no Spotify calls)
```

Writes `cover_url` and `cover_source` ('itunes'/'lastfm'/'musicbrainz'/'spotify'). State file: `scripts/backfill-cover-art-state.json`.

#### Genre pipeline (run after queue ingest)

```bash
# Tier 1: iTunes backfill (fills null genres from iTunes search — resumable)
npm run backfill:genres           # or --dry-run
# State: scripts/backfill-genres-itunes-state.json

# Tier 2: Last.fm fallback (fills remaining nulls via album.gettoptags)
npm run backfill:genres:lastfm    # or --dry-run
# State: scripts/backfill-genres-lastfm-state.json

# Tier 3: Hand-curated overrides (68 high-value rows, applied 2026-05-24)
# Already done. Re-run if you add new overrides to genre-overrides.json:
npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts

# Supplementary: Last.fm enrichment — MERGES tags with existing genres (not just fallback)
# Run on ALL releases (not just null-genre ones). iTunes wrote "k-pop", Last.fm adds "r&b" → "k-pop,r&b"
npm run enrich:genres:lastfm      # or --dry-run
# State: scripts/enrich-genres-lastfm-state.json
```

#### Normalize historical data

Safe to re-run anytime. Fixes partial dates, mixed-case genres, lowercase release_type values.

```bash
npm run normalize:releases         # fix all inconsistencies
npm run normalize:releases:dry     # preview only
```

Last run (2026-05-24): 153 dates fixed, 3,687 genres lowercased, 0 release_types to fix.

### Supabase migrations applied (2026-05-24 sessions)

All applied to prod via `supabase db push`:
- `20260525000000_catalog_ingestion_queue.sql` — creates `artist_ingestion_queue`, `search_misses` tables
- `20260525000002_native_language_columns.sql` — adds `title_native`, `artist_native`, `native_language` to `releases`; `name_native`, `native_language` to `artists`; trigram indexes
- `20260525000003_native_language_constraint.sql` — CHECK constraint `native_language ~ '^[a-z]{2}$'`

### Legacy scripts (Spotify-based — mostly dead)

```bash
# These still exist but should not be used for data collection:
npm run ingest              # Spotify seed catalog (original 315-artist list) — still works but burns quota
npm run expand:discography  # Spotify discography expansion — still works, 60 artists/day
npm run expand:genre        # Spotify genre sweep — still works
# npm run expand:related    # ❌ DEAD — Spotify deprecated /artists/{id}/related-artists in late 2024
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
- **Album page fallback chain** (2026-05-28: now DB-first) — `getCachedAlbum` (DB row with tracklist) → `getBasicRelease` (DB row without tracklist; still renders a usable page) → `getSpotifyAlbum` (only for genuinely unknown Spotify-ID deep-links) → `notFound()`. Spotify is no longer called when a basic DB row exists — eliminates the per-visitor Spotify cost. Tracklists only appear on Spotify-cached albums; iTunes-sourced rows render without a tracklist section.
- **Artist page discography** (2026-05-28: now DB-first) — `getArtistReleases` (DB query on `releases.artist_id`) is tried first. `getSpotifyArtistAlbums` only runs when the DB has zero releases for that artist (typical case: freshly-clicked Spotify-only artist not yet ingested). With 4,568 newly-ingested iTunes releases, most Korean artists hit the DB path and skip Spotify entirely.
- **Supabase region:** Seoul. ~180–220ms latency for Western users — acceptable while Korea-focused; address with read replicas at Western expansion.
- **Supabase free tier:** 500MB storage (~100,000 albums). Paid tier ($25/mo) gives 8GB.
- **Service role key** — server-side only for aggregate queries. Never exposed to client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, resets on server restart. Covers artists, albums, artist IDs, album detail, and recommendations.
- **ISR** — artist album pages revalidate every 3600s.
- **Migrations** — all schema changes in `supabase/migrations/`, applied with `supabase db push`.
- **`recommendable_releases` view** — both web and mobile query this view instead of `releases` directly; encodes shared eligibility rules (albums + EPs only, must have `cover_url`). Uses `LOWER(release_type)` comparison — DB stores `'Album'`/`'EP'` with capital first letter. Edit the view migration to change recommendation rules across both apps at once.
- **Native language schema** — `releases` stores `title_native`, `artist_native`, `native_language` (ISO 639-1: `'ko'`, `'ja'`, `'zh'`) alongside English `title`/`artist`. `artists` stores `name_native` and `native_language`. Language is derived from Unicode character ranges (Hangul / Hiragana-Katakana / CJK unified ideographs) — never hardcoded per language. Search queries both romanized and native columns (`name.ilike OR name_native.ilike`). `AlbumCard` shows native names when they differ from the English name (case-insensitive comparison). Adding support for a new language only requires adding artists to the Wikipedia queue — no schema changes needed.
- **Singles filtering** — enforced at every layer: `recommendable_releases` view, `include_groups=album,ep,compilation` in Spotify artist-albums API calls, `.not('release_type', 'ilike', 'single')` on all DB queries, and post-fetch `releaseType === 'Single'` guards in route handlers.
- **CSP (`next.config.mjs`)** — includes explicit `wss://*.supabase.co` for Safari (Safari does not automatically allow WebSocket when only `https://` is listed in `connect-src`), `us-assets.i.posthog.com` for PostHog session replay, and `lh3.googleusercontent.com` for Google OAuth avatars.
- **Server Component error handling** — `RecommendationGrid` wraps Supabase queries in try/catch so a transient network failure (common on mobile) falls through to the Spotify fallback instead of bubbling to the error boundary.
- **Next.js route groups** — all pages live under `app/(main)/` or `app/(auth)/`. Never create directories directly under `app/` without a route group — empty ghost directories cause "No default component for parallel route" errors.

## Known issues

- **`notFound()` returns HTTP 200 instead of 404** on `/album/[mbid]` and `/rankings/[slug]`. The `not-found.tsx` body renders correctly (user sees the friendly "Page not found" page); only the HTTP status code is wrong. Reproduced in both dev and prod with Next.js 14.2.35. Truly nonexistent routes (no `page.tsx` at all) return 404 correctly. Other pages with `notFound()` but without cookie reads (`/artist`, `/genre`, `/explore`) also return 404 correctly. Removing `export const revalidate` and adding `export const dynamic = 'force-dynamic'` did not fix it. Affects SEO and analytics, not user-visible UX. Post-launch fix candidates: (a) Next.js 15/16 upgrade with breaking-change migration, (b) refactor album page to defer all cookie-reading code into a child Server Component that mounts only after `notFound()` check.
