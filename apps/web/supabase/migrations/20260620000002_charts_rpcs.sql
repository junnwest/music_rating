-- Charts tab RPCs
-- All rankings are derived purely from user ratings — no voting/tierlist data.

-- Community pulse: total ratings, community avg, ratings submitted today
CREATE OR REPLACE FUNCTION get_charts_pulse()
RETURNS TABLE(total_ratings bigint, avg_score numeric, today_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COUNT(*) FILTER (WHERE score IS NOT NULL OR elo_score IS NOT NULL),
    ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 2),
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
  FROM ratings;
$$;

-- Top rated: albums ranked by avg community score (min 5 ratings)
-- Supports optional genre and year-range filters.
CREATE OR REPLACE FUNCTION get_charts_top_rated(
  p_limit       int     DEFAULT 20,
  p_genre       text    DEFAULT NULL,
  p_year_start  int     DEFAULT NULL,
  p_year_end    int     DEFAULT NULL
)
RETURNS TABLE(
  release_id   uuid,
  title        text,
  artist       text,
  cover_url    text,
  avg_score    numeric,
  rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    r.id,
    r.title,
    r.artist,
    r.cover_url,
    ROUND(AVG(rt.score)::numeric, 2),
    COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL     OR r.genres ILIKE '%' || p_genre || '%')
    AND (p_year_start IS NULL OR EXTRACT(YEAR FROM r.release_date::date)::int >= p_year_start)
    AND (p_year_end   IS NULL OR EXTRACT(YEAR FROM r.release_date::date)::int <= p_year_end)
  GROUP BY r.id, r.title, r.artist, r.cover_url
  HAVING COUNT(rt.id) >= 1
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

-- Most rated: albums ranked by number of ratings received
CREATE OR REPLACE FUNCTION get_charts_most_rated(
  p_limit      int  DEFAULT 20,
  p_genre      text DEFAULT NULL,
  p_year_start int  DEFAULT NULL,
  p_year_end   int  DEFAULT NULL
)
RETURNS TABLE(
  release_id   uuid,
  title        text,
  artist       text,
  cover_url    text,
  avg_score    numeric,
  rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    r.id,
    r.title,
    r.artist,
    r.cover_url,
    ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2),
    COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE (p_genre IS NULL     OR r.genres ILIKE '%' || p_genre || '%')
    AND (p_year_start IS NULL OR EXTRACT(YEAR FROM r.release_date::date)::int >= p_year_start)
    AND (p_year_end   IS NULL OR EXTRACT(YEAR FROM r.release_date::date)::int <= p_year_end)
  GROUP BY r.id, r.title, r.artist, r.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- Trending: most new ratings in the past 7 days (global)
CREATE OR REPLACE FUNCTION get_charts_trending(p_limit int DEFAULT 10)
RETURNS TABLE(
  release_id uuid,
  title      text,
  artist     text,
  cover_url  text,
  new_count  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.id, r.title, r.artist, r.cover_url, COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE rt.created_at > now() - interval '7 days'
  GROUP BY r.id, r.title, r.artist, r.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- Trending filtered to a set of genres (For You personalization)
CREATE OR REPLACE FUNCTION get_charts_trending_for_genres(
  p_genres text[],
  p_limit  int DEFAULT 10
)
RETURNS TABLE(
  release_id uuid,
  title      text,
  artist     text,
  cover_url  text,
  new_count  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.id, r.title, r.artist, r.cover_url, COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (
      SELECT 1 FROM unnest(p_genres) g
      WHERE r.genres ILIKE '%' || g || '%'
    )
  GROUP BY r.id, r.title, r.artist, r.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- User's top genres by rating volume (for For You personalization)
CREATE OR REPLACE FUNCTION get_user_top_genres(p_user_id uuid, p_limit int DEFAULT 3)
RETURNS TABLE(genre text, count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    TRIM(g.genre) AS genre,
    COUNT(*)      AS count
  FROM ratings rt
  JOIN releases r ON r.id = rt.release_id,
       LATERAL unnest(string_to_array(r.genres, ',')) AS g(genre)
  WHERE rt.user_id = p_user_id
    AND r.genres IS NOT NULL
    AND TRIM(g.genre) <> ''
  GROUP BY TRIM(g.genre)
  ORDER BY count DESC
  LIMIT p_limit;
$$;

-- Hidden gems: high avg score but below the popularity floor (3–9 ratings)
CREATE OR REPLACE FUNCTION get_charts_hidden_gems(
  p_limit int  DEFAULT 20,
  p_genre text DEFAULT NULL
)
RETURNS TABLE(
  release_id   uuid,
  title        text,
  artist       text,
  cover_url    text,
  avg_score    numeric,
  rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.id, r.title, r.artist, r.cover_url,
    ROUND(AVG(rt.score)::numeric, 2),
    COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR r.genres ILIKE '%' || p_genre || '%')
  GROUP BY r.id, r.title, r.artist, r.cover_url
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

-- Controversial: highest rating variance (std dev), min 5 ratings
CREATE OR REPLACE FUNCTION get_charts_controversial(p_limit int DEFAULT 20)
RETURNS TABLE(
  release_id   uuid,
  title        text,
  artist       text,
  cover_url    text,
  avg_score    numeric,
  rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT r.id, r.title, r.artist, r.cover_url,
    ROUND(AVG(rt.score)::numeric, 2),
    COUNT(rt.id)
  FROM releases r
  JOIN ratings rt ON rt.release_id = r.id
  WHERE rt.score IS NOT NULL
  GROUP BY r.id, r.title, r.artist, r.cover_url
  HAVING COUNT(rt.id) >= 5
  ORDER BY STDDEV(rt.score) DESC NULLS LAST
  LIMIT p_limit;
$$;
