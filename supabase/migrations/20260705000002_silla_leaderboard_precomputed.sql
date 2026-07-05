-- Fix (round 4, durable this time): get_silla_leaderboard's global path was
-- never going to be reliably fast via query-plan tuning — 20260705000000
-- (disable nested loop) and 20260705000001 (also disable merge join) each
-- fixed one of the two call shapes (global vs. country) while breaking the
-- other, because they genuinely need different plans for a join against a
-- ~294,000-row table. Stepping back from GUC toggles entirely.
--
-- release_groups already has a precomputed, indexed prestige_score column
-- (added in 20260628000000, prestige_redesign) — the ORIGINAL design before
-- country-scoping needs (20260630000003) pushed prestige onto live
-- computation for both paths. That column only ever needed to serve the
-- global (p_country IS NULL) case — country-scoped prestige genuinely can't
-- be precomputed into one column since it depends on the requested country.
--
-- Two problems with using it as-is:
--   1. It's stale: reconcile_prestige_scores() (a function created directly
--      via the SQL editor at some point — it was never in a tracked
--      migration) still implements the OLD weighted-average formula that
--      20260630000004 (prestige_formula_v2) replaced on the live-computation
--      side because it let a weak source dilute a strong one (e.g. Beenzino's
--      Nowitzki case in that migration's own comment). Fixed here to match.
--   2. Nothing was reading it — get_silla_leaderboard recomputed prestige
--      live from external_scores every call instead, for both paths.
--
-- Fix:
--   1. Rewrite reconcile_prestige_scores() with the current (v2) formula —
--      per-tier max, floor guarantee, diversity bonus — identical to what
--      global_prestige/all_prestige already compute live.
--   2. Rewrite get_silla_leaderboard: global path reads rg.prestige_score
--      directly (WHERE prestige_score IS NOT NULL — exactly the condition
--      release_groups_prestige_idx was built for), no join needed at all
--      since the value already lives on the row being scanned. Country path
--      is unchanged (live all_prestige computation — this was already fast,
--      669-719ms warm, with just enable_nestloop=off and nothing else) minus
--      the enable_mergejoin toggle that broke it in round 3.
--   3. Also dropped the final "JOIN release_groups rg ON rg.id = s.rg_id" —
--      it re-fetched columns (title, artist, cover_url, ...) that scored
--      already had in hand, via a second pass over the same big table.
--      Carried them through scored directly instead.
--
-- After applying, run once to populate the (currently 1,589-row, stale-
-- formula) prestige_score column with the corrected values:
--
--   SELECT * FROM reconcile_prestige_scores(5000);
--
-- (5000 covers the ~1,823 global-scope mb_release_group_ids in one call —
-- the function's own batching is for incremental catalog growth going
-- forward, not needed to cover the existing backlog in one shot.)

CREATE OR REPLACE FUNCTION public.reconcile_prestige_scores(batch_limit integer DEFAULT 300)
 RETURNS TABLE(updated integer, pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_updated    int;
  v_pending    int;
BEGIN
  WITH tiered AS (
    SELECT
      mb_release_group_id,
      source_tier,
      MAX(normalized_score)  AS tier_max,
      COUNT(DISTINCT source) AS tier_src_count
    FROM external_scores
    WHERE mb_release_group_id IS NOT NULL
      AND scope_country IS NULL
    GROUP BY mb_release_group_id, source_tier
  ),
  blended AS (
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
    FROM tiered
    GROUP BY mb_release_group_id
  ),
  changed AS (
    SELECT b.mb_release_group_id, LEAST(GREATEST(b.prestige, 0), 1) AS new_score
    FROM blended b
    JOIN release_groups rg ON rg.mb_release_group_id = b.mb_release_group_id
    WHERE rg.prestige_score IS DISTINCT FROM LEAST(GREATEST(b.prestige, 0), 1)
    LIMIT batch_limit
  )
  UPDATE release_groups rg
  SET prestige_score = c.new_score
  FROM changed c
  WHERE rg.mb_release_group_id = c.mb_release_group_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*)::int INTO v_pending
  FROM external_scores WHERE mb_release_group_id IS NULL;

  RETURN QUERY SELECT v_updated, v_pending;
END;
$function$;

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
SET enable_nestloop = off
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
    -- Country prestige only (all sources: global + scoped). Global prestige is
    -- read directly from release_groups.prestige_score below — no live
    -- computation, no join needed for that path at all.
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
      -- Global path: prestige_score is precomputed + indexed directly on
      -- release_groups (release_groups_prestige_idx). No join at all.
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
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
      WHERE p_country IS NULL
        AND rg.prestige_score IS NOT NULL
        AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))

      UNION ALL

      -- Country path: live computation over ALL sources (global + scoped),
      -- narrowed to the requested country's artists.
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
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
      WHERE p_country IS NOT NULL
        AND rg.primary_artist_id IN (
              SELECT id FROM artists WHERE country = upper(p_country)
            )
        AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
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
    a.name_native                                    AS artist_native
  FROM scored s
  LEFT JOIN artists a ON a.id = s.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int)
  TO anon, authenticated;
