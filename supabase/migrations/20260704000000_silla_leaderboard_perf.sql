-- Fix: get_silla_leaderboard statement timeout (iOS "랭킹" card showing
-- "No ranking data yet." — user report, 2026-07-04).
--
-- Root cause: `release_groups` has grown to ~290,000 rows since this function
-- was last rebuilt. The `scored` CTE was written as:
--
--   FROM release_groups rg
--   LEFT JOIN global_prestige gp ON gp.mb_release_group_id = rg.mb_release_group_id
--   LEFT JOIN all_prestige    ap ON ap.mb_release_group_id = rg.mb_release_group_id
--   WHERE (p_country IS NULL AND gp.prestige IS NOT NULL)
--      OR (p_country IS NOT NULL AND ap.prestige IS NOT NULL)
--
-- i.e. release_groups (290k rows) is the driving side of the join, even though
-- the WHERE clause requires a matching prestige row anyway — only ~3,000
-- release_groups actually have one (external_scores has 2,983 rows with
-- mb_release_group_id set). The LEFT JOIN + later-applied OR-filter is
-- logically equivalent to an INNER JOIN, but written this way it defeats the
-- planner's outer-join-elimination in practice, so it ends up scanning/joining
-- against the full 290k-row table instead of starting from the ~3,000-row
-- prestige set. That's slow enough to hit the anon role's statement_timeout,
-- which get_silla_leaderboard's caller (TasteView... no, RankingsView's
-- SillaLeaderboardCard) swallows via `try?` into an empty array, rendering
-- as "No ranking data yet." with no visible error.
--
-- Fix: restructure `scored` to start FROM the (small) prestige-derived set and
-- INNER JOIN into release_groups via the unique index on mb_release_group_id.
-- Same filter semantics, same output — just makes the small-to-large join
-- direction explicit instead of relying on the planner to infer it through an
-- OR'd LEFT JOIN filter. No other CTEs or output columns change.

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
    -- Whichever prestige set applies to this call (mutually exclusive on
    -- p_country), small (~3k rows) — this is now the driving side of the join.
    prestige AS (
      SELECT mb_release_group_id, prestige FROM global_prestige WHERE p_country IS NULL
      UNION ALL
      SELECT mb_release_group_id, prestige FROM all_prestige WHERE p_country IS NOT NULL
    ),
    scored AS (
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        p.prestige               AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            p.prestige
          ELSE
            -- rating_weight ramps 0 → 0.55 as n grows; prestige = 1 − rating_weight
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * p.prestige
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM prestige p
      JOIN release_groups rg ON rg.mb_release_group_id = p.mb_release_group_id
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      WHERE (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
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
  TO anon, authenticated;
