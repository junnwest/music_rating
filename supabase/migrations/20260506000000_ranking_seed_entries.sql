-- Seed entries for ranking leaderboards — no user FK, populated by admins pre-launch
CREATE TABLE IF NOT EXISTS ranking_seed_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES ranking_categories(id) ON DELETE CASCADE,
  release_id text NOT NULL,
  seed_votes int NOT NULL DEFAULT 1,
  UNIQUE(category_id, release_id)
);

ALTER TABLE ranking_seed_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ranking_seed_entries_select" ON ranking_seed_entries;
CREATE POLICY "ranking_seed_entries_select" ON ranking_seed_entries FOR SELECT USING (true);
