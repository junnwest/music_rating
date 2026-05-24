-- Additive columns to support multi-source catalog ingestion.
-- Does NOT restructure PKs — releases.id stays as Spotify text ID.
-- iTunes-only records use a generated UUID stored as text in releases.id.

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS itunes_id        bigint UNIQUE,
  ADD COLUMN IF NOT EXISTS canonical_source text,
  ADD COLUMN IF NOT EXISTS cover_source     text,
  ADD COLUMN IF NOT EXISTS title_ko         text,
  ADD COLUMN IF NOT EXISTS upc              text UNIQUE;

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS itunes_artist_id bigint UNIQUE,
  ADD COLUMN IF NOT EXISTS name_ko          text;

-- Index for iTunes ID lookups
CREATE INDEX IF NOT EXISTS idx_releases_itunes_id ON releases (itunes_id) WHERE itunes_id IS NOT NULL;
