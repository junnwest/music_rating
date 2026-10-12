-- ════════════════════════════════════════════════════════════════════════════
-- release_groups.is_official — demote bootlegs instead of leading with them
-- 2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE SYMPTOM. MF DOOM's page opened with Super What?, Metaphorical Villainy
-- (MF DOOM & Nujabes), Czarface Meets Metal Face, Metal Chambers (MF DOOM vs.
-- Wu-Tang Clan) and DoomStarks -- a mashup, a mashup, and a project that was
-- never actually released. Below them sat 20 compilations: Doomilation, The
-- Doomilation Bootleg Vol. 2, Best of MF, Supervillain Unmasked, The Lost Relics
-- of Dumile I-VI, The Acapella Archive, Since Last Week 1-3. None of these are on
-- Spotify or YouTube Music. MusicBrainz catalogues bootlegs on purpose; streaming
-- services do not, which is most of why the two discographies disagree.
--
-- WHY THE EXISTING COLUMN COULD NOT ANSWER IT. `releases.status` already exists
-- and already carries MB's 'Official' | 'Promotion' | 'Bootleg', and
-- mb-client.browseReleases already parses it. But it is 62% NULL (519,197 of
-- 837,798) and there is not a single 'Bootleg' row in the database -- every MF
-- DOOM release is NULL, including Operation: Doomsday and MM..FOOD. So the signal
-- is absent rather than wrong, and deriving officialness from it today would
-- label the entire catalogue unofficial.
--
-- HENCE A THREE-STATE FLAG ON THE GROUP. NULL means "not established", and NULL
-- must sort with official, not against it: the whole catalogue is NULL right now,
-- and a default that demotes unknowns would bury everything. Only an explicit
-- false is pushed down. backfill-release-status-mb.ts sets it per artist, costing
-- one MB call per release group -- which is why it is targeted and not a
-- catalogue-wide sweep.
-- ════════════════════════════════════════════════════════════════════════════

alter table release_groups add column if not exists is_official boolean;

comment on column release_groups.is_official is
  'true = at least one Official release; false = releases exist and NONE is Official (bootleg/promo); '
  'NULL = not established. NULL sorts WITH official — most of the catalogue is NULL.';

create index if not exists release_groups_unofficial_idx
  on release_groups (primary_artist_id) where is_official is false;

-- Discography: own credits + credited + personas/groups, with known-unofficial last.
create or replace function public.get_artist_release_groups(p_artist_id uuid, lim integer default 500)
returns table(id uuid, title text, artist_display text, cover_url text, native_title text,
              release_group_type text, first_release_date text)
language sql
stable
as $function$
  SELECT u.id, u.title, u.artist_display, u.cover_url,
         u.native_title, u.release_group_type, u.first_release_date
  FROM (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
           rg.release_group_type, rg.first_release_date::text, rg.is_official
    FROM release_groups rg
    WHERE rg.primary_artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
           rg.release_group_type, rg.first_release_date::text, rg.is_official
    FROM release_groups rg
    JOIN release_group_artists rga ON rga.release_group_id = rg.id
    WHERE rga.artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
           rg.release_group_type, rg.first_release_date::text, rg.is_official
    FROM artist_relations ar
    JOIN release_groups rg ON rg.primary_artist_id = ar.related_artist_id
    WHERE ar.artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
           rg.release_group_type, rg.first_release_date::text, rg.is_official
    FROM artist_relations ar
    JOIN release_group_artists rga ON rga.artist_id = ar.related_artist_id
    JOIN release_groups rg ON rg.id = rga.release_group_id
    WHERE ar.artist_id = p_artist_id
  ) u
  ORDER BY
    -- Known-unofficial last. NULL is "unknown", so it ranks with official.
    CASE WHEN u.is_official IS FALSE THEN 1 ELSE 0 END,
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
