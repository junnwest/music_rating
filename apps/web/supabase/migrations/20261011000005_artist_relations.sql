-- ════════════════════════════════════════════════════════════════════════════
-- artist_relations: personas and groups, so one artist's page shows their work
-- 2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE SYMPTOM. Our MF DOOM page looked nothing like Spotify's or YouTube Music's.
-- It listed 74 releases and omitted Madvillainy, Vaudeville Villain, Take Me to
-- Your Leader, The Mouse and the Mask and Key to the Kuffs -- i.e. most of what
-- he is actually known for -- while leading with unofficial mashups.
--
-- THE CAUSE. Those albums are credited to Madvillain, Viktor Vaughn, King
-- Geedorah, DANGERDOOM and JJ DOOM, each a separate artist row with no link back
-- to MF DOOM. get_artist_release_groups already unions primary_artist_id with
-- release_group_artists, so a credit WOULD surface -- but we never imported
-- MusicBrainz's artist-artist relationships, so every persona was an island.
--
-- MB'S SHAPE, which decides this table's shape. Fetched live:
--   MF DOOM --is person--> Daniel Dumile          (the human)
--   MF DOOM --member of band--> Madvillain, DANGERDOOM, JJ DOOM, NehruvianDOOM,
--                               DOOMSTARKS, WestsideDoom, Monsta Island Czars…
-- Viktor Vaughn and King Geedorah are NOT related to MF DOOM directly; they hang
-- off Daniel Dumile. So the persona graph is two hops through the person, and the
-- backfill resolves that closure and stores FLAT symmetric 'persona' pairs --
-- MF DOOM <-> Viktor Vaughn directly -- so the read path stays one hop and the
-- RPC stays cheap. 'group' is stored one-directional (member -> group).
--
-- WHY NOT FAKE release_group_artists ROWS. That would have needed no migration,
-- but it would assert DOOM is a credited artist on records where he is not --
-- corrupting credit data to fix a navigation problem, and permanently
-- indistinguishable from a real credit.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists artist_relations (
  artist_id         uuid not null references artists(id) on delete cascade,
  related_artist_id uuid not null references artists(id) on delete cascade,
  -- 'persona': the same human under another name (symmetric; both rows written).
  -- 'group'  : artist_id is a member of related_artist_id (directional).
  relation_type     text not null check (relation_type in ('persona', 'group')),
  source            text not null default 'musicbrainz',
  created_at        timestamptz not null default now(),
  primary key (artist_id, related_artist_id, relation_type),
  constraint artist_relations_no_self check (artist_id <> related_artist_id)
);

create index if not exists artist_relations_artist_idx on artist_relations (artist_id);

-- Discography = own credits + credits of every related artist, one hop.
create or replace function public.get_artist_release_groups(p_artist_id uuid, lim integer default 500)
returns table(id uuid, title text, artist_display text, cover_url text, native_title text,
              release_group_type text, first_release_date text)
language sql
stable
as $function$
  SELECT u.id, u.title, u.artist_display, u.cover_url,
         u.native_title, u.release_group_type, u.first_release_date
  FROM (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM release_groups rg
    WHERE rg.primary_artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM release_groups rg
    JOIN release_group_artists rga ON rga.release_group_id = rg.id
    WHERE rga.artist_id = p_artist_id
    UNION
    -- Personas and groups: Madvillainy under MF DOOM, Vaudeville Villain under
    -- MF DOOM, and vice versa. UNION already de-duplicates.
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM artist_relations ar
    JOIN release_groups rg ON rg.primary_artist_id = ar.related_artist_id
    WHERE ar.artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM artist_relations ar
    JOIN release_group_artists rga ON rga.artist_id = ar.related_artist_id
    JOIN release_groups rg ON rg.id = rga.release_group_id
    WHERE ar.artist_id = p_artist_id
  ) u
  ORDER BY
    CASE lower(coalesce(u.release_group_type, ''))
      WHEN 'album'       THEN 0
      WHEN 'ep'          THEN 1
      WHEN 'single'      THEN 2
      WHEN 'soundtrack'  THEN 3
      WHEN 'compilation' THEN 4
      WHEN 'live'        THEN 5
      ELSE 6
    END,
    u.first_release_date DESC NULLS LAST
  LIMIT lim;
$function$;

grant execute on function public.get_artist_release_groups(uuid, integer) to anon, authenticated, service_role;
