-- Phase 3 display cutover safety net (GENRE_TAXONOMY.md §4): snapshot every album's
-- displayed genres[] BEFORE scripts/derive-display-genres.ts re-derives them from
-- release_genres. Makes the cutover fully reversible, and is the exact source to
-- regenerate the provenance-less `legacy` release_genres rows from if ever needed
-- (they are retired as MusicBrainz coverage arrives).
--
-- Restore (all albums):
--   UPDATE release_groups rg SET genres = b.genres
--   FROM release_groups_genres_backup b WHERE b.release_group_id = rg.id;
--
-- Idempotent: re-running never overwrites an existing snapshot (ON CONFLICT DO NOTHING),
-- so the backup always holds the PRE-cutover value.

CREATE TABLE IF NOT EXISTS release_groups_genres_backup (
  release_group_id uuid PRIMARY KEY,
  genres           text[],
  backed_up_at     timestamptz NOT NULL DEFAULT now()
);

-- Internal table: RLS on with no policies → service role only (not exposed to clients).
ALTER TABLE release_groups_genres_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO release_groups_genres_backup (release_group_id, genres)
SELECT id, genres FROM release_groups WHERE genres IS NOT NULL
ON CONFLICT (release_group_id) DO NOTHING;
