-- Charts tab: Song-specific RPCs.
-- track_ratings is keyed by (user_id, release_id, track_position).
-- track_title is stored directly on track_ratings (no join to tracks needed).

-- Top rated songs by avg score (min 1 rating)
CREATE OR REPLACE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(
  release_id     uuid,
  track_position int,
  track_title    text,
  artist         text,
  album_title    text,
  cover_url      text,
  avg_score      numeric,
  rating_count   bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    r.id,
    tr.track_position,
    tr.track_title,
    r.artist,
    r.title AS album_title,
    r.cover_url,
    ROUND(AVG(tr.score)::numeric, 2),
    COUNT(tr.id)
  FROM releases r
  JOIN track_ratings tr ON tr.release_id = r.id
  WHERE tr.score IS NOT NULL
  GROUP BY r.id, tr.track_position, tr.track_title, r.artist, r.title, r.cover_url
  HAVING COUNT(tr.id) >= 1
  ORDER BY AVG(tr.score) DESC
  LIMIT p_limit;
$$;

-- Most rated songs by rating count
CREATE OR REPLACE FUNCTION get_charts_most_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(
  release_id     uuid,
  track_position int,
  track_title    text,
  artist         text,
  album_title    text,
  cover_url      text,
  avg_score      numeric,
  rating_count   bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    r.id,
    tr.track_position,
    tr.track_title,
    r.artist,
    r.title AS album_title,
    r.cover_url,
    ROUND(AVG(tr.score) FILTER (WHERE tr.score IS NOT NULL)::numeric, 2),
    COUNT(tr.id)
  FROM releases r
  JOIN track_ratings tr ON tr.release_id = r.id
  GROUP BY r.id, tr.track_position, tr.track_title, r.artist, r.title, r.cover_url
  ORDER BY COUNT(tr.id) DESC
  LIMIT p_limit;
$$;

-- Trending songs: most new ratings in the past 7 days
CREATE OR REPLACE FUNCTION get_charts_trending_songs(p_limit int DEFAULT 10)
RETURNS TABLE(
  release_id     uuid,
  track_position int,
  track_title    text,
  artist         text,
  album_title    text,
  cover_url      text,
  new_count      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    r.id,
    tr.track_position,
    tr.track_title,
    r.artist,
    r.title AS album_title,
    r.cover_url,
    COUNT(tr.id)
  FROM releases r
  JOIN track_ratings tr ON tr.release_id = r.id
  WHERE tr.created_at > now() - interval '7 days'
  GROUP BY r.id, tr.track_position, tr.track_title, r.artist, r.title, r.cover_url
  ORDER BY COUNT(tr.id) DESC
  LIMIT p_limit;
$$;
