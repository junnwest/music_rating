-- Track-level ratings (individual songs within a release)
CREATE TABLE IF NOT EXISTS track_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  track_position int NOT NULL,
  track_title text NOT NULL,
  score numeric(3,1) CHECK (score BETWEEN 0.5 AND 5.0),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, release_id, track_position)
);

ALTER TABLE track_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "track_ratings_select" ON track_ratings FOR SELECT USING (true);
CREATE POLICY "track_ratings_insert" ON track_ratings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "track_ratings_update" ON track_ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "track_ratings_delete" ON track_ratings FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_track_ratings_user ON track_ratings (user_id);
CREATE INDEX IF NOT EXISTS idx_track_ratings_release ON track_ratings (release_id);
