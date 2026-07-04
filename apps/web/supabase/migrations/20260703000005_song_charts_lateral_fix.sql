-- Fix: song chart RPCs (get_charts_top_rated_songs, get_charts_most_rated_songs,
-- get_charts_trending_songs) timed out under the anon role (57014 statement timeout),
-- discovered while adding native-name columns in 20260703000004.
--
-- Root cause was NOT the new artists join — it's the pre-existing `loc` subquery's
-- `ORDER BY rtk.recording_id, rel.is_canonical DESC`. That sort key spans BOTH joined
-- tables (release_tracks + releases), so Postgres has no way to satisfy it from an
-- index on either table alone — it must materialize and sort the ENTIRE
-- release_tracks ⋈ releases join (every track of every release in the catalog) before
-- it can pick one row per recording_id. No index fixes a cross-table sort key.
--
-- Fix: scope that "find this recording's canonical release" lookup to only the
-- recordings that already have ratings (the `stats` CTE — tiny relative to the full
-- catalog) via a LATERAL join with `LIMIT 1`, instead of computing `loc` over the whole
-- catalog up front. This turns an O(catalog size) sort into O(rated recordings) indexed
-- lookups via the existing idx_release_tracks_recording(recording_id) index.
--
-- Output shape is unchanged from 20260703000004 — this only fixes execution time.

DROP FUNCTION IF EXISTS get_charts_top_rated_songs(int);
CREATE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native
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
              album_title_native text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native
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
              cover_url text, new_count bigint, album_title_native text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, COUNT(*) AS new_count
    FROM track_ratings WHERE created_at > now() - interval '7 days' GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.new_count, rg.native_title, a.name_native
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
