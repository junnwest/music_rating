-- Fix: reconcile_prestige_scores() times out even at the default batch_limit
-- (300), running via the npm script right after 20260705000002 was applied.
--
-- Same root cause as get_silla_leaderboard's whole saga: the `changed` CTE
-- joins the small `blended` set (~1,823 rows max) against release_groups
-- (~294,000 rows) via mb_release_group_id — the exact shape that needed
-- nested-loop and merge-join both disabled to force a Hash Join in
-- 20260705000001/000002. This function never got that treatment since it
-- was created ad hoc via the SQL editor, outside any migration.
--
-- Fix: add the same two function-level SET clauses. No logic changes.

CREATE OR REPLACE FUNCTION public.reconcile_prestige_scores(batch_limit integer DEFAULT 300)
 RETURNS TABLE(updated integer, pending integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET enable_nestloop = off
 SET enable_mergejoin = off
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
