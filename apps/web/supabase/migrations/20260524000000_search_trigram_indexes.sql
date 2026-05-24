-- Trigram indexes for the DB-fallback search path (used when the Spotify
-- circuit breaker is open). Without these, `ILIKE '%query%'` on releases
-- and artists falls back to a sequential scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_releases_title_trgm
  ON releases USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_releases_artist_trgm
  ON releases USING GIN (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_artists_name_trgm
  ON artists USING GIN (name gin_trgm_ops);
