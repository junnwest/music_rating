-- Taste page: per-user genre standing vs community average.
-- Requires >= 5 user ratings in a genre to surface it (signal quality floor).
-- Returns the user's top genres by rating volume (most data = most reliable insight).

CREATE OR REPLACE FUNCTION get_user_genre_standings(p_user_id uuid)
RETURNS TABLE(
    genre           text,
    user_avg        numeric,
    community_avg   numeric,
    user_count      bigint,
    community_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    WITH user_by_genre AS (
        SELECT
            TRIM(g.genre)                        AS genre,
            ROUND(AVG(rt.score)::numeric, 2)     AS user_avg,
            COUNT(*)::bigint                     AS user_count
        FROM ratings rt
        JOIN releases r ON r.id = rt.release_id,
             LATERAL unnest(string_to_array(r.genres, ',')) AS g(genre)
        WHERE rt.user_id    = p_user_id
          AND rt.score      IS NOT NULL
          AND r.genres      IS NOT NULL
          AND TRIM(g.genre) <> ''
        GROUP BY TRIM(g.genre)
        HAVING COUNT(*) >= 5
    ),
    community_by_genre AS (
        SELECT
            TRIM(g.genre)                        AS genre,
            ROUND(AVG(rt.score)::numeric, 2)     AS community_avg,
            COUNT(*)::bigint                     AS community_count
        FROM ratings rt
        JOIN releases r ON r.id = rt.release_id,
             LATERAL unnest(string_to_array(r.genres, ',')) AS g(genre)
        WHERE rt.score      IS NOT NULL
          AND r.genres      IS NOT NULL
          AND TRIM(g.genre) <> ''
        GROUP BY TRIM(g.genre)
    )
    SELECT
        u.genre,
        u.user_avg,
        c.community_avg,
        u.user_count,
        c.community_count
    FROM user_by_genre u
    JOIN community_by_genre c USING (genre)
    ORDER BY u.user_count DESC
    LIMIT 3;
$$;
