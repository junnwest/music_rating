-- Fixes the Silla leaderboard (get_silla_leaderboard) intermittently failing
-- with 57014 "canceling statement due to statement timeout" -- root cause of
-- the 2026-09-19 Vercel "function duration spike" alert (/api/charts/silla
-- was showing ~48.6% error rate).
--
-- WHY: the RPC's `user_stats` CTE recomputes AVG/STDDEV/COUNT(score) grouped
-- by user_id over the ENTIRE `ratings` table, on every single call -- even
-- though this value is completely unfiltered (doesn't depend on the
-- leaderboard's p_genre/p_country params at all) and `ratings` has no index
-- on user_id, so it's a full sequential scan + sort every time. Confirmed
-- live: this RPC now reliably exceeds the anon role's 3s statement timeout
-- (57014, reproduced directly) and, under load, sometimes the route's own
-- service-role budget too -- it was already documented as a ~7s query when
-- the route's caching layer was built; the catalog/ratings tables have only
-- grown since.
--
-- FIX: move the redundant, unfiltered per-user stats out of the per-request
-- path entirely. `user_score_stats` is a small precomputed table, refreshed
-- on a schedule (new cron, see vercel.json) instead of recalculated on every
-- cache-miss request. The leaderboard's genuinely per-request work (genre/
-- country filtering, per-release aggregation) is untouched -- only the
-- global, filter-independent stats move out. `global_mean` is left as a
-- live query deliberately: it's a single-pass AVG (no GROUP BY), not the
-- bottleneck, and switching it to an average-of-per-user-means would subtly
-- change the Bayesian prior's value (weighting every user equally instead
-- of every rating equally) -- a behavior change this migration isn't meant
-- to make.

CREATE TABLE IF NOT EXISTS user_score_stats (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mean_score  double precision NOT NULL,
  vol         double precision,
  n           bigint NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- No client reads this table directly -- only the SECURITY DEFINER
-- get_silla_leaderboard and the cron-triggered refresh function touch it.
-- Same no-policy posture as beta_redeem_tokens.
ALTER TABLE user_score_stats ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION refresh_user_score_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_score_stats (user_id, mean_score, vol, n, updated_at)
  SELECT user_id, AVG(score), STDDEV(score), COUNT(*), now()
  FROM ratings
  WHERE score IS NOT NULL
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE
    SET mean_score = EXCLUDED.mean_score,
        vol         = EXCLUDED.vol,
        n           = EXCLUDED.n,
        updated_at  = EXCLUDED.updated_at;

  -- Drops stats for users whose ratings all got deleted since the last
  -- refresh (rare) -- keeps the table from accumulating stale rows forever.
  DELETE FROM user_score_stats
  WHERE user_id NOT IN (SELECT DISTINCT user_id FROM ratings WHERE score IS NOT NULL);
END;
$$;
GRANT EXECUTE ON FUNCTION refresh_user_score_stats() TO service_role;

-- ── get_silla_leaderboard: reads user_score_stats instead of recomputing it ──
CREATE OR REPLACE FUNCTION public.get_silla_leaderboard(p_genre text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(release_id uuid, spotify_id text, title text, artist text, cover_url text, release_date text, silla_score double precision, rating_norm double precision, prestige_score double precision, rating_count bigint, source_count integer, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
  WITH
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings WHERE score IS NOT NULL
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
      LEFT JOIN user_score_stats us ON us.user_id = r.user_id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE r.score IS NOT NULL
        AND (p_genre   IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
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
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        rg.prestige_score        AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            rg.prestige_score
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * rg.prestige_score
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NULL
        AND rg.prestige_score IS NOT NULL
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))

      UNION ALL

      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        ap.prestige              AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            ap.prestige
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * ap.prestige
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM all_prestige ap
      JOIN release_groups rg ON rg.mb_release_group_id = ap.mb_release_group_id
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NOT NULL
        AND rg.primary_artist_id IN (
              SELECT id FROM artists WHERE country = upper(p_country)
            )
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    )
  SELECT
    s.rg_id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = s.rg_id AND rel.is_canonical = true LIMIT 1) AS spotify_id,
    s.title,
    s.artist_display                                 AS artist,
    s.cover_url,
    s.first_release_date::text                       AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)     AS silla_score,
    s.r_norm                                         AS rating_norm,
    s.p_score                                        AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id AND s.mb_rg_id IS NOT NULL
    ), 0)                                            AS source_count,
    s.native_title,
    a.name_native                                    AS artist_native,
    s.release_group_type
  FROM scored s
  LEFT JOIN artists a ON a.id = s.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;

-- Populate immediately so the very next call already benefits -- otherwise
-- the first post-migration call would still hit the old slow path (an
-- empty user_score_stats just means everyone's cal_score falls through to
-- the raw-score ELSE branch, which is correct but skips calibration until
-- the first cron run populates it).
SELECT refresh_user_score_stats();
