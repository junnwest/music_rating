-- FRESHNESS cadence tiering — closes the "every artist re-polls every 30 days" gap.
--
-- The pipeline's FRESHNESS lane re-polls an artist when artists.next_check_at passes, at a
-- cadence set by ingest_priority (hot 1d / active 7d / known 30d / dormant 90d). But nothing
-- ASSIGNED those tiers — every artist defaulted to 'known' (30d), so a new release from an
-- active artist could lag up to a month. This function reprioritizes from real signals:
--   • release recency: the artist's newest release (max first_release_date)
--   • engagement:      whether any of their release_groups has a rating (users care → fresher)
-- and re-derives next_check_at so a promotion takes effect immediately. Only rows whose tier
-- actually changes are touched (so it doesn't reset the freshness clock every run).
--
-- Call periodically: SELECT recompute_ingest_priorities();  (the QC lane runs it daily.)
-- Idempotent; SECURITY DEFINER so the service role can execute it. Apply via the SQL editor.

CREATE OR REPLACE FUNCTION recompute_ingest_priorities()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  WITH stats AS (
    SELECT a.id,
           (SELECT max(rg.first_release_date)
              FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS latest,
           EXISTS (SELECT 1 FROM ratings rt
                     JOIN release_groups rg2 ON rg2.id = rt.release_group_id
                    WHERE rg2.primary_artist_id = a.id) AS rated
    FROM artists a
    WHERE a.ingest_state = 'tracks_done'
  ),
  tiered AS (
    SELECT id,
      CASE
        WHEN latest IS NULL THEN 'known'
        -- promoting (released in last 3mo) → hot regardless of engagement
        WHEN latest >= (now() - interval '3 months')::date  THEN 'hot'
        -- active (last 18mo): hot if rated, else active
        WHEN latest >= (now() - interval '18 months')::date THEN (CASE WHEN rated THEN 'hot'    ELSE 'active' END)
        -- catalog (last 6yr): active if rated, else known
        WHEN latest >= (now() - interval '6 years')::date   THEN (CASE WHEN rated THEN 'active' ELSE 'known'  END)
        -- old: known if rated, else dormant
        ELSE (CASE WHEN rated THEN 'known' ELSE 'dormant' END)
      END AS tier
    FROM stats
  )
  UPDATE artists a SET
    ingest_priority = t.tier,
    next_check_at = coalesce(a.last_ingested_at, now()) + (
      CASE t.tier WHEN 'hot' THEN interval '1 day'  WHEN 'active' THEN interval '7 days'
                  WHEN 'known' THEN interval '30 days' ELSE interval '90 days' END)
  FROM tiered t
  WHERE a.id = t.id AND a.ingest_priority IS DISTINCT FROM t.tier;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
