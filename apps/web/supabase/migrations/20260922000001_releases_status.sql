-- releases.status — persist MusicBrainz's release status instead of discarding it.
--
-- THE BUG. MusicBrainz marks every RELEASE (edition) with a status: Official, Promotion, Bootleg,
-- Pseudo-Release, Cancelled, Withdrawn. mb-client.ts parses it correctly and pickRepresentative()
-- uses it to choose WHICH edition to store -- and then it is thrown away. It is never persisted,
-- and shouldIngestRG() never consults it, so a release group whose every edition is a bootleg gets
-- ingested and displayed as a normal album.
--
-- Reported 2026-09-22 from the app: "Ye" showed 87 albums where the MusicBrainz website shows 13,
-- because the website filters to official by default and we did not filter at all. "YE LIVE IN
-- MEXICO" is a single Bootleg edition typed `album` with no `live` secondary type, so the existing
-- type-based SKIP_SECONDARY filter could not see it. Same root cause as Nirvana's "Greatest Hits
-- Broadcast Collection" outranking Nevermind.
--
-- SCALE. Sampled 8 artists holding 40+ release groups each: 65 of 512 release groups (13%) have no
-- official edition at all, ranging 0% (OJ da Juiceman) to 29% (Disturbed). Against ~495,000 rows
-- that is on the order of 60,000 unofficial release groups already ingested.
--
-- Nullable on purpose: existing rows predate this and stay NULL until the cleanup pass backfills
-- them. NULL therefore means "unknown", never "official" — queries must not treat it as a pass.

ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS status text;

COMMENT ON COLUMN public.releases.status IS
  'MusicBrainz release status: Official | Promotion | Bootleg | Pseudo-Release | Cancelled | Withdrawn. NULL = not yet known (pre-2026-09-22 rows), which is NOT the same as Official.';

-- Supports "does this release group have any official edition?", the question the ingest filter and
-- the cleanup pass both ask. Partial, because that is the only status worth seeking by.
CREATE INDEX IF NOT EXISTS idx_releases_official_by_group
  ON public.releases (release_group_id)
  WHERE status = 'Official';
