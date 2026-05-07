-- Personal tiered rankings per user per category
CREATE TABLE IF NOT EXISTS user_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES ranking_categories(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, category_id)
);

CREATE TABLE IF NOT EXISTS user_ranking_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ranking_id uuid NOT NULL REFERENCES user_rankings(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  rank int NOT NULL,
  UNIQUE(ranking_id, release_id)
);

ALTER TABLE user_rankings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_rankings_select" ON user_rankings;
DROP POLICY IF EXISTS "user_rankings_insert" ON user_rankings;
DROP POLICY IF EXISTS "user_rankings_update" ON user_rankings;
DROP POLICY IF EXISTS "user_rankings_delete" ON user_rankings;
CREATE POLICY "user_rankings_select" ON user_rankings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_rankings_insert" ON user_rankings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_rankings_update" ON user_rankings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_rankings_delete" ON user_rankings FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE user_ranking_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_ranking_entries_select" ON user_ranking_entries;
DROP POLICY IF EXISTS "user_ranking_entries_insert" ON user_ranking_entries;
DROP POLICY IF EXISTS "user_ranking_entries_delete" ON user_ranking_entries;
CREATE POLICY "user_ranking_entries_select" ON user_ranking_entries FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = auth.uid())
);
CREATE POLICY "user_ranking_entries_insert" ON user_ranking_entries FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = auth.uid())
);
CREATE POLICY "user_ranking_entries_delete" ON user_ranking_entries FOR DELETE USING (
  EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = auth.uid())
);
