-- Aggregate follower counts for the authors in the cached explore candidate pool.
-- The service-role feed route calls this once instead of downloading follow rows.
CREATE OR REPLACE FUNCTION get_feed_author_followers(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, followers bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT f.following_id, count(*)
  FROM follows f
  WHERE f.following_id = ANY(p_user_ids)
  GROUP BY f.following_id;
$$;
REVOKE ALL ON FUNCTION get_feed_author_followers(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_feed_author_followers(uuid[]) TO service_role;
