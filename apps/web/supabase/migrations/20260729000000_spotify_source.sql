-- Allow source='spotify' on catalog rows.
--
-- WHY: resolve-empty-artists.ts recovers zero-release artists using MusicBrainz's own URL
-- relationships as a hard identity link. Spotify is by far the most common such link (35 of 42
-- hard links in a 500-artist sample; 6 of 10 in a separate 120-artist dry run), so the Spotify
-- ingest path is most of that tier's coverage — including "Skyminhyuk", the artist that surfaced
-- this whole class. But release_groups/releases/recordings each CHECK source against
-- ('musicbrainz','itunes','deezer','listenbrainz','manual'), so every Spotify write would have
-- failed with a constraint violation.
--
-- Provenance matters beyond labelling: reconcile-itunes-mb.ts finds un-linked rows BY source and
-- fills in mb_release_group_id before MusicBrainz can create a competing row. A row we could not
-- tag would be invisible to that safety net and would become a cross-source duplicate the moment
-- MB catalogued the same album. So the tag is what makes the ingest safe, not decoration.
--
-- Widened with NOT VALID + VALIDATE so the rewrite never takes a long exclusive lock on the
-- ~474k release_groups / ~471k releases rows: existing rows already satisfy the wider set (it is
-- a strict superset), and VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock.

ALTER TABLE release_groups DROP CONSTRAINT IF EXISTS release_groups_source_check;
ALTER TABLE release_groups ADD CONSTRAINT release_groups_source_check
  CHECK (source IS NULL OR source = ANY (ARRAY['musicbrainz','itunes','deezer','listenbrainz','manual','spotify'])) NOT VALID;
ALTER TABLE release_groups VALIDATE CONSTRAINT release_groups_source_check;

ALTER TABLE releases DROP CONSTRAINT IF EXISTS releases_source_check;
ALTER TABLE releases ADD CONSTRAINT releases_source_check
  CHECK (source IS NULL OR source = ANY (ARRAY['musicbrainz','itunes','deezer','listenbrainz','manual','spotify'])) NOT VALID;
ALTER TABLE releases VALIDATE CONSTRAINT releases_source_check;

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_source_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_source_check
  CHECK (source IS NULL OR source = ANY (ARRAY['musicbrainz','itunes','deezer','listenbrainz','manual','spotify'])) NOT VALID;
ALTER TABLE recordings VALIDATE CONSTRAINT recordings_source_check;
