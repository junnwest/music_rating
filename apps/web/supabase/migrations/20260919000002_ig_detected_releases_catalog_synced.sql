-- ================================================================
-- Track whether a detected release's artist has been synced into the real
-- rating catalog yet. The user clarified the catalog's Korean-underground
-- scope is a resource constraint, not a permanent exclusion policy — famous
-- watchlist artists should actually be ingested (artists/release_groups/
-- releases), not just tracked in these ig_* side tables.
-- 2026-09-19. Run in the Supabase SQL editor. Idempotent; safe to re-run.
-- ================================================================

BEGIN;

ALTER TABLE ig_detected_releases
  ADD COLUMN IF NOT EXISTS catalog_synced boolean NOT NULL DEFAULT false;

COMMIT;
