-- Replace Korean-specific _ko columns with language-agnostic native columns.
-- All _ko columns are empty (no data written yet), so dropping them is safe.
-- native_language is an ISO 639-1 code ('ko', 'ja', 'zh', etc.); null for English-primary artists.

-- Dropping a column automatically drops its indexes in Postgres.
ALTER TABLE releases DROP COLUMN IF EXISTS title_ko;
ALTER TABLE releases DROP COLUMN IF EXISTS artist_ko;
ALTER TABLE artists  DROP COLUMN IF EXISTS name_ko;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS title_native    text,
  ADD COLUMN IF NOT EXISTS artist_native   text,
  ADD COLUMN IF NOT EXISTS native_language text;

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS name_native     text,
  ADD COLUMN IF NOT EXISTS native_language text;

-- Rename name_ko in the queue table for consistency
ALTER TABLE artist_ingestion_queue
  RENAME COLUMN name_ko TO name_native;

-- Trigram indexes for search (language-agnostic — works for any CJK script)
CREATE INDEX IF NOT EXISTS idx_releases_title_native_trgm
  ON releases USING GIN (title_native gin_trgm_ops)
  WHERE title_native IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_releases_artist_native_trgm
  ON releases USING GIN (artist_native gin_trgm_ops)
  WHERE artist_native IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artists_name_native_trgm
  ON artists USING GIN (name_native gin_trgm_ops)
  WHERE name_native IS NOT NULL;
