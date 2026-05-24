-- Add artist_ko to releases (title_ko + name_ko on artists already exist from 20260524000001).
-- Trigram indexes on all Korean columns so ILIKE searches stay fast.

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS artist_ko text;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_releases_title_ko_trgm
  ON releases USING GIN (title_ko gin_trgm_ops)
  WHERE title_ko IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_releases_artist_ko_trgm
  ON releases USING GIN (artist_ko gin_trgm_ops)
  WHERE artist_ko IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artists_name_ko_trgm
  ON artists USING GIN (name_ko gin_trgm_ops)
  WHERE name_ko IS NOT NULL;
