-- taste_map_node_state: read-only for users (2026-11-05 review).
--
-- The answer jsonb carries catalogRgIds, the albums a ghost answer wrote
-- release_genres 'manual' rows on; the questions route trusts that list when the
-- user re-answers. With the owner FOR ALL policy a user could write their own
-- row through PostgREST and forge it. Only the API routes (service role) write
-- this table, so users keep SELECT and lose writes. Tightens permissions on a
-- table created the same night; no data changes.

BEGIN;

DROP POLICY IF EXISTS taste_map_node_state_owner ON taste_map_node_state;
DROP POLICY IF EXISTS taste_map_node_state_owner_select ON taste_map_node_state;
CREATE POLICY taste_map_node_state_owner_select ON taste_map_node_state
  FOR SELECT USING ((select auth.uid()) = user_id);

REVOKE INSERT, UPDATE, DELETE ON taste_map_node_state FROM anon, authenticated;
GRANT SELECT ON taste_map_node_state TO authenticated;

COMMIT;
