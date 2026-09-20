-- get_artist_release_groups: stop the 60-row cut from hiding an artist's actual albums.
--
-- THE BUG. The function ordered by first_release_date DESC and returned at most `lim` (60) rows.
-- The catalog ingests everything MusicBrainz has, including bootlegs, broadcast compilations and
-- posthumous reissues, and those are by definition the NEWEST things a legacy artist has. So the
-- 60 newest rows are junk and the canonical work falls off the end:
--
--   Nirvana      174 release groups → 60 shown → 0 of Bleach / Nevermind / In Utero visible.
--                Top of the list was "Rare Studio Tracks 1991" (2024-12-27) and
--                "Greatest Hits Broadcast Collection" (2024-04-01).
--   Ed Sheeran    95 release groups → 60 shown → 1 of +, x, ÷, = visible.
--
-- The data was never missing — the page could not see it. 1,572 artists have more than 60 release
-- groups, so this silently truncated every one of them.
--
-- THE FIX, two parts:
--
--   1. Order by TYPE FIRST, date second. Albums/EPs/singles rank above compilations, live records
--      and everything else, so whatever the limit cuts, it cuts filler rather than an artist's
--      records. Within a tier it stays newest-first, as before.
--
--   2. Raise the default limit 60 → 500. Only 28 artists in the catalog exceed 400 release groups
--      (largest is 1,094), so in practice nothing is truncated at all any more; the ordering is the
--      backstop for the handful that still are. ~500 narrow rows is a small payload, and the page
--      re-sorts and buckets client-side anyway (GROUP_ORDER / byDate in artist/[id]/page.tsx), so
--      this changes what is AVAILABLE to the page, not how it is displayed.
--
-- Note the type tiers cannot fully separate bootlegs: "Greatest Hits Broadcast Collection" is typed
-- `album` in MusicBrainz, so it still sorts with real albums. Distinguishing those needs a quality
-- signal (prestige_score is only on 1,589 rows today), not a type. Raising the limit is what
-- actually guarantees Nevermind is present; the ordering only decides who wins when a cut happens.
--
-- Idempotent: CREATE OR REPLACE, same signature and return type, so re-running is safe.

CREATE OR REPLACE FUNCTION public.get_artist_release_groups(p_artist_id uuid, lim integer DEFAULT 500)
 RETURNS TABLE(id uuid, title text, artist_display text, cover_url text, native_title text, release_group_type text, first_release_date text)
 LANGUAGE sql
 STABLE
AS $function$
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
  ) u
  ORDER BY
    CASE lower(coalesce(u.release_group_type, ''))
      WHEN 'album'      THEN 0
      WHEN 'ep'         THEN 1
      WHEN 'single'     THEN 2
      WHEN 'soundtrack' THEN 3
      WHEN 'compilation' THEN 4
      WHEN 'live'       THEN 5
      ELSE 6
    END,
    u.first_release_date DESC NULLS LAST
  LIMIT lim;
$function$;
