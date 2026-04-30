# 音色 neiro

A music rating and discovery platform for Korean music fans. Rate albums, write reviews, and get personalized recommendations.

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

Schema is managed via **Supabase CLI migrations** — no more manual SQL editor.

### First-time setup (one time only)

1. Install the CLI:
   ```bash
   npm install -g supabase
   ```

2. Log in and link to your project:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
   Find your project ref in Supabase → Project Settings → General.

3. Apply all migrations:
   ```bash
   supabase db push
   ```
   This runs every file in `supabase/migrations/` in order.

### Adding a new schema change

```bash
supabase migration new <short_description>
# edit the generated file in supabase/migrations/
supabase db push
```

That's it — no dashboard copy-paste required.

### Seeding ranking categories (run once after first push)

```bash
curl -X POST https://your-domain.com/api/admin/seed-rankings \
  -H "x-seed-secret: YOUR_SEED_SECRET"
```

---

## Deployment checklist

### Before going live

- [x] Set all environment variables in Vercel — same keys as `.env.local`, including `SEED_SECRET`
- [x] Run Supabase SQL blocks 1–7 on the production Supabase project
- [ ] Run SQL blocks 8 (profiles) and 9 (follows) — added for the following system
- [ ] Enable **Supabase Auth** email confirmations if desired (Auth → Email Templates)
- [ ] Update `privacy@neiro.app` and `legal@neiro.app` in `app/(main)/privacy/page.tsx` and `app/(main)/terms/page.tsx` to your real contact email
- [ ] Add your jurisdiction to section 12 of Terms of Service
- [ ] Enable Google OAuth provider in Supabase Auth dashboard

### After first deployment

- [ ] **Seed the homepage genre rows** — run this once after the site is live:
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-curated \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```

### Before public marketing / launch

- [ ] **Run the Korean music data ingestion script** — pre-populate the DB with albums from major Korean artists and genres before real users arrive. This is critical to reduce Spotify API dependency at scale. Script to be built at `scripts/ingest-korean-music.ts`. Target: top artists from K-Pop, Korean R&B, Korean Indie, K-Rap genres; major label rosters (HYBE, SM, YG, JYP, Kakao M). Run with rate-limited delays (200ms between requests). Re-run monthly to pick up new releases.
- [ ] Verify Google OAuth works on production
- [ ] Test rating, review, and list flows end-to-end on production
- [ ] Confirm homepage genre rows are populated (curated_releases seed)

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
- [x] Activity feed (community ratings + reviews)
- [x] Lists (create, view)
- [x] Profile page (ratings grid, score distribution)
- [x] Rating Philosophy (profile sidebar — strictness, perfect score frequency, consistency)
- [x] Taste DNA (profile sidebar — genre + behavior tags)
- [x] Genre storage on ratings (genres column in releases table)
- [x] DB caching layer — albums and artists saved to Supabase on first visit, served from DB on repeat visits
- [x] Monthly Capsule — monthly reflection card in profile sidebar
- [x] Pinned Ten — 10 album slots on profile, pick from rated catalog
- [x] Shelf Creation — Lists tab on profile showing user's created lists

### Done — profiles
- [x] Top Genres — auto-derived from rated releases' genre data

### Done — onboarding
- [x] Pick 5 Perfect Albums — modal on first login, seeds personalization

### Done — rankings
- [x] Community rankings page — one vote per user per category, live leaderboards
- [x] Individual ranking page — top 10, vote counts, movement indicators, friends' picks

### Done — social
- [x] Following system — follow/unfollow users, follower/following counts on profile, dynamic `/profile/[username]` pages
- [x] Following feed — Activity page filters to followed users when logged in; falls back to community feed
- [x] Friend Taste Collisions — `/collisions` page showing albums where you and followed users rated ≥1.5 stars apart
- [x] Taste Contradictions — `/contradictions` page showing albums where your score diverges from community avg by ≥1.5, split into "rated higher" / "rated lower"
- [x] Activity feed following filter — when logged in, activity defaults to followed users; falls back to community feed
- [x] Profile pages (public) — `/profile/[username]` shows any user's profile with read-only PinnedTen, ratings, and follow button

### Done — rankings
- [x] Ranking personalization — filter tabs (All / To Vote / Friends Active) with friend vote counts on each card

### Done — annual
- [x] Wrapped page — yearly summary: total albums, top genre, top artist, avg score, active month, best/worst album

---

## Architecture notes

- **DB-first pattern:** All homepage genre rows served from `curated_releases` table. Album and artist data cached to DB on first visit — Spotify only called on cache miss. This is the read-through cache pattern used by production music platforms.
- **Data ingestion:** A pre-launch script will pre-populate the DB with Korean music catalog data from Spotify, so early users never hit cold-cache Spotify calls.
- **Spotify rate limits:** Client credentials cap at ~100-180 req/min. Current safe zone is under 50 concurrent users without DB cache. DB cache removes this ceiling almost entirely for repeat content.
- **Supabase free tier:** 500MB storage. Estimated capacity: ~100,000 albums cached. Paid tier ($25/mo) gives 8GB — effectively unlimited for this use case.
- **Supabase service role key** is used server-side to bypass RLS for aggregate queries. Never exposed to the client.
- **In-memory Spotify cache** (`lib/spotify.ts`) — 1hr TTL, survives hot reloads, resets on server restart.
- Artist album pages use ISR (`revalidate: 3600`) — cached for 1 hour per artist.
