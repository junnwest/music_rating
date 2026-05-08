# sillajuku

A music rating and discovery platform for serious listeners. Rate albums, write reviews, and get personalized recommendations.

**Stack:** Next.js 14 (App Router) · Supabase (auth + database) · Spotify API · Tailwind CSS

---

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` with the following keys:
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
   npm run dev
   ```

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

### Seeding ranking categories (run once after first push)

```bash
curl -X POST https://your-domain.com/api/admin/seed-rankings \
  -H "x-seed-secret: YOUR_SEED_SECRET"
```

---

## Deployment checklist

### Before going live

- [x] Set all environment variables in Vercel
- [x] Run all migrations (`supabase db push`) — all 13 tables + RLS policies applied
- [x] Add jurisdiction to Terms of Service (Republic of Korea)
- [x] Enable Google OAuth in Supabase Auth dashboard
- [ ] Replace `privacy@sillajuku.app` and `legal@sillajuku.app` in privacy/terms pages with real email
- [ ] Enable Supabase Auth email confirmations if desired (Auth → Email Templates)

### After first deployment

- [ ] **Push the new migration** (`ranking_seed_entries` table):
  ```bash
  supabase db push
  ```
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
- [ ] **Seed default ranking votes** — fill in `scripts/seed-votes.ts` with albums (Spotify IDs) for each of the 6 categories, then run:
  ```bash
  SEED_SECRET=your-secret NEXT_PUBLIC_SITE_URL=https://your-domain.com npx ts-node scripts/seed-votes.ts
  ```

### Before public launch

