-- Instinct rating mode (pairwise comparison / Elo) — see WEB_PARITY.md §4.
--
-- Adds:
--   profiles.rating_mode          'manual' (default) | 'instinct'
--   ratings.elo_score / elo_games derived Elo score + games played (instinct users)
--   pairwise_comparisons          log of every "which do you prefer?" pick
--
-- Run via the Supabase SQL editor (the migration history has timestamp
-- collisions that block `supabase db push` — see README).
-- Written to be idempotent so it is safe to re-run.

-- ── 1. profiles.rating_mode ─────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rating_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rating_mode_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_rating_mode_check
  CHECK (rating_mode IN ('manual', 'instinct'));

-- ── 2. ratings.elo_score / elo_games ────────────────────────────────────────
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS elo_score numeric;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS elo_games integer NOT NULL DEFAULT 0;

-- ── 3. pairwise_comparisons log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pairwise_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  winner_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  loser_release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pairwise_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own comparisons" ON pairwise_comparisons;
CREATE POLICY "Users manage own comparisons"
  ON pairwise_comparisons FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_pairwise_comparisons_user
  ON pairwise_comparisons (user_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_comparisons_user_created
  ON pairwise_comparisons (user_id, created_at DESC);
