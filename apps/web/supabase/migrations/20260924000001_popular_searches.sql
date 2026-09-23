-- "Popular Searches" -- a row of tappable suggestion chips (empty-query
-- state, both web and iOS) listing search terms trending across ALL users,
-- not personal history. Two pieces: a log table written on every "settled"
-- search (debounced client-side, separately from the existing per-keystroke
-- search-trigger debounce, so prefixes like "b"/"be"/"bey" never get logged
-- -- see apps/web/app/(main)/search/page.tsx), and a read-side aggregation
-- RPC.
--
-- search_query_log mirrors search_misses' exact shape and RLS
-- (20260525000000_catalog_ingestion_queue.sql,
-- 20260711000000_search_misses_insert_policy.sql): insert-only from the
-- client, no SELECT/UPDATE/DELETE policy -- reads only via the
-- SECURITY DEFINER RPC below. No user_id column, matching search_misses;
-- per-user dedup (so one person's repeated searches can't dominate
-- "popular") is a real tradeoff, deliberately left for a follow-up
-- migration if it turns out to matter rather than guessed at now.
CREATE TABLE IF NOT EXISTS search_query_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  query       text        NOT NULL,
  platform    text        NOT NULL DEFAULT 'web',
  searched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_query_log_time  ON search_query_log (searched_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_query_log_query ON search_query_log (query);

ALTER TABLE search_query_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS search_query_log_insert ON search_query_log;
CREATE POLICY search_query_log_insert ON search_query_log
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);

-- SECURITY DEFINER is required here (not optional) -- search_query_log has
-- no SELECT policy by design, so an invoker-rights function would see zero
-- rows for anon/authenticated callers. SET search_path = public is the
-- standard hardening against search-path hijacking on a SECURITY DEFINER
-- function.
--
-- days defaults to 7 (a "trending this week" window) rather than Trending-
-- albums' 30 days (apps/web/app/api/discovery/route.ts) -- query popularity
-- is a faster-moving signal than album ratings, and 7 days keeps the chip
-- row feeling live. This is a plain function default, trivially adjustable
-- later without touching client code if real traffic (currently very low --
-- 59 real ratings vs 7,653 bot ratings in the last 30 days, per Discovery's
-- own comment) makes 7 days too sparse for a while.
CREATE OR REPLACE FUNCTION get_popular_searches(lim int DEFAULT 12, days int DEFAULT 7)
RETURNS TABLE (query text, search_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT query, normalize_text(query) AS qn, searched_at
    FROM search_query_log
    WHERE searched_at > now() - (days || ' days')::interval
  ),
  grouped AS (
    SELECT qn,
           count(*) AS search_count,
           -- Representative display casing/spacing for the group: most recent raw form.
           (array_agg(query ORDER BY searched_at DESC))[1] AS display_query
    FROM recent
    WHERE qn <> '' AND length(qn) >= 2 AND length(query) <= 60
    GROUP BY qn
  )
  SELECT display_query AS query, search_count
  FROM grouped
  WHERE search_count >= 2
  ORDER BY search_count DESC, display_query ASC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION get_popular_searches(int, int) TO anon, authenticated, service_role;