- [ ] **Run music ingestion** — see [Music catalog ingestion](#music-catalog-ingestion) below
- [ ] **Seed Rolling Stone 500 baseline** into "all-time" ranking category:
  ```bash
  $env:SPOTIFY_CLIENT_ID="..."; $env:SPOTIFY_CLIENT_SECRET="..."; $env:NEXT_PUBLIC_SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; npx ts-node scripts/seed-rankings.ts --category all-time
  ```
  Progress saved to `scripts/seed-rankings-state-all-time.json` — safe to re-run on interruption.
- [ ] Verify Google OAuth works on production
- [ ] Test rating, review, and list flows end-to-end on production
- [ ] Confirm homepage genre rows are populated
- [ ] Replace `privacy@sillajuku.app` and `legal@sillajuku.app` in privacy/terms pages

### After launch (once real users are voting)

- [ ] **Remove or reduce seed votes** — once each ranking category has real votes overtaking the seeds, clear seed data so the leaderboard is purely community-driven:
  ```bash
  curl -X DELETE https://your-domain.com/api/admin/seed-votes \
    -H "x-seed-secret: YOUR_SEED_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}'
  ```
  Or clear a single category by passing `{ "categorySlug": "all-time" }` in the body.
- [ ] **Revisit FilterBuilder genre map** — once you have real user data, check which genres are actually being used and update `genresByCountry` in `components/FilterBuilder.tsx` accordingly. Current map is a one-time editorial judgment, not live data.
- [ ] **Re-curate ranking categories** — add new year-specific categories (e.g. "Best Album of 2027") by updating `app/api/admin/seed-rankings/route.ts` and re-running the seed endpoint.

---

## Feature tracker

### Done
- [x] Album search (Spotify)
- [x] Album detail page (tracklist, community stats, ratings, comments)
- [x] Artist page with discography
- [x] Star rating widget (1–5, half-star steps; click same star to clear)
- [x] Comments (renamed from reviews) — visibility control (public / friends / private), commenter's star rating shown, likes, live username resolution from `profiles`
- [x] Homepage genre rows (DB-first, Spotify fallback)
- [x] For You page (personalized album feed)
- [x] Activity feed — community ratings + comments; filters to followed users when logged in
- [x] Lists (create, view)
- [x] Profile page (ratings grid, score distribution, sidebar-left layout; real comment count in stats)
- [x] Rating Philosophy / Insights (profile sidebar card)
- [x] Taste DNA badges in profile header (genre + behavior tags)
- [x] Top Genres (profile sidebar card)
- [x] Monthly Capsule (profile sidebar card)
- [x] Avg Score card (profile sidebar)
- [x] Essentials — 6-album pyramid, pick from rated catalog, drag-to-reorder, swap picker
- [x] Shelf Creation — Lists tab on profile
- [x] Pick 5 onboarding modal on first login
- [x] DB caching layer — albums + artists saved to Supabase on first visit
- [x] Genre storage on ratings
- [x] Add button on album page — dropdown with Listen Later, Essentials (with swap popup + ★5 confirmation), Add to Ranking (popup with Top 6 + Browse filter)
- [x] Listen Later page (`/listen-later`) — saved albums grid
- [x] Settings page — 5-tab settings (Account, Preferences, Notifications, Privacy, Danger Zone)
- [x] Help page — FAQ accordion + contact form
- [x] Notifications page — real data (new followers + friend ratings via `/api/notifications`)
- [x] Friends page — real Supabase follows (Following / Followers / Discover tabs)
- [x] Search page — mobile header transforms to search overlay on icon tap; landing state with no duplicate bar

### Done — social
- [x] Following system — follow/unfollow, follower/following counts, public `/profile/[username]` pages
- [x] Friend Taste Collisions — `/collisions`: albums rated ≥1.5★ apart from followed users
- [x] Taste Contradictions — `/contradictions`: your score vs community avg, split higher/lower

### Done — rankings
- [x] Community rankings page — leaderboards with seed + real vote merging
- [x] Individual ranking page — top 10, vote counts, "Build your ranking" button
- [x] Ranking personalization — filter tabs (All / To Vote / Friends Active); "To Vote" sorted by most active first
- [x] Filter Builder — country-aware genre dropdowns (genres change per country); vote status indicator + Vote/Change Vote button when filter matches a curated category
- [x] Rank Builder — `/rankings/[slug]/rank`: personal tiered ranking per category, drag-and-drop, ties supported, search panel with suggestions; saves to `user_rankings` + syncs rank-1 pick to community leaderboard
- [x] Ranking seed infrastructure — `ranking_seed_entries` table for pre-launch default leaderboard data; admin endpoint + `scripts/seed-votes.ts`
- [x] 6 curated ranking categories: Greatest Album of All Time · Best Hip-Hop All Time · Best K-Pop All Time · Best Album of 2026 · Best Korean Album All Time · Best K-Hip-Hop All Time
- [x] Rolling Stone 500 baseline seeds — `scripts/seed-rankings.ts` seeds all 500 albums into the "all-time" category as a single virtual ranked vote (`seed_votes = 1/rank`); `seed_votes` column migrated from `int` to `numeric(10,4)`

### Done — profile + settings (2026-05-07)
- [x] Settings page — username/display name/bio now correctly saved to DB and reflected immediately on profile
- [x] Profile page — username + bio read from `profiles` table (not derived from email); removed auto-upsert that was overwriting username on every visit
- [x] Navbar dropdown — username and display name now read from `profiles` table instead of `user_metadata`/email split
- [x] `[username]/page.tsx` — removed `targetUsername` prop that was overriding the DB-fetched username
- [x] Homepage — removed "Good morning / Here's what's waiting" greeting for logged-in users

### Done — UI polish pass (2026-05-08)
- [x] Album page — "avg/5" → "avg"; oversized dash on no-rating fixed; Add button consolidated into dropdown (Listen Later + Essentials + Add to Ranking); star rating text removed; Add button moved into stats row
- [x] Comments — renamed from Reviews throughout; visibility dropdown with icons; commenter's star rating shown; comment likes; live username → profile link
- [x] Essentials (was Pinned Ten) — swap modal with pyramid layout; ★5 confirmation flow matching profile picker; `checkPinned` split into two queries (was broken due to missing FK join)
- [x] Add to Ranking popup — Top 6 list + Browse Rankings filter (Country / Genre / Time dropdowns)
- [x] Profile page — real comment count replaces hardcoded "0 reviews"; Essentials component (was PinnedTen)
- [x] Search page — mobile header search overlay; landing empty state
- [x] Activity + Settings — "reviewed/reviews" text updated to "commented/comments"

### Done — annual
- [x] Wrapped page — yearly summary: albums rated, top genre, top artist, avg score, active month, best/worst album

### Planned
- [ ] Music ingestion script (`scripts/ingest-music.ts`) — Korean (full), Japanese (curated ~80 artists), Western essentials (~200 artists); albums/EPs only

---

## Pre-launch roadmap

Target: **mid-June 2026** (earlier the better). Wrapped page is the only feature deferred post-launch.

---

### Data collection

**The app caches albums automatically.** Every time a user searches for or rates an album, it's fetched from Spotify and stored in `releases`. The DB grows organically with every user interaction — pre-seeding is not about being exhaustive.

**Pre-seeding solves cold start only.** Without it, day-one users see an empty homepage, empty rankings, and onboarding with nothing to pick from. The goal is enough content for the first users to have a real experience — not a complete catalog.

| Phase | What it does | Est. albums | Status |
|-------|-------------|-------------|--------|
| Phase 1 — seed catalog | 315 curated Korean/Japanese/Western classics | 306 | ✓ done |
| RS500 baseline | Rolling Stone 500 seeds "all-time" ranking | 481 seeded | ✓ done |
| Phase 2 — discography expansion | All albums from every artist already in DB | ~2,600 more | in progress (41/331 artists) |
| Phase 3 — related artists | One hop from seeded artists (Korean ≥5k followers, J ≥20k, Western ≥100k) | ~3,200 more | not started |
| Phase 4 — genre sweeps | 12 genre tags with popularity threshold | ~800–1,200 more | not started |

**Phase 1 + RS500 (~750 albums) is the hard requirement for launch.** Both are done. Phases 2–4 improve cache warmth and search speed but are not blocking — any album not pre-loaded gets fetched live from Spotify on first visit and cached for all future users. Run them when convenient, not on a strict deadline.

```bash
# Run once per day until Phase 2 is done (~5 days), then move to Phase 3
npm run expand:discography

# Phase 3 (run after Phase 2 completes)
npm run expand:related

# Phase 4 (run after Phase 3 completes)
npm run expand:genre
```

---

### Week 1 — May 7–16: UI polish + mobile
- [x] Mobile responsiveness pass — ScrollRow touch scroll, album/artist/search/rankings/discography/onboarding grids all responsive
- [x] Loading skeletons — homepage feed, activity feed, profile header + grid
- [x] Empty states improved — search "no results" with icon + copy; listen later empty state already good
- [x] 404 + 500 error pages (`app/not-found.tsx`, `app/error.tsx`)
- [x] Mobile nav UX — bottom tab bar (Home / Search / Feed / Rankings / Profile), hidden at xl where sidebar takes over; iOS safe-area aware
- [x] Page reviews: main, search, album, notifications, friends
- [ ] Page reviews: artist, profile, activity, settings, rankings, listen-later, collisions, contradictions, wrapped, lists

### Week 2 — May 17–23: Functional gaps
- [ ] Password reset flow
- [ ] Email verification on signup
- [ ] Onboarding polish (first-time user experience)
- [x] 404 + 500 error pages (done in Week 1)

### Week 3 — May 24–30: Auth + legal + analytics
- [ ] KakaoTalk login
- [ ] Spotify login
- [ ] Privacy policy + Terms of Service (finalize — fill in real contact emails)
- [ ] Analytics setup (Posthog or Vercel Analytics)
- [ ] Dark mode

### Week 4 — May 31–Jun 6: App + translation + store submission
- [ ] Korean translation (i18n setup with next-intl; language toggle in settings)
- [ ] Capacitor app build (wraps existing Next.js app into native shell)
- [ ] App Store (iOS) + Play Store (Android) submission
  - ⚠️ Apple review takes 1–2 weeks — submit by Jun 1 to hit mid-June

### Week 5 — Jun 7–14: QA + production deploy
- [ ] Create dummy/test account and QA all social flows end-to-end
- [ ] Production deployment (custom domain, all env vars set, migrations pushed)
- [ ] Seed all ranking categories with baseline data
- [ ] Final bug fixes + buffer for App Store review delays

### Post-launch
- [ ] Wrapped page — needs months of user data to be meaningful
- [ ] Remove/reduce seed votes once real community votes overtake the baseline
- [ ] Re-curate ranking categories (add year-specific categories)

---

## Music catalog ingestion

Pre-populating the DB is a three-phase process. Each phase builds on the previous one.

### Phase 1 — Seed catalog (315 curated albums)

Source: `research/research1/korean_serious_music_seed_catalog_315.csv`
Breakdown: 188 Korean (60%) · 82 Western (26%) · 30 Japanese (10%) · 15 Other (5%)

```bash
npm run ingest           # full run
npm run ingest:dry       # preview without DB writes
npm run ingest:retry     # re-attempt previously not-found entries
```

State is saved to `scripts/ingest-state.json` after every 10 entries — safe to Ctrl-C and resume.

If an album isn't found with romanized names, add a Korean/native-script override to `scripts/search-overrides.json`:
```json
"Artist Name|Album Name": { "query": "아티스트 앨범명" }
```
Then run `npm run ingest:retry` to re-attempt only the not-found entries.

**Result:** 306/315 found (97%). The remaining 9 are genuinely not on Spotify.

15 entries were reset to `not_found` after a false-positive audit — wrong albums had been matched due to overly lenient artist similarity scoring. The matching logic has since been tightened (`artistSimilarity` Jaccard-only, guard raised to 0.25). Add native-script overrides to `scripts/search-overrides.json` and run `npm run ingest:retry` to recover them. See table of suggested overrides in git history.

---

### Phase 2 — Discography expansion

Fetches every album/EP from each artist already in the DB (one-hop, no text matching — no false positive risk).

```bash
npm run expand:discography
```

**Spotify daily quota:** The artist-albums endpoint has a ~23-hour daily quota separate from the per-minute rate limit. Run in batches of ~60 artists/day (the default). The script resumes automatically from where it left off.

```bash
# Override batch size if needed
npx tsx --env-file=.env.local scripts/expand-catalog.ts discography --max-artists=40
```

State saved to `scripts/expand-state.json` after every artist. If the quota is hit mid-run, the script stops cleanly and prints the exact wait time.

---

### Phase 3 — Related artist expansion

One hop from all seeded artists, gated by follower count to keep quality high:

| Origin   | Min followers |
|----------|--------------|
| Korean   | 5,000        |
| Japanese | 20,000       |
| Western  | 100,000      |
| Other    | 50,000       |

```bash
npm run expand:related
```

---

### Phase 4 — Genre sweeps

Spotify genre-tag search across 12 tags (Korean indie, k-rap, city pop, shoegaze, neo-soul, etc.) with a minimum popularity threshold per tag.

```bash
npm run expand:genre
```

---

### ⚠️ NEXT SESSION — Do this first

`expand:discography` is in progress — **42/331 artists done** (369 albums added so far, hit daily quota mid-run on 2026-05-07). Resume with:

```bash
npm run expand:discography
```

Default batch is 60 artists/day. Run once per day until all 331 are done (~5 more days), then move to `expand:related` and `expand:genre`.

**False-positive fix applied (2026-05-07):** The expand script now passes `include_groups=album,single` to exclude `appears_on` compilations, and verifies the target artist is listed as a primary album artist. 18 false positives from the previous session (Defected Radio episodes, Café del Mar compilations, etc.) were cleaned up via `scripts/cleanup-false-positives.ts`.

**Rolling Stone 500 seed (2026-05-07):** `scripts/seed-rankings.ts` created and running. Seeds all 500 RS500 albums into the "all-time" ranking category as a single virtual ranked vote. `seed_votes` column migrated to `numeric(10,4)`. If interrupted, re-run the same command — progress is saved to `scripts/seed-rankings-state-all-time.json`.

---

### Spotify rate limit notes

- **Per-minute limit:** ~100 req/min (client credentials). Script uses 2000ms between calls.
- **Daily quota:** The `/artists/{id}/albums` endpoint has a hard daily limit. Exceeding it returns `Retry-After: ~82000s` (~23 hours). Run discography in batches of 60 artists/day to stay under it.
- **The canary check:** Each expand run starts with a `/search` call. If that returns 429, the script exits immediately with the exact wait time before making any real calls.
- **State files** (`scripts/ingest-state.json`, `scripts/expand-state.json`) track progress across sessions. Never delete them mid-run — they're how the scripts resume.

- **DB-first pattern:** Homepage genre rows served from `curated_releases`. Album and artist data cached to DB on first visit — Spotify only called on cache miss.
- **Data ingestion:** Four-phase pipeline pre-populates DB — seed catalog (315 albums) → discography expansion → related artists → genre sweeps. See [Music catalog ingestion](#music-catalog-ingestion).
- **Spotify rate limits:** Client credentials ~100 req/min per-minute; artist-albums endpoint also has a ~23hr daily quota. Script batches at 60 artists/day and exits cleanly on quota hit. DB cache removes the per-minute ceiling for repeat content.
- **Supabase free tier:** 500MB storage (~100,000 albums). Paid tier ($25/mo) gives 8GB.
- **Service role key** — used server-side only for aggregate queries. Never exposed to client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, resets on server restart.
- **ISR** — artist album pages revalidate every 3600s.
- **Migrations** — all schema changes in `supabase/migrations/`, applied with `supabase db push`.
