-- Songs as first-class — Instinct + Elo for songs (SONGS_PLAN.md step 4).
-- Mirrors the album Instinct schema (ratings.elo_* + pairwise_comparisons) at the
-- song grain. Songs are rated in `track_ratings`, keyed by (release_id, track_position).
-- Per-type Instinct: songs compare only with songs, so they get their own
-- comparisons log, separate from albums' `pairwise_comparisons`.
--
-- Run via the Supabase SQL editor. Idempotent.

-- 1. track_ratings.elo_score / elo_games (mirror ratings.elo_*)
ALTER TABLE track_ratings ADD COLUMN IF NOT EXISTS elo_score numeric;
ALTER TABLE track_ratings ADD COLUMN IF NOT EXISTS elo_games integer NOT NULL DEFAULT 0;

-- 2. track_pairwise_comparisons log (songs vs songs).
-- Songs are keyed by (release_id, position) — same grain as track_ratings.
CREATE TABLE IF NOT EXISTS track_pairwise_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  winner_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  winner_position int NOT NULL,
  loser_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  loser_position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE track_pairwise_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own song comparisons" ON track_pairwise_comparisons;
CREATE POLICY "Users manage own song comparisons"
  ON track_pairwise_comparisons FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_track_pairwise_user
  ON track_pairwise_comparisons (user_id);
