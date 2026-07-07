-- Surface real users before bots in "who to follow" suggestions.
--
-- Why: bots average ~68 ratings each vs ~1 for the 17 real users today
-- (10,234 bot ratings vs 18 real), so ordering purely by rating_count always
-- put bots first. Not hiding bots (still shown, just after) -- this app is
-- pre-launch and thin on real users, so bots still need to be a visible
-- fallback; this just stops them from crowding out every real person.

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
    GROUP BY p.id, p.username, p.display_name, p.avatar_url, p.is_bot
    ORDER BY p.is_bot ASC, rating_count DESC
    LIMIT 30;
$$;
