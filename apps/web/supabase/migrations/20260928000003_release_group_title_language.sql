-- Non-English tracklist-title language per release group (genre × language axis,
-- GENRE_TAXONOMY.md work log 2026-09-28; lib/genres/language.ts).
--
-- Source: MusicBrainz release `text-representation.language` (ISO 639-3), the
-- most common value across the group's Official editions, written by
-- scripts/mb-ingest.ts on every ingest / freshness re-poll (no extra MB calls).
--
-- This is the language of the TRACK TITLES, not the lyrics: a Korean rap release
-- with English titles is 'eng'. So only NON-English values are stored — they are
-- real evidence of a non-English album — and NULL means "no evidence", never
-- "English".
--
-- Additive; the ingest writer skips itself until this is applied.
ALTER TABLE release_groups
  ADD COLUMN IF NOT EXISTS title_language text;

ALTER TABLE release_groups
  DROP CONSTRAINT IF EXISTS chk_release_groups_title_language;
ALTER TABLE release_groups
  ADD CONSTRAINT chk_release_groups_title_language
  CHECK (title_language IS NULL OR (title_language ~ '^[a-z]{3}$' AND title_language NOT IN ('eng', 'mul', 'zxx', 'und', 'mis')));

COMMENT ON COLUMN release_groups.title_language IS
  'MB tracklist-title language (ISO 639-3) when non-English; NULL = no evidence (not "English"). Not lyric language.';
