-- Temporary diagnostic helper -- lets a service_role connection run EXPLAIN ANALYZE and get
-- the plan back as rows, since PostgREST/the JS client otherwise has no raw-SQL execution path
-- (confirmed earlier this session: `db.from('pg_indexes')...` fails, "Could not find the table
-- 'public.pg_indexes' in the schema cache" -- PostgREST only exposes public-schema tables/views/
-- RPCs, never system catalogs). Used to diagnose why search_artists was still ~1.3s after two
-- rounds of index-shaped fixes (20260818000000, 20260818000001) that should have addressed every
-- non-indexable OR-arm identified by inspection alone.
--
-- Scoped to service_role only, explicitly revoked from PUBLIC/anon/authenticated -- this doesn't
-- meaningfully widen what a service_role connection can already do (it bypasses RLS entirely via
-- other means already), it just adds a convenient read path for this one debugging session.
--
-- HOUSEKEEPING: this is scaffolding, not a permanent part of the schema. Drop it once
-- search_artists is confirmed fast:
--   DROP FUNCTION IF EXISTS _debug_explain(text);

CREATE OR REPLACE FUNCTION _debug_explain(query_text text)
RETURNS TABLE(line text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ' || query_text;
END;
$$;

REVOKE ALL ON FUNCTION _debug_explain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _debug_explain(text) FROM anon;
REVOKE ALL ON FUNCTION _debug_explain(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION _debug_explain(text) TO service_role;
