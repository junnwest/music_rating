-- Extend native-name (Korean/Japanese/Chinese script) display to Charts, Rankings,
-- Search, and the Taste page's Genre DNA card — the last remaining screens after
-- HomeView/ProfileView were wired earlier this session.
--
-- Also rebuilds get_user_genre_standings, which the schema renovation
-- (20260624000001_db_renovation.sql §0) dropped and never recreated — TasteView's
-- "Genre DNA" insight card has been silently absent for every user since then
-- (the RPC call is wrapped in `try?`, so the missing function just resolves to []).
-- Adapted from the pre-renovation version (20260621000001_taste_rpcs.sql) onto the
-- current schema: ratings.release_group_id (was release_id), release_groups.genres
-- text[] (was releases.genres comma-string). Output shape is unchanged, matching
-- what TasteView.swift's GenreStandingRow already expects.
--
-- Changing a function's RETURNS TABLE column list requires DROP FUNCTION first —
-- CREATE OR REPLACE cannot alter the return type. Safe to re-run.

-- ── Chart RPCs: add native_title (album) + artist_native ───────────────────────

DROP FUNCTION IF EXISTS get_charts_top_rated(int, text, int, int);
CREATE FUNCTION get_charts_top_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  HAVING COUNT(rt.id) >= 1
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_most_rated(int, text, int, int);
CREATE FUNCTION get_charts_most_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending(int);
CREATE FUNCTION get_charts_trending(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint,
              native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending_for_genres(text[], int);
CREATE FUNCTION get_charts_trending_for_genres(p_genres text[], p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint,
              native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_has_genre(rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_hidden_gems(int, text);
CREATE FUNCTION get_charts_hidden_gems(p_limit int DEFAULT 20, p_genre text DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

-- Not called from iOS yet, but rebuilt for consistency (same file, near-zero cost).
DROP FUNCTION IF EXISTS get_charts_controversial(int);
CREATE FUNCTION get_charts_controversial(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  HAVING COUNT(rt.id) >= 5
  ORDER BY STDDEV(rt.score) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- ── Song charts: add album_title_native + artist_native ─────────────────────────
-- Track titles have no native-script column anywhere in the schema (only release_groups
-- and artists do) — only the album title and artist name can show a native form here.

DROP FUNCTION IF EXISTS get_charts_top_rated_songs(int);
CREATE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
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
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
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
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.new_count, rg.native_title, a.name_native
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.new_count DESC
  LIMIT p_limit;
$$;

-- ── Silla leaderboard: add native_title + artist_native ─────────────────────────
-- `artists` is already touched for the p_country filter subquery; add a real join
-- for display purposes too.

DROP FUNCTION IF EXISTS get_silla_leaderboard(text, text, int, int);
CREATE FUNCTION get_silla_leaderboard(
  p_genre   text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_limit   int  DEFAULT 50,
  p_offset  int  DEFAULT 0
)
RETURNS TABLE (
  release_id     uuid,
  spotify_id     text,
  title          text,
  artist         text,
  cover_url      text,
  release_date   text,
  silla_score    float8,
  rating_norm    float8,
  prestige_score float8,
  rating_count   bigint,
  source_count   int,
  native_title   text,
  artist_native  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings WHERE score IS NOT NULL
    ),
    user_stats AS (
      SELECT user_id, AVG(score) AS mean_score, STDDEV(score) AS vol, COUNT(*) AS n
      FROM ratings WHERE score IS NOT NULL GROUP BY user_id
    ),
    calibrated AS (
      SELECT
        r.release_group_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75, 0.5), 5.0)
          ELSE r.score
        END AS cal_score
      FROM ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.score IS NOT NULL
        AND (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    ),
    rating_agg AS (
      SELECT
        release_group_id,
        (COUNT(*)::float8 / (COUNT(*) + 3)) * AVG(cal_score)
          + (3.0 / (COUNT(*) + 3)) * (SELECT c FROM global_mean) AS bayesian_score,
        COUNT(*)::bigint AS rating_count
      FROM calibrated GROUP BY release_group_id
    ),
    global_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)
          ),
          0.95
        ) AS prestige
      FROM (
        SELECT
          mb_release_group_id,
          source_tier,
          MAX(normalized_score)  AS tier_max,
          COUNT(DISTINCT source) AS tier_src_count
        FROM external_scores
        WHERE mb_release_group_id IS NOT NULL
          AND scope_country IS NULL
        GROUP BY mb_release_group_id, source_tier
      ) g
      GROUP BY mb_release_group_id
    ),
    all_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)
          ),
          0.95
        ) AS prestige
      FROM (
        SELECT
          mb_release_group_id,
          source_tier,
          MAX(normalized_score)  AS tier_max,
          COUNT(DISTINCT source) AS tier_src_count
        FROM external_scores
        WHERE mb_release_group_id IS NOT NULL
        GROUP BY mb_release_group_id, source_tier
      ) g
      GROUP BY mb_release_group_id
    ),
    scored AS (
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        CASE WHEN p_country IS NULL THEN gp.prestige ELSE ap.prestige END AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE WHEN p_country IS NULL THEN
          CASE
            WHEN ra.bayesian_score IS NULL THEN
              gp.prestige
            ELSE
              (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
                * gp.prestige
              + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
                * ((ra.bayesian_score - 0.5) / 4.5)
          END
        ELSE
          CASE
            WHEN ra.bayesian_score IS NULL THEN
              ap.prestige
            ELSE
              (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
                * ap.prestige
              + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
                * ((ra.bayesian_score - 0.5) / 4.5)
          END
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN global_prestige gp ON gp.mb_release_group_id = rg.mb_release_group_id
      LEFT JOIN all_prestige    ap ON ap.mb_release_group_id = rg.mb_release_group_id
      WHERE (
          (p_country IS NULL     AND gp.prestige IS NOT NULL)
          OR
          (p_country IS NOT NULL AND ap.prestige IS NOT NULL)
        )
        AND (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    )
  SELECT
    rg.id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = rg.id AND rel.is_canonical = true LIMIT 1) AS spotify_id,
    rg.title,
    rg.artist_display                                AS artist,
    rg.cover_url,
    rg.first_release_date::text                      AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)     AS silla_score,
    s.r_norm                                         AS rating_norm,
    s.p_score                                        AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id AND s.mb_rg_id IS NOT NULL
    ), 0)                                            AS source_count,
    rg.native_title,
    a.name_native                                    AS artist_native
  FROM scored s
  JOIN release_groups rg ON rg.id = s.rg_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int)
  TO anon, authenticated, service_role;

