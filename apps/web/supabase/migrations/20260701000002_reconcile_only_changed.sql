-- reconcile_prestige_scores() re-UPDATEs all ~2,248 prestige-scored release_groups every run.
-- prestige_score is indexed, so each write is a NON-HOT update that must rewrite the row in every
-- index on the table — including the GIN trigram indexes and the HNSW vector index on `embedding` —
-- which is very expensive at ~2k rows/run and blew the API gateway's ~60s cap.
--
-- Fix: only touch rows whose score actually CHANGED (IS DISTINCT FROM). Steady-state reconcile then
-- updates only the handful of newly-scored/changed groups → milliseconds. (Keeps the 300s timeout
-- from 20260701000001 for the occasional larger delta.)
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
      AND scope_country IS NULL
    GROUP BY mb_release_group_id
  )
  UPDATE release_groups rg
  SET prestige_score = LEAST(GREATEST(b.prestige, 0), 1)
  FROM blended b
  WHERE rg.mb_release_group_id = b.mb_release_group_id
    AND rg.prestige_score IS DISTINCT FROM LEAST(GREATEST(b.prestige, 0), 1);  -- only changed rows

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*)::int INTO v_pending
  FROM external_scores WHERE mb_release_group_id IS NULL;

  RETURN QUERY SELECT v_updated, v_pending;
END;
$$;

ALTER FUNCTION reconcile_prestige_scores() SET statement_timeout = '300s';
GRANT EXECUTE ON FUNCTION reconcile_prestige_scores() TO anon, authenticated, service_role;
