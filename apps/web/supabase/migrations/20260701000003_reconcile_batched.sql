-- Even a one-shot reconcile of all changed rows is too heavy for any timed path (the non-HOT
-- prestige_score UPDATE rewrites each row across the HNSW + GIN indexes). Make it BATCHABLE: each
-- call updates at most `batch_limit` still-changed rows and returns how many it did. The client
-- loops until a call updates 0. Steady-state (few changes) it's one fast call; a big initial delta
-- just takes a few loops — all under the API gateway's ~60s cap, no direct psql needed.
DROP FUNCTION IF EXISTS reconcile_prestige_scores();

CREATE OR REPLACE FUNCTION reconcile_prestige_scores(batch_limit int DEFAULT 300)
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
$$;

ALTER FUNCTION reconcile_prestige_scores(int) SET statement_timeout = '120s';
GRANT EXECUTE ON FUNCTION reconcile_prestige_scores(int) TO anon, authenticated, service_role;
