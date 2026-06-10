-- Computes per-user calibrated ratings and returns Bayesian-damped scores.
--
-- Calibration: each user's rating is z-scored against their own mean/volatility
-- (std dev) and mapped back to the [0.5, 5] scale centred at 2.75. Users with
-- fewer than 5 ratings, or very low spread, are left uncalibrated.
--
-- Bayesian damping: score = (v/(v+m)) * R_calibrated + (m/(v+m)) * C_global
-- with m = 10.  Albums with few ratings pull toward the global mean; the
-- formula naturally handles 0-rating releases (they receive exactly C_global).
--
-- Return type: one row per release that has ≥1 rating in the supplied array.
-- Releases with no ratings are absent; callers should treat them as bayesian_score = C.
CREATE OR REPLACE FUNCTION get_calibrated_bayesian_scores(release_ids uuid[])
RETURNS TABLE(
  release_id   uuid,
  bayesian_score float8,
  rating_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
    user_stats AS (
      SELECT
        user_id,
        AVG(score)    AS mean_score,
        STDDEV(score) AS vol,
        COUNT(*)      AS n
      FROM ratings
      GROUP BY user_id
    ),
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings
    ),
    calibrated AS (
      SELECT
        r.release_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
            2.75
            + LEAST(GREATEST(
                (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                -2.5
              ), 2.5
            ) * 0.75,
            0.5
          ), 5.0)
          ELSE r.score
        END AS cal_score
      FROM ratings r
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.release_id = ANY(release_ids)
    ),
    agg AS (
      SELECT
        release_id,
        AVG(cal_score)   AS mean_cal,
        COUNT(*)::bigint AS v
      FROM calibrated
      GROUP BY release_id
    )
  SELECT
    a.release_id,
    -- Bayesian damping: m = 10, prior = global mean
    (a.v::float8 / (a.v + 10)) * a.mean_cal
      + (10.0           / (a.v + 10)) * g.c  AS bayesian_score,
    a.v                                        AS rating_count
  FROM agg a, global_mean g;
$$;
