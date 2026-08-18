-- Cleanup: drop the temporary diagnostic helper added in 20260818000002. It served its purpose
-- (found the real cause of search_artists' remaining latency after two rounds of index-shaped
-- fixes that looked right on paper but weren't -- see 20260818000003's comment for what it
-- actually revealed) and isn't meant to be a permanent part of the schema.
--
-- Not urgent -- apply whenever convenient. It's service_role-only and doesn't widen any real
-- capability (service_role already bypasses RLS via other means), so there's no security rush.

DROP FUNCTION IF EXISTS _debug_explain(text);
