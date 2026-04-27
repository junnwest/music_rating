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

---

## Deployment checklist

### Before going live

- [ ] Set all environment variables in your hosting provider (Vercel etc.) — same keys as `.env.local`, including `SEED_SECRET`
- [ ] Run all Supabase SQL blocks above on the **production** Supabase project
- [ ] Enable **Supabase Auth** email confirmations if desired (Auth → Email Templates)
- [ ] Update `privacy@neiro.app` and `legal@neiro.app` in `app/(main)/privacy/page.tsx` and `app/(main)/terms/page.tsx` to your real contact email
- [ ] Add your jurisdiction to section 12 of Terms of Service

### After first deployment

- [ ] **Seed the homepage genre rows** — run this once after the site is live:
  ```bash
  curl -X POST https://your-domain.com/api/admin/seed-curated \
    -H "x-seed-secret: YOUR_SEED_SECRET"
  ```
  This fills the `curated_releases` table with K-Pop / Korean Indie / K-R&B albums from Spotify. After this runs, the homepage never calls Spotify again for those rows — it serves from your database permanently.

- [ ] Verify the response shows `"count": 10` (or similar) for each category, not errors

### Re-seeding (optional)

Re-run the seed command any time you want to refresh the homepage genre rows with newer albums. It upserts so there's no risk of duplicates.

---

## Architecture notes

- **Spotify API** is used only for album search (user-initiated). Homepage genre rows are served from Supabase after the one-time seed. This avoids rate limiting and Spotify API dependency on every page load.
- **Supabase service role key** is used server-side to bypass RLS for aggregate queries (community stats, activity feed). Never exposed to the client.
- **In-memory Spotify cache** (`lib/spotify.ts`) survives hot reloads but resets on full server restart. In production this is not an issue as the server runs continuously.
- Artist album pages use ISR (`revalidate: 3600`) — cached for 1 hour per artist.
