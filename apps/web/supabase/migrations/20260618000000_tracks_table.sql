-- Songs as first-class — `tracks` table (see SONGS_PLAN.md).
-- Each song becomes a row with a stable UUID so songs can have their own pages,
-- ratings, search, and leaderboards. Populated from `releases.tracklist` (JSONB)
-- by scripts/backfill-tracks.ts; future ingests can write rows inline.
--
-- Run via the Supabase SQL editor. Idempotent. Apply BEFORE running the backfill.

CREATE TABLE IF NOT EXISTS tracks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id  uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  position    int NOT NULL,           -- 1-based; multi-disc already flattened in the source tracklist
  title       text NOT NULL,
  duration_ms int,
  artists     text,                   -- performer string from the tracklist (may differ from album artist)
  created_at  timestamptz DEFAULT now(),
  UNIQUE (release_id, position)        -- the upsert key for the backfill
);

ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;

-- Catalog data: world-readable; writes happen via the service role (scripts) or
-- client ensure-paths. Mirrors the `releases` policies.
DROP POLICY IF EXISTS tracks_select ON tracks;
CREATE POLICY tracks_select ON tracks FOR SELECT USING (true);
DROP POLICY IF EXISTS tracks_insert ON tracks;
CREATE POLICY tracks_insert ON tracks FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tracks_release ON tracks (release_id);

-- NOTE: a GIN trigram index on `title` (for song search) is intentionally
-- deferred until song search is built — it would slow the ~1M-row backfill.
-- When needed:
--   CREATE INDEX idx_tracks_title_trgm ON tracks USING gin (title gin_trgm_ops);
