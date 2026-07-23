-- Re-apply the LATERAL-join perf fix from 20260703000005_song_charts_lateral_fix.sql
-- to the song chart RPCs (get_charts_top_rated_songs, get_charts_most_rated_songs,
-- get_charts_trending_songs).
--
-- 20260706000002_charts_release_type.sql redefined all three functions to add the
-- album_release_type/native-name columns, but was evidently written against the
-- pre-fix version of these functions -- it reintroduced the exact slow `loc` CTE
-- (a `DISTINCT ON (rtk.recording_id) ... ORDER BY rtk.recording_id, rel.is_canonical`
-- over the full release_tracks JOIN releases) that 0703000005 had already replaced.
-- That sort key spans both joined tables, so no index can satisfy it -- Postgres has
-- to materialize and sort every track of every release in the catalog before picking
-- one row per recording, on every single Charts tab load. Measured live (iOS,
-- 2026-07-23): ~8.4s per song-chart RPC vs ~0.4s for the equivalent album RPCs.
--
-- Fix, again: scope the canonical-release lookup to only the (few) recordings that
-- already have ratings via a LATERAL join with LIMIT 1, using the existing
-- idx_release_tracks_recording(recording_id) index -- O(rated recordings) instead of
-- O(catalog). Output shape unchanged from 20260706000002 (album_release_type + native
-- columns kept); this only fixes execution time.

DROP FUNCTION IF EXISTS get_charts_top_rated_songs(int);
CREATE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.avg_score DESC, s.rating_count DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_most_rated_songs(int);
CREATE FUNCTION get_charts_most_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.rating_count DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending_songs(int);
CREATE FUNCTION get_charts_trending_songs(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, new_count bigint, album_title_native text, artist_native text,
              album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, COUNT(*) AS new_count
    FROM track_ratings WHERE created_at > now() - interval '7 days' GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.new_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.new_count DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_charts_top_rated_songs(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_most_rated_songs(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_trending_songs(int) TO anon, authenticated, service_role;