-- ── search_release_groups: add artist_native (album native_title already returned) ──

DROP FUNCTION IF EXISTS search_release_groups(text, int, text, vector);
CREATE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  artist_display     text,
  cover_url          text,
  native_title       text,
  release_group_type text,
  first_release_date text,
  artist_native      text
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text,
         a.name_native
  FROM release_groups rg
  LEFT JOIN artists a ON a.id = rg.primary_artist_id, nq
  WHERE rg.release_group_type IN ('album', 'ep')
    AND nq.qn <> ''
    AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
    AND (
         normalize_text(rg.title)                       LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.artist_display)              LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(rg.native_title, ''))  LIKE '%' || nq.qn || '%'
      OR word_similarity(nq.ql, lower(rg.title))          > 0.5
      OR word_similarity(nq.ql, lower(rg.artist_display)) > 0.5
    )
  ORDER BY (
      CASE WHEN normalize_text(rg.title) = nq.qn
             OR normalize_text(rg.artist_display) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(rg.title)          LIKE nq.qn || '%' THEN 500
           WHEN normalize_text(rg.artist_display) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(rg.title)),
        word_similarity(nq.ql, lower(rg.artist_display))
      ) * 1000
    + coalesce(rg.prestige_score, 0) * 2
    + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
           THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_release_groups(text, int, text, vector)
  TO anon, authenticated, service_role;

-- ── get_user_genre_standings: rebuilt on the current schema (was dropped, never recreated) ──

DROP FUNCTION IF EXISTS get_user_genre_standings(uuid);
CREATE FUNCTION get_user_genre_standings(p_user_id uuid)
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
            TRIM(g)                              AS genre,
            ROUND(AVG(rt.score)::numeric, 2)     AS user_avg,
            COUNT(*)::bigint                     AS user_count
        FROM ratings rt
        JOIN release_groups rg ON rg.id = rt.release_group_id,
             LATERAL unnest(rg.genres) AS g
        WHERE rt.user_id    = p_user_id
          AND rt.score      IS NOT NULL
          AND rg.genres     IS NOT NULL
          AND TRIM(g) <> ''
        GROUP BY TRIM(g)
        HAVING COUNT(*) >= 5
    ),
    community_by_genre AS (
        SELECT
            TRIM(g)                              AS genre,
            ROUND(AVG(rt.score)::numeric, 2)     AS community_avg,
            COUNT(*)::bigint                     AS community_count
        FROM ratings rt
        JOIN release_groups rg ON rg.id = rt.release_group_id,
             LATERAL unnest(rg.genres) AS g
        WHERE rt.score      IS NOT NULL
          AND rg.genres     IS NOT NULL
          AND TRIM(g) <> ''
        GROUP BY TRIM(g)
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

GRANT EXECUTE ON FUNCTION get_user_genre_standings(uuid)
  TO anon, authenticated, service_role;
