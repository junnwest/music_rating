-- Instinct-mode ratings store `elo_score` and have no star `score`, but
-- `ratings.score` is NOT NULL in prod, so seeding a bucket fails with
-- "null value in column score violates not-null constraint".
-- Make `score` nullable; the existing CHECK (0.5–5.0) still applies when it IS set.
--
-- Run via the Supabase SQL editor. Idempotent.

ALTER TABLE ratings ALTER COLUMN score DROP NOT NULL;
