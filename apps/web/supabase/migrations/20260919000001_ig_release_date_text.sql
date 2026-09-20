-- ================================================================
-- Fix: ig_detected_releases.release_date must accept MB's variable-precision
-- dates (YYYY | YYYY-MM | YYYY-MM-DD), not just a full date. A real live
-- release group with only a year ("2026") failed to insert against the
-- original `date`-typed column in 20260919000000_ig_famous_artists.sql.
-- 2026-09-19. Run in the Supabase SQL editor. Idempotent; safe to re-run.
-- ================================================================

BEGIN;

ALTER TABLE ig_detected_releases ALTER COLUMN release_date TYPE text;

COMMIT;
