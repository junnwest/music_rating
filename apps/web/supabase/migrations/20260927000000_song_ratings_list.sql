-- Song rating list mirrors the album rating list: reviews first, then score-only ratings.
DROP FUNCTION IF EXISTS get_song_ratings(uuid, text, int, int);
CREATE FUNCTION get_song_ratings(
  p_recording_id uuid, p_sort text DEFAULT 'top', p_limit int DEFAULT 20, p_offset int DEFAULT 0
) RETURNS TABLE (
  track_rating_id uuid, user_id uuid, username text, display_name text, avatar_url text,
  is_verified boolean, score numeric, review_text text, created_at timestamptz,
  likes bigint, replies bigint, liked_by_me boolean, author_followers bigint,
  rank_score double precision, total_count bigint
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH viewer AS (SELECT auth.uid() AS id),
  song_avg AS (
    SELECT avg(score)::double precision AS a FROM track_ratings
    WHERE recording_id = p_recording_id AND score IS NOT NULL
  ),
  base AS (
    SELECT r.id, r.user_id, r.score,
           NULLIF(btrim(r.review_text), '') AS review_text,
           r.created_at,
           p.username, p.display_name, p.avatar_url, COALESCE(p.is_verified, false) AS is_verified
    FROM track_ratings r
    JOIN profiles p ON p.id = r.user_id
    CROSS JOIN viewer v
    WHERE r.recording_id = p_recording_id
      AND (r.score IS NOT NULL OR length(btrim(COALESCE(r.review_text, ''))) > 0)
      AND r.user_id IS DISTINCT FROM v.id
      AND p.deactivated_at IS NULL
      AND _sj_can_view(p.id, v.id, COALESCE(p.catalog_visibility, p.profile_visibility))
      AND NOT _comment_hidden_for(r.user_id, v.id, NULL)
      AND (p_sort <> 'following' OR EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.following_id = r.user_id))
  ),
  enriched AS (
    SELECT b.*,
      (b.review_text IS NOT NULL) AS has_text,
      (SELECT count(*) FROM track_rating_likes l WHERE l.track_rating_id = b.id) AS likes,
      (SELECT count(*) FROM track_rating_comments c WHERE c.track_rating_id = b.id) AS replies,
      EXISTS (SELECT 1 FROM track_rating_likes l, viewer v WHERE l.track_rating_id = b.id AND l.user_id = v.id) AS liked_by_me,
      (SELECT count(*) FROM follows f WHERE f.following_id = b.user_id) AS followers,
      (SELECT count(*) FROM track_ratings r2 WHERE r2.user_id = b.user_id) AS author_ratings,
      EXISTS (SELECT 1 FROM follows f, viewer v WHERE f.follower_id = v.id AND f.following_id = b.user_id) AS followed,
      lower(regexp_replace(COALESCE(b.review_text, ''), '[^[:alnum:]]+', '', 'g')) AS norm
    FROM base b
  ),
  ranked AS (
    SELECT e.*,
      _comment_rank(e.likes, e.replies, length(COALESCE(e.review_text, '')), e.followers, e.author_ratings,
                    e.is_verified, extract(epoch FROM now() - e.created_at) / 86400.0,
                    abs(e.score::double precision - (SELECT a FROM song_avg)), e.followed) AS rs
    FROM enriched e
  ),
  deduped AS (
    -- Near-duplicate short comments collapse under 'top'; score-only rows
    -- (empty norm) are never collapsed.
    SELECT rk.*, row_number() OVER (
      PARTITION BY CASE WHEN length(rk.norm) BETWEEN 1 AND 24 THEN rk.norm ELSE rk.id::text END
      ORDER BY rk.rs DESC, rk.id) AS dup_rank
    FROM ranked rk
  )
  SELECT d.id, d.user_id, d.username, d.display_name, d.avatar_url, d.is_verified, d.score,
         d.review_text, d.created_at, d.likes, d.replies, d.liked_by_me, d.followers, d.rs,
         count(*) OVER () AS total_count
  FROM deduped d
  WHERE d.dup_rank = 1 OR p_sort <> 'top'
  ORDER BY
    d.has_text DESC,
    CASE WHEN p_sort = 'top' THEN d.rs END DESC NULLS LAST,
    CASE WHEN p_sort = 'highest' THEN d.score END DESC NULLS LAST,
    CASE WHEN p_sort = 'lowest' THEN d.score END ASC NULLS LAST,
    d.created_at DESC, d.id
  LIMIT least(greatest(p_limit, 1), 50) OFFSET greatest(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION get_song_ratings(uuid, text, int, int) TO anon, authenticated;
