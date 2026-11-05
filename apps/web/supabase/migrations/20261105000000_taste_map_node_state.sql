-- ================================================================
-- Taste Map ghost nodes: the user's choice / answer per node
-- (lib/tasteMap/thin.ts, ghostApi.ts, README TODO "missing genre data").
-- 2026-11-05
--
-- A thin (evidence-poor) or misfit node is drawn as a ghost. The user
-- can place it (a pin carries the position; state 'placed'), leave it
-- out ('hidden': listed in the ghost tray only), include it anyway
-- ('included'), or answer a question about it (answer jsonb, used as
-- that user's tag override for the node).
--
--   state   NULL | 'placed' | 'hidden' | 'included'
--   answer  NULL | { "genreId": "<taxonomy id>", "at": "<iso>",
--                    "catalogRgIds": [<release_groups.id>, ...] }
--                | { "none": true, "at": "<iso>" }
--
-- A row exists while either is set. Read by GET /api/taste/map (in the
-- payload's input hash) and the questions route; written by
-- PUT /api/taste/map/node-state and POST /api/taste/map/questions.
--
-- RLS: owner-only, like every other taste_map_* table
-- (20261103000000_taste_map.sql). The routes use the service role and
-- scope every query to the authed user.
--
-- Additive and idempotent: one new table, IF NOT EXISTS / DROP POLICY
-- IF EXISTS, no backfill.
--
-- Run in the Supabase SQL editor (or scripts/db-exec.ts).
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS taste_map_node_state (
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  node_key    text        NOT NULL,
  state       text,
  answer      jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_key),
  CONSTRAINT taste_map_node_state_state_check    CHECK (state IS NULL OR state IN ('placed', 'hidden', 'included')),
  CONSTRAINT taste_map_node_state_answer_check   CHECK (answer IS NULL OR jsonb_typeof(answer) = 'object'),
  CONSTRAINT taste_map_node_state_node_key_check CHECK (char_length(node_key) BETWEEN 3 AND 200)
);

ALTER TABLE taste_map_node_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS taste_map_node_state_owner ON taste_map_node_state;
CREATE POLICY taste_map_node_state_owner ON taste_map_node_state
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON taste_map_node_state TO authenticated;

COMMIT;
