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

Run each of these SQL blocks in **Supabase → SQL Editor** in order.

### 1. Ratings
```sql
CREATE TABLE ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  score int CHECK (score BETWEEN 1 AND 10),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ratings_select" ON ratings FOR SELECT USING (true);
CREATE POLICY "ratings_insert" ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ratings_update" ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ratings_delete" ON ratings FOR DELETE USING (auth.uid() = user_id);
```

### 2. Releases
```sql
CREATE TABLE releases (
  id text PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL,
  cover_url text,
  release_type text DEFAULT 'Album',
  release_date text
);
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "releases_select" ON releases FOR SELECT USING (true);
CREATE POLICY "releases_insert" ON releases FOR INSERT WITH CHECK (true);
```

### 3. Reviews
```sql
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  username text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select" ON reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert" ON reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_delete" ON reviews FOR DELETE USING (auth.uid() = user_id);
```

### 4. Curated releases (homepage genre rows)
```sql
CREATE TABLE curated_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  release_id text NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  cover_url text,
  release_type text DEFAULT 'Album',
  UNIQUE(category, release_id)
);
ALTER TABLE curated_releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "curated_select" ON curated_releases FOR SELECT USING (true);
```

### 5. Lists
```sql
CREATE TABLE lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(list_id, release_id)
);
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lists_select" ON lists FOR SELECT USING (true);
CREATE POLICY "lists_insert" ON lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lists_delete" ON lists FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "list_items_select" ON list_items FOR SELECT USING (true);
CREATE POLICY "list_items_insert" ON list_items FOR INSERT WITH CHECK (
  auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
);
CREATE POLICY "list_items_delete" ON list_items FOR DELETE USING (
  auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
);
```

### 6. Pinned albums
```sql
CREATE TABLE pinned_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE pinned_albums ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pinned_select" ON pinned_albums FOR SELECT USING (true);
CREATE POLICY "pinned_insert" ON pinned_albums FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pinned_delete" ON pinned_albums FOR DELETE USING (auth.uid() = user_id);
```

### 7. Rankings

```sql
CREATE TABLE ranking_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text,
  genre text,
  year int,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE ranking_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ranking_categories_select" ON ranking_categories FOR SELECT USING (true);

CREATE TABLE ranking_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES ranking_categories(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, category_id)
);
ALTER TABLE ranking_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ranking_votes_select" ON ranking_votes FOR SELECT USING (true);
CREATE POLICY "ranking_votes_insert" ON ranking_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ranking_votes_delete" ON ranking_votes FOR DELETE USING (auth.uid() = user_id);
```

After running the SQL, seed the initial categories:
```bash
curl -X POST https://your-domain.com/api/admin/seed-rankings \
  -H "x-seed-secret: YOUR_SEED_SECRET"
```

### 8. Profiles

```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);
```

### 9. Follows

```sql
CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follows_select" ON follows FOR SELECT USING (true);
CREATE POLICY "follows_insert" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete" ON follows FOR DELETE USING (auth.uid() = follower_id);
```

### 10. DB caching columns (run after initial setup)
```sql
-- Extend releases table for full album caching
ALTER TABLE releases ADD COLUMN IF NOT EXISTS genres text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS total_tracks int;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS tracklist jsonb;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS spotify_url text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS artist_id text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS cached_at timestamptz;

-- Artist cache table
CREATE TABLE IF NOT EXISTS artists (
  id text PRIMARY KEY,
  name text NOT NULL,
  genres text,
  followers int,
  popularity int,
  cover_url text,
  spotify_url text,
  cached_at timestamptz DEFAULT now()
);
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artists_select" ON artists FOR SELECT USING (true);
CREATE POLICY "artists_insert" ON artists FOR INSERT WITH CHECK (true);
CREATE POLICY "artists_update" ON artists FOR UPDATE USING (true);
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
