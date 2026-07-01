-- prestige_formula_v2: fix weighted-average dilution in get_silla_leaderboard.
--
-- Problem: adding a lower-scoring source to an album LOWERED its prestige,
-- because the weighted-average denominator grew while the numerator didn't.
-- e.g. Beenzino's Nowitzki (IZM 0.70 + KHA 0.72 + KMA 0.62 + Rhythmer 0.75)
-- scored 0.701 — below B-Free's Free the Beast (Rhythmer 0.75 only) at 0.75.
--
-- Fix: two changes to both global_prestige and all_prestige CTEs:
--
--   1. Per-tier max: take MAX(normalized_score) within each tier before averaging
--      across tiers. Two sources in the same tier compound upward to the best
--      one — they never dilute each other.
--
--   2. Floor guarantee: GREATEST(weighted_avg, MAX(tier_max)) — no source
--      can ever make an album rank lower than its best single-source score.
--
--   3. Diversity bonus: multiply by (1 + 0.04 × LEAST(source_count − 1, 4)).
--      Each additional distinct source adds 4% on top, capped at +16%.
--      An album with 4 confirming sources scores ≈12% above an album with 1.
--
-- These three rules are source-agnostic — they apply identically to global
-- Grammy/RS500 data, Korean award sources, and the new Japanese Mino list.

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
    -- Formula: weighted avg of per-tier-max scores × source-breadth bonus, floored at
    -- best single score so no source ever hurts.
    global_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)   -- floor: no additional source can lower the score
          ),
          0.95              -- cap: reserve room above 0.95 for future multi-source kings
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

    -- Country prestige: all sources (global + scoped). Same formula as above.
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
        CASE
          WHEN p_country IS NULL THEN
            CASE
              WHEN ra.bayesian_score IS NULL AND gp.prestige IS NULL THEN NULL
              WHEN ra.bayesian_score IS NULL THEN gp.prestige
              WHEN gp.prestige IS NULL       THEN (ra.bayesian_score - 0.5) / 4.5
              ELSE 0.55 * ((ra.bayesian_score - 0.5) / 4.5) + 0.45 * gp.prestige
            END
          ELSE
            CASE
              WHEN ra.bayesian_score IS NULL AND ap.prestige IS NULL THEN NULL
              WHEN ra.bayesian_score IS NULL THEN ap.prestige
              WHEN ap.prestige IS NULL       THEN (ra.bayesian_score - 0.5) / 4.5
              ELSE 0.55 * ((ra.bayesian_score - 0.5) / 4.5) + 0.45 * ap.prestige
            END
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN global_prestige gp ON gp.mb_release_group_id = rg.mb_release_group_id
      LEFT JOIN all_prestige    ap ON ap.mb_release_group_id = rg.mb_release_group_id
      WHERE (
          (p_country IS NULL     AND (gp.prestige IS NOT NULL OR ra.release_group_id IS NOT NULL))
          OR
          (p_country IS NOT NULL AND (ap.prestige IS NOT NULL OR ra.release_group_id IS NOT NULL))
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
