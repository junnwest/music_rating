-- dynamic_prestige_weight: prestige dominates until ratings are meaningful.
--
-- Problem: albums with 1-2 user ratings and 0 prestige sources appeared at
-- the top of the leaderboard (LEMONADE by aespa at 8.9 with 0 sources).
-- The fixed 0.55/0.45 rating/prestige split gave too much weight to a single
-- enthusiastic rating.
--
-- Fix:
--   1. Require prestige to appear: drop the "OR ratings exist" escape hatch
--      from the WHERE clause. An album must have external prestige to rank.
--
--   2. Dynamic blend: rating weight ramps from 0 → 0.55 as rating_count grows.
--      Prestige weight = 1 − rating_weight, so prestige starts at 100% and
--      asymptotes to 45% (same long-run split as before, just earned gradually).
--
--      rating_weight = LEAST(0.55 × n / (n + 50), 0.55)
--
--        n =   0 ratings → rating_weight = 0.00  (100% prestige)
--        n =   5 ratings → rating_weight = 0.05  ( 95% prestige)
--        n =  10 ratings → rating_weight = 0.09  ( 91% prestige)
--        n =  50 ratings → rating_weight = 0.28  ( 72% prestige)
--        n = 100 ratings → rating_weight = 0.37  ( 63% prestige)
--        n = 200 ratings → rating_weight = 0.44  ( 56% prestige)
--        n = ∞           → rating_weight = 0.55  ( 45% prestige)

CREATE OR REPLACE FUNCTION get_silla_leaderboard(
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
  source_count   int
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
    -- Global prestige: only sources with no country scope (Grammy, Mercury, RS500, etc.)
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
    -- Country prestige: all sources (global + scoped).
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
          -- Global: requires global prestige. Ratings blend in gradually.
          CASE
            WHEN ra.bayesian_score IS NULL THEN
              gp.prestige
            ELSE
              -- rating_weight ramps 0 → 0.55 as n grows; prestige = 1 − rating_weight
              (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
                * gp.prestige
              + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
                * ((ra.bayesian_score - 0.5) / 4.5)
          END
        ELSE
          -- Country: same formula, uses all-source prestige.
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
          -- Prestige required to appear — no prestige, no ranking.
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
    ), 0)                                            AS source_count
  FROM scored s
  JOIN release_groups rg ON rg.id = s.rg_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int)
  TO anon, authenticated, service_role;
