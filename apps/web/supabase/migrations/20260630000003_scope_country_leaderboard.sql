-- scope_country_leaderboard: separate global vs. regional prestige accounting.
--
-- Problem: release_groups.prestige_score was computed from ALL sources, so a
-- MAMA-winning K-pop album scores as high globally as a Grammy AOTY winner.
-- This made the global leaderboard skew heavily Korean.
--
-- Fix:
--   • Re-add scope_country to external_scores (dropped in prestige_redesign).
--   • reconcile_prestige_scores() now only counts global-scope sources
--     (scope_country IS NULL) when writing release_groups.prestige_score.
--   • get_silla_leaderboard with p_country set computes prestige live from
--     ALL sources (global + scoped), so KR awards still boost the KR view.
--   • Global view: pure Grammy/Mercury albums rise; KR-only winners disappear
--     unless they have user ratings.

-- ── 1. Re-add scope_country ───────────────────────────────────────────────────

ALTER TABLE external_scores ADD COLUMN IF NOT EXISTS scope_country text;

-- ── 2. Tag KR-only sources ────────────────────────────────────────────────────

UPDATE external_scores
SET scope_country = 'kr'
WHERE source IN (
  'golden_disc_daesang', 'golden_disc_bonsang',
  'mama_aoty', 'mma_aoty', 'sma_album', 'kma_aoty',
  'kha_hiphop', 'kha_rnb',
  'kr_masterpiece_100',
  'rhythmer_hiphop', 'rhythmer_rnb',
  'izm_aoty', 'weiv_aoty'
);

-- ── 3. reconcile_prestige_scores — global sources only ────────────────────────

CREATE OR REPLACE FUNCTION reconcile_prestige_scores()
RETURNS TABLE(updated int, pending int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tier_weights float8[] := ARRAY[0.45, 0.30, 0.25];
  v_updated    int;
  v_pending    int;
BEGIN
  WITH blended AS (
    SELECT
      mb_release_group_id,
      SUM(normalized_score * tier_weights[source_tier])
        / NULLIF(SUM(tier_weights[source_tier]), 0) AS prestige
    FROM external_scores
    WHERE mb_release_group_id IS NOT NULL
      AND scope_country IS NULL          -- exclude region-scoped sources from global prestige
    GROUP BY mb_release_group_id
  )
  UPDATE release_groups rg
  SET prestige_score = LEAST(GREATEST(b.prestige, 0), 1)
  FROM blended b
  WHERE rg.mb_release_group_id = b.mb_release_group_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*)::int INTO v_pending
  FROM external_scores WHERE mb_release_group_id IS NULL;

  RETURN QUERY SELECT v_updated, v_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_prestige_scores() TO anon, authenticated, service_role;

-- ── 4. get_silla_leaderboard — fully live prestige ───────────────────────────
-- Both global and country views compute prestige live from external_scores,
-- so reconcile_prestige_scores() never needs to run after seed changes.
-- Global: scope_country IS NULL sources only.
-- Country: all sources (global + scoped).

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
    -- Global prestige: only sources with no country scope (Grammy, Mercury, etc.)
    global_prestige AS (
      SELECT
        mb_release_group_id,
        SUM(normalized_score * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
          / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0) AS prestige
      FROM external_scores
      WHERE mb_release_group_id IS NOT NULL AND scope_country IS NULL
      GROUP BY mb_release_group_id
    ),
    -- Country prestige: all sources (global + scoped)
    all_prestige AS (
      SELECT
        mb_release_group_id,
        SUM(normalized_score * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
          / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0) AS prestige
      FROM external_scores
      WHERE mb_release_group_id IS NOT NULL
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

-- Note: reconcile_prestige_scores() no longer needs to be called after seed changes.
-- The leaderboard reads prestige live from external_scores on every query.
