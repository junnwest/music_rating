-- Home v4: bounded, diverse retrieval BEFORE ranking. All functions use the
-- caller's RLS (never service-role visibility) and explicit public/human gates.
CREATE OR REPLACE FUNCTION get_home_feed_candidates(
  p_tab text DEFAULT 'explore', p_artists uuid[] DEFAULT '{}',
  p_genres text[] DEFAULT '{}', p_before timestamptz DEFAULT now(),
  p_before_key text DEFAULT NULL, p_limit integer DEFAULT 40
) RETURNS TABLE(kind text, id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH recent AS MATERIALIZED (
  SELECT r.id, r.user_id, r.created_at, r.review_text,
    rg.primary_artist_id, rg.genres
  FROM ratings r JOIN profiles p ON p.id = r.user_id
  JOIN release_groups rg ON rg.id = r.release_group_id
  WHERE r.created_at <= p_before AND p.deactivated_at IS NULL
    AND (p_tab = 'following' OR (p.is_bot = false AND p.profile_visibility = 'Public'
      AND r.user_id IS DISTINCT FROM auth.uid()))
    AND (p_tab <> 'following' OR EXISTS (SELECT 1 FROM follows f
      WHERE f.follower_id = auth.uid() AND f.following_id = r.user_id))
    AND (p_before_key IS NULL OR r.created_at < p_before
      OR (r.created_at = p_before AND 'rating:' || r.id::text > p_before_key))
  ORDER BY r.created_at DESC, r.id LIMIT 600
), reviewed AS MATERIALIZED (
  SELECT r.id, r.user_id, r.created_at, r.review_text,
    rg.primary_artist_id, rg.genres
  FROM ratings r JOIN profiles p ON p.id = r.user_id
  JOIN release_groups rg ON rg.id = r.release_group_id
  WHERE p_tab = 'explore' AND r.created_at <= p_before
    AND p.is_bot = false AND p.profile_visibility = 'Public' AND p.deactivated_at IS NULL
    AND r.user_id IS DISTINCT FROM auth.uid() AND length(trim(r.review_text)) > 0
  ORDER BY r.created_at DESC, r.id LIMIT 300
), personal AS MATERIALIZED (
  SELECT r.id, r.user_id, r.created_at, r.review_text,
    rg.primary_artist_id, rg.genres
  FROM ratings r JOIN profiles p ON p.id = r.user_id
  JOIN release_groups rg ON rg.id = r.release_group_id
  WHERE p_tab = 'explore' AND auth.uid() IS NOT NULL AND r.created_at <= p_before
    AND p.is_bot = false AND p.profile_visibility = 'Public' AND p.deactivated_at IS NULL
    AND r.user_id <> auth.uid()
    AND (rg.primary_artist_id = ANY(p_artists) OR rg.genres && p_genres
      OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = auth.uid() AND f.following_id = r.user_id))
  ORDER BY r.created_at DESC, r.id LIMIT 300
), rating_pool AS (
  SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id) AS author_position
  FROM (SELECT * FROM recent UNION SELECT * FROM reviewed UNION SELECT * FROM personal) r
), shares AS (
  SELECT s.id, s.created_at,
    row_number() OVER (PARTITION BY s.user_id ORDER BY s.created_at DESC, s.id) AS author_position
  FROM mix_shares s JOIN profiles p ON p.id = s.user_id JOIN mixes m ON m.id = s.mix_id
  WHERE s.created_at <= p_before AND m.is_public AND p.deactivated_at IS NULL
    AND (p_tab = 'following' OR (p.is_bot = false AND p.profile_visibility = 'Public'
      AND s.user_id IS DISTINCT FROM auth.uid()))
    AND (p_tab <> 'following' OR EXISTS (SELECT 1 FROM follows f
      WHERE f.follower_id = auth.uid() AND f.following_id = s.user_id))
    AND (p_before_key IS NULL OR s.created_at < p_before
      OR (s.created_at = p_before AND 'mix:' || s.id::text > p_before_key))
  ORDER BY s.created_at DESC, s.id LIMIT 150
), pool AS (
  SELECT 'rating'::text kind, id, created_at FROM rating_pool
    WHERE p_tab = 'following' OR author_position <= 12
  UNION ALL
  SELECT 'mix', id, created_at FROM shares
    WHERE p_tab = 'following' OR author_position <= 6
)
SELECT kind, id, created_at FROM pool
ORDER BY created_at DESC, kind || ':' || id::text
LIMIT CASE WHEN p_tab = 'following' THEN greatest(1, least(p_limit, 100)) ELSE 750 END;
$$;
GRANT EXECUTE ON FUNCTION get_home_feed_candidates(text, uuid[], text[], timestamptz, text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_home_feed_social(p_rating_ids uuid[] DEFAULT '{}', p_share_ids uuid[] DEFAULT '{}')
RETURNS TABLE(post_key text, likes bigint, comments bigint, participants bigint, liked boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH posts AS (
  SELECT 'rating:' || r.id::text AS key, r.id, r.user_id, 'rating' AS kind FROM ratings r WHERE r.id = ANY(p_rating_ids)
  UNION ALL
  SELECT 'mix:' || s.id::text, s.id, s.user_id, 'mix' FROM mix_shares s WHERE s.id = ANY(p_share_ids)
), reactions AS (
  SELECT 'rating:' || l.rating_id::text AS key, l.user_id, 'like' AS action FROM rating_likes l WHERE l.rating_id = ANY(p_rating_ids)
  UNION ALL
  SELECT 'rating:' || c.rating_id::text, c.user_id, 'comment' FROM rating_comments c WHERE c.rating_id = ANY(p_rating_ids)
  UNION ALL
  SELECT 'mix:' || l.mix_share_id::text, l.user_id, 'like' FROM mix_share_likes l WHERE l.mix_share_id = ANY(p_share_ids)
  UNION ALL
  SELECT 'mix:' || c.mix_share_id::text, c.user_id, 'comment' FROM mix_share_comments c WHERE c.mix_share_id = ANY(p_share_ids)
), human AS (
  SELECT r.* FROM reactions r JOIN profiles p ON p.id = r.user_id
  WHERE p.is_bot = false AND p.deactivated_at IS NULL
)
SELECT p.key,
  count(*) FILTER (WHERE h.action = 'like'), count(*) FILTER (WHERE h.action = 'comment'),
  count(DISTINCT h.user_id) FILTER (WHERE h.user_id <> p.user_id),
  coalesce(bool_or(h.action = 'like' AND h.user_id = auth.uid()), false)
FROM posts p LEFT JOIN human h ON h.key = p.key GROUP BY p.key;
$$;
GRANT EXECUTE ON FUNCTION get_home_feed_social(uuid[], uuid[]) TO anon, authenticated;

-- One idempotent observation per post/session. No review text or music history.
CREATE TABLE IF NOT EXISTS feed_impressions (
  viewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  post_key text NOT NULL CHECK (post_key ~ '^(rating|mix):[0-9a-f-]{36}$'),
  position integer NOT NULL CHECK (position >= 0 AND position < 10000),
  bucket text NOT NULL,
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, session_id, post_key)
);
CREATE INDEX IF NOT EXISTS feed_impressions_viewer_time ON feed_impressions(viewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feed_impressions_retention ON feed_impressions(created_at);
ALTER TABLE feed_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY feed_impressions_read_own ON feed_impressions FOR SELECT TO authenticated
  USING (viewer_id = (SELECT auth.uid()));
-- Writes go through the API after validating session membership and position.
REVOKE ALL ON feed_impressions FROM anon, authenticated;
GRANT SELECT ON feed_impressions TO authenticated;
GRANT ALL ON feed_impressions TO service_role;

CREATE INDEX IF NOT EXISTS ratings_feed_order ON ratings(created_at DESC, id);
CREATE INDEX IF NOT EXISTS mix_shares_feed_order ON mix_shares(created_at DESC, id);
