-- Allow 'deezer' as a provenance source (Deezer fallback for genuinely MB-missing artists —
-- mb-deezer-fallback.ts). Deezer rows carry ISRC, so they can auto-link to MB later.
-- Additive (widens CHECK allow-lists) → safe. Apply via the Supabase SQL editor.

ALTER TABLE release_groups DROP CONSTRAINT IF EXISTS release_groups_source_check;
ALTER TABLE release_groups ADD CONSTRAINT release_groups_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'deezer', 'listenbrainz', 'manual'));

ALTER TABLE releases DROP CONSTRAINT IF EXISTS releases_source_check;
ALTER TABLE releases ADD CONSTRAINT releases_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'deezer', 'listenbrainz', 'manual'));

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_source_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'deezer', 'listenbrainz', 'manual'));

ALTER TABLE artist_external_ids DROP CONSTRAINT IF EXISTS artist_external_ids_source_check;
ALTER TABLE artist_external_ids ADD CONSTRAINT artist_external_ids_source_check
  CHECK (source IN ('itunes', 'spotify', 'musicbrainz', 'discogs', 'deezer'));
