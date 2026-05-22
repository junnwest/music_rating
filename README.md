# sillajuku

Every record you've loved — rated, cataloged, and remembered. A music platform for listeners with taste.

**Stack:** Next.js 14 (App Router) · React Native (Expo SDK 54) · Supabase (auth + database) · Spotify API · Tailwind CSS

**Monorepo:** `apps/web` (Next.js) · `apps/mobile` (Expo) · `packages/shared` (TypeScript types)

---

## Local development

### Web

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   SPOTIFY_CLIENT_ID=
   SPOTIFY_CLIENT_SECRET=
   SEED_SECRET=pick-any-random-string
   ```

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
| Phase 3 — related artists | One hop from seeded artists | not started |
| Phase 4 — genre sweeps | 12 genre tags with popularity threshold | not started |

Phase 1 + RS500 is the hard requirement for launch — both done. Phases 2–4 are not blocking.

```bash
npm run expand:discography   # run once per day (~60 artists/batch)
npm run expand:related       # after Phase 2 completes
npm run expand:genre         # after Phase 3 completes
```

---

### Week 4 — May 31–Jun 6: remaining

- [ ] **Rate limiting** — `/api/check-username`, `/api/rankings/vote`, `/api/follow` via `@upstash/ratelimit` + Upstash Redis
- [ ] **Upstash Redis caching** — ranking leaderboards, album avg rating + count, homepage genre rows; invalidate on write
- [ ] Korean translation (i18n setup with next-intl; language toggle in settings)
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

### Phase 1 — Seed catalog (done: 306/315)

```bash
npm run ingest           # full run
npm run ingest:retry     # re-attempt not-found entries
```

For missing albums, add native-script overrides to `scripts/search-overrides.json`:
```json
"Artist Name|Album Name": { "query": "아티스트 앨범명" }
```

### Phase 2 — Discography expansion (in progress: 76/331 artists)

```bash
npm run expand:discography
# override batch size:
npx tsx --env-file=.env.local scripts/expand-catalog.ts discography --max-artists=40
```

State saved to `scripts/expand-state.json` after every artist. Quota hit = script exits with exact wait time.

### Phase 3 — Related artist expansion

```bash
npm run expand:related
```

Follower gates: Korean ≥5k · Japanese ≥20k · Western ≥100k · Other ≥50k.

### Phase 4 — Genre sweeps

```bash
npm run expand:genre
```

---

## Mobile app status

### Implemented (Expo Go compatible, no dev build required)

| Screen | Status | Notes |
|--------|--------|-------|
| Home | ✓ | Genre carousels, "See all" → genre browse, search icon auto-focuses |
| Search / Explore | ✓ | 3-column grid, community picks, personalized recs, people search, Spotify fallback |
| Album detail | ✓ | Rating, reviews, tracklist, artist link, inline review modal |
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
| Settings | ✓ | Basic |
| Notifications | ✓ | Basic |
| Listen Later | ✓ | Basic |

### Still missing vs web

- **Other user profiles** (`/profile/[username]`) — needs taste DNA, collisions, contradictions, full ratings grid
- **Album page** — missing "appears in rankings" section
- **Home personalized feed** — static genre carousels only; web shows a dynamic personalized feed
- **Settings** — web has 5 organized tabs (account, preferences, notifications, privacy, danger zone)
- **Notifications** — web has filters + mark-all-read + clear all
- **Listen Later** — web has full list management
- **Help page** — searchable FAQ + contact form
- **Privacy & Terms** — legal pages

### Architecture notes (mobile)

- **No native modules** — intentionally avoids packages that require a dev build (no `react-native-reanimated`, no `react-native-gesture-handler`). Drag-and-drop rankings will need EAS build when added.
- **Supabase client** — configured with `AsyncStorage` for session persistence and PKCE OAuth support.
- **Spotify search** — proxied through the web app (`EXPO_PUBLIC_API_URL/api/search`); mobile has no direct Spotify credentials.
- **Recommendation pool** — both web and mobile query the `recommendable_releases` view (albums + EPs only, must have cover art). Change the view definition once to affect both apps.
- **OAuth deep link** — `sillajuku://auth/callback` must be in Supabase Redirect URLs allowlist.

---

## Architecture notes

- **DB-first:** Album and artist data cached to DB on first visit — Spotify only called on cache miss. Spotify integration is metadata only, not content streaming.
- **Spotify rate limits:** ~100 req/min (client credentials); artist-albums endpoint has a ~23hr daily quota. Scripts batch at 60 artists/day and exit cleanly on quota hit. Never delete state files mid-run (`scripts/ingest-state.json`, `scripts/expand-state.json`).
- **Supabase region:** Seoul. ~180–220ms latency for Western users — acceptable while Korea-focused; address with read replicas at Western expansion.
- **Supabase free tier:** 500MB storage (~100,000 albums). Paid tier ($25/mo) gives 8GB.
- **Service role key** — server-side only for aggregate queries. Never exposed to client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, resets on server restart.
- **ISR** — artist album pages revalidate every 3600s.
- **Migrations** — all schema changes in `supabase/migrations/`, applied with `supabase db push`.
- **`recommendable_releases` view** — both web and mobile query this view instead of `releases` directly; encodes shared eligibility rules (albums + EPs only, must have `cover_url`). Edit the view migration to change recommendation rules across both apps at once.
- **CSP (`next.config.mjs`)** — includes explicit `wss://*.supabase.co` for Safari (Safari does not automatically allow WebSocket when only `https://` is listed in `connect-src`), `us-assets.i.posthog.com` for PostHog session replay, and `lh3.googleusercontent.com` for Google OAuth avatars.
- **Server Component error handling** — `RecommendationGrid` wraps Supabase queries in try/catch so a transient network failure (common on mobile) falls through to the Spotify fallback instead of bubbling to the error boundary.
