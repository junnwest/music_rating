-- Charts RPC rebuild (post-renovation) — RENOVATION_PLAN step 5.
--
-- The renovation dropped every Charts RPC (they JOINed the old `releases`/`ratings.release_id`).
-- iOS `RankingsView` was NOT updated and still decodes the OLD column names, so these
-- rebuilds are DROP-IN COMPATIBLE: they query the new schema (`release_groups`, `ratings.
-- release_group_id`, `recordings`, `track_ratings.recording_id`) but alias the output back
-- to what Swift expects — `release_groups.id AS release_id`, `artist_display AS artist`, and
-- for songs the canonical-release `position AS track_position` + `recordings.title AS
-- track_title`. No iOS change needed. (Contract confirmed with the Mac/iOS session 2026-06-26.)
--
-- Notes:
--   • `release_groups.genres` is now text[] (was a comma string) → genre match via unnest,
--     hyphen-tolerant so the iOS slug "hip-hop" matches the stored "hip hop".
--   • `first_release_date` may be partial → take the leading 4 chars for the year filter.
--   • Charts surface MANUAL ratings only (`ratings.score` / `track_ratings.score` NOT NULL);
--     Instinct `elo_score` is intentionally not charted (matches pre-renovation behaviour).
--
-- Safe to re-run (CREATE OR REPLACE). Apply via the Supabase SQL editor.

-- ── genre match helper (text[] + hyphen/space tolerant) ────────────────────────
CREATE OR REPLACE FUNCTION _rg_has_genre(p_genres text[], p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(coalesce(p_genres, ARRAY[]::text[])) g
    WHERE g ILIKE '%' || p_slug || '%'
       OR g ILIKE '%' || replace(p_slug, '-', ' ') || '%'
  );
$$;

-- ── community pulse ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_charts_pulse()
RETURNS TABLE(total_ratings bigint, avg_score numeric, today_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COUNT(*) FILTER (WHERE score IS NOT NULL OR elo_score IS NOT NULL),
    ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 2),
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
  FROM ratings;
$$;

-- ── top rated albums (min 1 rating; optional genre + year-range filters) ────────
CREATE OR REPLACE FUNCTION get_charts_top_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  HAVING COUNT(rt.id) >= 1
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

-- ── most rated albums ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_charts_most_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- ── trending albums (most new ratings in the last 7 days) ───────────────────────
CREATE OR REPLACE FUNCTION get_charts_trending(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.created_at > now() - interval '7 days'
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- ── trending within a set of genres (For You) ──────────────────────────────────
CREATE OR REPLACE FUNCTION get_charts_trending_for_genres(p_genres text[], p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_has_genre(rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- ── hidden gems (high avg, below the popularity floor: 3–9 ratings) ────────────
CREATE OR REPLACE FUNCTION get_charts_hidden_gems(p_limit int DEFAULT 20, p_genre text DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

-- ── controversial (highest rating variance, min 5) — parity; not called by iOS yet ─
CREATE OR REPLACE FUNCTION get_charts_controversial(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  HAVING COUNT(rt.id) >= 5
  ORDER BY STDDEV(rt.score) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- ── user's top genres by rating volume (For You seed) ──────────────────────────
CREATE OR REPLACE FUNCTION get_user_top_genres(p_user_id uuid, p_limit int DEFAULT 3)
RETURNS TABLE(genre text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT TRIM(g) AS genre, COUNT(*) AS count
  FROM ratings rt
  JOIN release_groups rg ON rg.id = rt.release_group_id,
       LATERAL unnest(rg.genres) AS g
  WHERE rt.user_id = p_user_id AND rg.genres IS NOT NULL AND TRIM(g) <> ''
  GROUP BY TRIM(g)
  ORDER BY count DESC
  LIMIT p_limit;
$$;

-- ═══ SONG charts ═══════════════════════════════════════════════════════════════
-- Song ratings now key on recordings.id. Swift still identifies a song as
-- (release_id, track_position), so we map each rated recording → ONE placement: its
-- position on the group's canonical release (preferred) and the parent release_group id.
-- `loc` picks one row per recording (canonical first) to avoid fan-out in the aggregate.

CREATE OR REPLACE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url, s.avg_score, s.rating_count
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  ORDER BY s.avg_score DESC, s.rating_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_charts_most_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url, s.avg_score, s.rating_count
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  ORDER BY s.rating_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_charts_trending_songs(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text, cover_url text, new_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, COUNT(*) AS new_count
    FROM track_ratings WHERE created_at > now() - interval '7 days' GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url, s.new_count
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  ORDER BY s.new_count DESC
  LIMIT p_limit;
$$;
