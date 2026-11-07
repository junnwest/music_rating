-- ════════════════════════════════════════════════════════════════════════════
-- release_group_mbid_aliases: remember a MusicBrainz release group we merged away
-- 2026-10-12
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE SYMPTOM. Merging a duplicate release group does not stay merged. mb-ingest
-- upserts on mb_release_group_id, so once the losing row is deleted its MBID is
-- simply absent, and the artist's next full re-ingest inserts it again.
--
-- WHY IT MATTERS NOW. Until now the duplicates were twins WE made (an iTunes row
-- beside a MusicBrainz row), and keeping the MusicBrainz row is enough. But 97
-- same-title/type/date sets are duplicates INSIDE MusicBrainz: two release groups
-- with different MBIDs holding the very same recordings (Woody Herman "Swing Low,
-- Sweet Clarinet", Andy Williams "Greatest Hits"). Probed live, neither MBID
-- redirects to the other, so MusicBrainz will keep serving both, and whichever
-- row we delete comes back.
--
-- THE SHAPE. One row per MBID that must not be ingested as its own group, naming
-- the release group that already represents it. mb-ingest loads the set per
-- artist and skips those groups; dedup-by-duration writes a row for every
-- MusicBrainz-sourced group it removes.
--
-- Idempotent: safe to re-run on either device.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists release_group_mbid_aliases (
  mb_release_group_id text primary key,
  -- The surviving row. Cascade: if that row is itself removed nothing represents the MBID any
  -- more, so it must become ingestable again (dedup re-points aliases before it deletes).
  release_group_id    uuid not null references release_groups(id) on delete cascade,
  reason              text not null default 'duplicate',
  created_at          timestamptz not null default now()
);

create index if not exists release_group_mbid_aliases_rg_idx on release_group_mbid_aliases (release_group_id);

-- Pipeline-internal: read and written with the service role only.
alter table release_group_mbid_aliases enable row level security;
