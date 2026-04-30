-- ============================================================
-- neiro — initial schema
-- ============================================================

-- ── 1. releases ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS releases (
  id text PRIMARY KEY,
  title text NOT NULL,
  artist text NOT NULL,
  cover_url text,
  release_type text DEFAULT 'Album',
  release_date text,
  -- caching columns (added inline so migrations stay in one file)
  genres text,
  label text,
  total_tracks int,
  tracklist jsonb,
  spotify_url text,
  artist_id text,
  cached_at timestamptz
);
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "releases_select" ON releases FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "releases_insert" ON releases FOR INSERT WITH CHECK (true);

-- ── 2. artists ──────────────────────────────────────────────
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
CREATE POLICY IF NOT EXISTS "artists_select" ON artists FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "artists_insert" ON artists FOR INSERT WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "artists_update" ON artists FOR UPDATE USING (true);

-- ── 3. curated_releases ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS curated_releases (
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
CREATE POLICY IF NOT EXISTS "curated_select" ON curated_releases FOR SELECT USING (true);

-- ── 4. ratings ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  score int CHECK (score BETWEEN 1 AND 10),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "ratings_select" ON ratings FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "ratings_insert" ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "ratings_update" ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "ratings_delete" ON ratings FOR DELETE USING (auth.uid() = user_id);

-- ── 5. reviews ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  username text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "reviews_select" ON reviews FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "reviews_insert" ON reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "reviews_delete" ON reviews FOR DELETE USING (auth.uid() = user_id);

-- ── 6. lists ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(list_id, release_id)
);
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "lists_select" ON lists FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "lists_insert" ON lists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "lists_delete" ON lists FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "list_items_select" ON list_items FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "list_items_insert" ON list_items FOR INSERT WITH CHECK (
  auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
);
CREATE POLICY IF NOT EXISTS "list_items_delete" ON list_items FOR DELETE USING (
  auth.uid() = (SELECT user_id FROM lists WHERE id = list_id)
);

-- ── 7. pinned_albums ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pinned_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id)
);
ALTER TABLE pinned_albums ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "pinned_select" ON pinned_albums FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "pinned_insert" ON pinned_albums FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "pinned_delete" ON pinned_albums FOR DELETE USING (auth.uid() = user_id);

-- ── 8. ranking_categories ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ranking_categories (
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
CREATE POLICY IF NOT EXISTS "ranking_categories_select" ON ranking_categories FOR SELECT USING (true);

-- ── 9. ranking_votes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ranking_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES ranking_categories(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, category_id)
);
ALTER TABLE ranking_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "ranking_votes_select" ON ranking_votes FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "ranking_votes_insert" ON ranking_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "ranking_votes_delete" ON ranking_votes FOR DELETE USING (auth.uid() = user_id);

-- ── 10. profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "profiles_select" ON profiles FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ── 11. follows ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "follows_select" ON follows FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "follows_insert" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY IF NOT EXISTS "follows_delete" ON follows FOR DELETE USING (auth.uid() = follower_id);
