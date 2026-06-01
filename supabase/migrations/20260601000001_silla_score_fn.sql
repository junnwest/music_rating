-- get_calibrated_bayesian_scores(release_ids uuid[])
--
-- Computes a Bayesian-damped, user-calibrated average rating for each requested
-- release. Called by the leaderboard and album-page ranking code.
--
-- Algorithm
-- ---------
-- 1. Per-user z-score calibration (users with ≥5 ratings and stdev ≥0.1).
--    Maps each user's scores to a shared scale centred at 2.75 with
--    effective width 0.75, so a lenient "everything is 5★" user and a harsh
--    "everything is 2★" user contribute equally.
--      calibrated = clamp(2.75 + clamp(z, -2.5, 2.5) * 0.75, 0.5, 5.0)
--    Users below the threshold keep their raw score.
--
-- 2. Bayesian damping toward the global prior (μ=2.75, m=10 pseudo-votes).
--    Albums with few ratings are pulled toward the global average, preventing
--    a single 5★ from landing an unknown album at the top.
--      bayesian = (v / (v + m)) * mean_calibrated + (m / (v + m)) * 2.75
--
-- Returns one row per release_id that has ≥1 rating; releases with no ratings
-- are absent (callers fall back to PRIOR = 2.75 for those).
--
-- SECURITY DEFINER so it reads all ratings regardless of caller RLS policies.

CREATE OR REPLACE FUNCTION get_calibrated_bayesian_scores(release_ids uuid[])
RETURNS TABLE(release_id uuid, bayesian_score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Step 1: per-user statistics across all of their ratings
  user_stats AS (
    SELECT
      user_id,
      AVG(score)    AS mean,
      STDDEV(score) AS std
    FROM ratings
    WHERE score IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) >= 5
  ),

  -- Step 2: calibrate each rating for the requested releases
  calibrated AS (
    SELECT
      r.release_id,
      CASE
        WHEN us.std IS NOT NULL AND us.std >= 0.1
          THEN GREATEST(0.5, LEAST(5.0,
               2.75 + GREATEST(-2.5, LEAST(2.5,
                 (r.score - us.mean) / us.std
               )) * 0.75
             ))
        ELSE r.score
      END AS cal_score
    FROM ratings r
    LEFT JOIN user_stats us ON r.user_id = us.user_id
    WHERE r.release_id = ANY(release_ids)
      AND r.score IS NOT NULL
  ),

  -- Step 3: per-release aggregate
  agg AS (
    SELECT
      release_id,
      AVG(cal_score)       AS mean_cal,
      COUNT(*)::numeric    AS v
    FROM calibrated
    GROUP BY release_id
  )

  -- Step 4: Bayesian damping  (prior μ = 2.75, pseudo-count m = 10)
  SELECT
    agg.release_id,
    ROUND(
      (agg.v / (agg.v + 10)) * agg.mean_cal
      + (10    / (agg.v + 10)) * 2.75,
    4) AS bayesian_score
  FROM agg;
$$;

-- Grant execute to all Supabase roles
GRANT EXECUTE ON FUNCTION get_calibrated_bayesian_scores(uuid[])
  TO anon, authenticated, service_role;

-- Supporting index: speeds up the per-user calibration CTE
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON ratings(user_id);
