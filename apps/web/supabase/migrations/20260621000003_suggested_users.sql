-- Returns active users (ordered by rating volume) that the requesting user
-- is not already following, excluding themselves.
CREATE OR REPLACE FUNCTION get_suggested_users(p_user_id uuid)
RETURNS TABLE(
    id           uuid,
    username     text,
    display_name text,
    avatar_url   text,
    rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        p.id,
        p.username,
        p.display_name,
        p.avatar_url,
        COUNT(r.id)::bigint AS rating_count
    FROM profiles p
    JOIN ratings r ON r.user_id = p.id
    WHERE p.id <> p_user_id
      AND p.id NOT IN (
          SELECT following_id FROM follows WHERE follower_id = p_user_id
      )
    GROUP BY p.id, p.username, p.display_name, p.avatar_url
    ORDER BY rating_count DESC
    LIMIT 30;
$$;
