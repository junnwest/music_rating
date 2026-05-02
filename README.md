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
- [x] Run all migrations (`supabase db push`) — all 11 tables + RLS policies applied
- [x] Add jurisdiction to Terms of Service (Republic of Korea)
- [x] Enable Google OAuth in Supabase Auth dashboard
- [ ] Replace `privacy@sillajuku.app` and `legal@sillajuku.app` in privacy/terms pages with real email
- [ ] Enable Supabase Auth email confirmations if desired (Auth → Email Templates)

### After first deployment

- [ ] **Seed the homepage genre rows:**
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-curated \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```

### Before public launch

- [ ] **Run music ingestion** — see [Music catalog ingestion](#music-catalog-ingestion) below
- [ ] Verify Google OAuth works on production
- [ ] Test rating, review, and list flows end-to-end on production
- [ ] Confirm homepage genre rows are populated

---

## Feature tracker

### Done
- [x] Album search (Spotify)
- [x] Album detail page (tracklist, community stats, ratings, reviews)
- [x] Artist page with discography
- [x] Star rating widget (1–5, half-star steps)
- [x] Community reviews
- [x] Homepage genre rows (DB-first, Spotify fallback)
- [x] For You page (personalized album feed)
- [x] Activity feed — community ratings + reviews; filters to followed users when logged in
- [x] Lists (create, view)
- [x] Profile page (ratings grid, score distribution, sidebar-left layout)
- [x] Rating Philosophy / Insights (profile sidebar card)
- [x] Taste DNA badges in profile header (genre + behavior tags)
- [x] Top Genres (profile sidebar card)
- [x] Monthly Capsule (profile sidebar card)
- [x] Avg Score card (profile sidebar)
- [x] Pinned Ten — 10 album slots, pick from rated catalog
- [x] Shelf Creation — Lists tab on profile
- [x] Pick 5 onboarding modal on first login
- [x] DB caching layer — albums + artists saved to Supabase on first visit
- [x] Genre storage on ratings
- [x] Add to Pinned Ten button on album page (real Supabase toggle)
- [x] Listen Later button on album page (localStorage toggle)
- [x] Listen Later page (`/listen-later`) — saved albums grid
- [x] Settings page — 5-tab settings (Account, Preferences, Notifications, Privacy, Danger Zone)
- [x] Help page — FAQ accordion + contact form
- [x] Notifications page — real data (new followers + friend ratings via `/api/notifications`)
- [x] Friends page — real Supabase follows (Following / Followers / Discover tabs)

### Done — social
- [x] Following system — follow/unfollow, follower/following counts, public `/profile/[username]` pages
- [x] Friend Taste Collisions — `/collisions`: albums rated ≥1.5★ apart from followed users
- [x] Taste Contradictions — `/contradictions`: your score vs community avg, split higher/lower

### Done — rankings
- [x] Community rankings page — one vote per category, live leaderboards
- [x] Individual ranking page — top 10, vote counts, movement indicators
- [x] Ranking personalization — filter tabs (All / To Vote / Friends Active), friend counts on cards
- [x] Filter Builder — Country / Genre / Time dropdowns with live title preview, links to `/rankings/build`
- [x] Rankings Build page — shows matching DB categories for selected filter combination

### Done — annual
- [x] Wrapped page — yearly summary: albums rated, top genre, top artist, avg score, active month, best/worst album

### Planned
- [ ] Music ingestion script (`scripts/ingest-music.ts`) — Korean (full), Japanese (curated ~80 artists), Western essentials (~200 artists); albums/EPs only

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

The Spotify credentials are currently rate-limited from a failed `seed:prestige` run. Before doing anything else:

```bash
npm run seed:prestige
```

The script will check the rate limit at startup and print how many minutes to wait if still blocked. Once it runs clean, it seeds `prestige` scores and `genres` into the `releases` table — required for:
- Onboarding "Albums that shaped you" suggestions
- Cold-start main page recommendations ("Start Here" row)

After `seed:prestige` completes successfully, resume the normal expansion pipeline below.

---

### Resume expansion pipeline

Run `npm run expand:discography` once the 23-hour Spotify daily quota clears. Default batch is 60 artists/day; run again each day until all 247 are done (~4 days total), then move to `expand:related` and `expand:genre`.

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
