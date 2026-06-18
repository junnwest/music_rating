-- Manual rating precision (WEB_PARITY.md §4).
-- Lets a user switch Manual mode from the half-star widget (0.5 steps) to a
-- slider with 0.1 steps. Stores only the chosen granularity — `ratings.score`
-- is already numeric(3,1) so the value itself needs no schema change, and the
-- 0.1 slider stays within the existing 0.5–5.0 range.
--
-- Run via the Supabase SQL editor. Idempotent.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manual_rating_step numeric(2,1) NOT NULL DEFAULT 0.5;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_manual_rating_step_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_manual_rating_step_check
  CHECK (manual_rating_step IN (0.1, 0.5));
