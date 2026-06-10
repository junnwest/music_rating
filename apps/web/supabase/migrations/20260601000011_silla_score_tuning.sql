-- Silla Score tuning + rated-album surfacing.
--
-- Two changes vs. 20260601000003:
--   1. Bayesian damping pseudo-count reduced from m=10 to m=3. With m=10 and the
--      small early-stage rating set, nearly every album collapsed to the global
--      mean, so the rating half of the Silla Score carried almost no ordering
--      signal ("ratings don't affect rankings"). m=3 lets a handful of ratings
--      actually move an album while still damping 1-rating flukes.
--   2. New get_silla_rating_scores(release_ids, genre, year): same calibrated
--      Bayesian rating, but the candidate set also includes any rated release that
--      matches the category's genre/year filter — so a highly-rated album can climb
--      a leaderboard even if nobody tier-listed or seeded it.

-- ── 1. Re-tune the existing function (album page + mobile back-compat) ──────────
-- Prod shipped a 2-column (release_id, bayesian_score numeric) version; the return
-- type changes to 3 columns here, so the old function must be dropped first.
DROP FUNCTION IF EXISTS get_calibrated_bayesian_scores(uuid[]);

CREATE OR REPLACE FUNCTION get_calibrated_bayesian_scores(release_ids uuid[])
RETURNS TABLE(
  release_id   uuid,
  bayesian_score float8,
  rating_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    user_stats AS (
      SELECT user_id, AVG(score) AS mean_score, STDDEV(score) AS vol, COUNT(*) AS n
      FROM ratings WHERE score IS NOT NULL
      GROUP BY user_id
    ),
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings WHERE score IS NOT NULL
    ),
    calibrated AS (
      SELECT
        r.release_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75,
                 0.5), 5.0)
          ELSE r.score
        END AS cal_score
      FROM ratings r
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.release_id = ANY(release_ids) AND r.score IS NOT NULL
    ),
    agg AS (
      SELECT release_id, AVG(cal_score) AS mean_cal, COUNT(*)::bigint AS v
      FROM calibrated GROUP BY release_id
    )
  SELECT
    a.release_id,
    (a.v::float8 / (a.v + 3)) * a.mean_cal + (3.0 / (a.v + 3)) * g.c AS bayesian_score,
    a.v AS rating_count
  FROM agg a, global_mean g;
$$;

-- ── 2. Category-aware variant that also surfaces rated-only albums ─────────────
CREATE OR REPLACE FUNCTION get_silla_rating_scores(
  release_ids uuid[],
  p_genre     text DEFAULT NULL,
  p_year      int  DEFAULT NULL
)
RETURNS TABLE(
  release_id    uuid,
  bayesian_score float8,
  rating_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    -- Requested releases (tier-listed / seeded) PLUS any rated release matching
    -- the category's genre/year filter.
    candidates AS (
      SELECT unnest(release_ids) AS release_id
      UNION
      SELECT DISTINCT ra.release_id
      FROM ratings ra
      JOIN releases rel ON rel.id = ra.release_id
      WHERE ra.score IS NOT NULL
        AND (p_genre IS NULL OR rel.genres ILIKE '%' || p_genre || '%')
        AND (p_year  IS NULL OR LEFT(rel.release_date, 4) = p_year::text)
    ),
    user_stats AS (
      SELECT user_id, AVG(score) AS mean_score, STDDEV(score) AS vol, COUNT(*) AS n
      FROM ratings WHERE score IS NOT NULL
      GROUP BY user_id
    ),
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings WHERE score IS NOT NULL
    ),
    calibrated AS (
      SELECT
        r.release_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75,
                 0.5), 5.0)
          ELSE r.score
        END AS cal_score
      FROM ratings r
      JOIN candidates c ON c.release_id = r.release_id
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.score IS NOT NULL
    ),
    agg AS (
      SELECT release_id, AVG(cal_score) AS mean_cal, COUNT(*)::bigint AS v
      FROM calibrated GROUP BY release_id
    )
  SELECT
    a.release_id,
    (a.v::float8 / (a.v + 3)) * a.mean_cal + (3.0 / (a.v + 3)) * g.c AS bayesian_score,
    a.v AS rating_count
  FROM agg a, global_mean g;
$$;

GRANT EXECUTE ON FUNCTION get_calibrated_bayesian_scores(uuid[])     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_silla_rating_scores(uuid[], text, int) TO anon, authenticated, service_role;
