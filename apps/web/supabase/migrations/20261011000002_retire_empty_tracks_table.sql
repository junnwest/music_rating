-- ════════════════════════════════════════════════════════════════════════════
-- Retire the empty `tracks` table.  2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- `tracks` holds 0 rows against 837,310 release groups. It was created by
-- 20260618000000_tracks_table.sql to be filled from releases.tracklist by
-- scripts/backfill-tracks.ts, which never ran to completion. Real tracklists
-- live in `release_tracks` (7.65M rows), joined release_id -> releases ->
-- release_group_id.
--
-- WHY THIS IS WORTH A MIGRATION. An empty table is worse than a missing one:
-- a query against it succeeds and returns nothing, so the caller cannot tell
-- "no tracks" from "wrong table". The ManiaDB same-date tie-breaker counted our
-- tracks via `tracks`, got 0 for every album, and reported "0 ties broken" while
-- looking like it worked -- the data to break those ties was in release_tracks
-- the whole time. Removing the name removes the trap.
--
-- RENAMED, NOT DROPPED. It is empty, so nothing is lost either way, but a rename
-- is reversible in one statement and leaves evidence of what happened. Anything
-- still selecting from `tracks` now fails loudly instead of silently reading
-- zero rows -- which is the entire point. Only scripts/backfill-tracks.ts
-- referenced it; that script is marked retired in the same commit.
--
-- To reverse: ALTER TABLE tracks_legacy_unused RENAME TO tracks;
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tracks'
  ) then
    raise notice 'tracks: already absent, nothing to do';
    return;
  end if;

  -- Refuse if it somehow has data: this migration is only safe on an empty table.
  if (select count(*) from public.tracks) > 0 then
    raise exception 'tracks is not empty (% rows) -- aborting rather than hiding live data',
      (select count(*) from public.tracks);
  end if;

  alter table public.tracks rename to tracks_legacy_unused;
  raise notice 'tracks -> tracks_legacy_unused (was empty)';
end $$;
