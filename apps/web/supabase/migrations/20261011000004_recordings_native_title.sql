-- ════════════════════════════════════════════════════════════════════════════
-- Korean song titles: recordings.native_title + release_groups.maniadb_album_id
-- 2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE GAP. `release_groups` has had `native_title` for a long time, so an album
-- can show 킁 instead of "Keung". `recordings` has no equivalent column, so a
-- song cannot hold a Korean title AT ALL -- not "we have not filled it in", but
-- "there is nowhere to put it". C JAMM's 킁 renders its album name correctly and
-- then lists 가끔 난 날 안 믿어, I Laugh Now, Slay, You Better, Love It, Error,
-- Oh God: one Korean track title and the rest English, with no way to store the
-- Korean forms even once we know them.
--
-- NOT EVERY ENGLISH TRACK TITLE IS WRONG. Korean hip-hop routinely ships genuine
-- English song titles, so a backfill that overwrites them would destroy correct
-- data. The column is therefore nullable with no default, and the backfill that
-- fills it must run report-only first and write only where the stored title is
-- not already Hangul and the source's is -- never as a bulk translation pass.
--
-- maniadb_album_id, AND WHY IT BELONGS IN THE SAME MIGRATION. The ManiaDB sweep
-- matched 2,451 albums and discarded every ManiaDB album id it matched against.
-- Track titles come from ManiaDB's ALBUM endpoint (/api/album/[album_id]/),
-- which needs exactly that id -- so without storing it, filling song titles
-- means re-running the whole 8,163-artist search sweep (~34h) purely to recover
-- ids we already had. Stored as a column to match `mb_release_group_id`, which
-- is how this table already holds a source id.
-- ════════════════════════════════════════════════════════════════════════════

alter table recordings    add column if not exists native_title     text;
alter table release_groups add column if not exists maniadb_album_id text;

-- Partial: only a minority of rows will ever carry these, and both are looked up
-- by "which rows do we still need?" rather than scanned whole.
create index if not exists recordings_native_title_idx
  on recordings (id) where native_title is not null;

create index if not exists release_groups_maniadb_album_id_idx
  on release_groups (maniadb_album_id) where maniadb_album_id is not null;

comment on column recordings.native_title is
  'Song title in the artist''s native script (Korean etc). NULL = unknown, not "none". '
  'Never overwrite a genuine English title with a translation.';
comment on column release_groups.maniadb_album_id is
  'ManiaDB album_id this row was matched to, so /api/album/[id]/ tracklists can be '
  'fetched later without repeating the artist-search sweep.';
