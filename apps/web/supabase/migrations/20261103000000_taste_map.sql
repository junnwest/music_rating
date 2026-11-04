-- ================================================================
-- Taste Map (TASTE_MAP_PLAN.md §3): user inputs, cached solves, and
-- the similar-artist graph the map's 'graph' feature block reads.
-- 2026-11-03
--
-- Stores user inputs and cached solves only. Per-node features are
-- derived on demand in lib/tasteMap/*, never stored here.
--
--   node_key   'a:<artists.id>' (whole artist) or
--              'e:<artists.id>:<first release_groups.id>' (an era starting
--              at that album). Plain text on purpose: it can hold a track
--              or "moment" key later without a migration.
--   lens       which similarity space a solve belongs to. 'sound' today;
--              other lenses (mood, scene, …) reuse the same tables.
--
--   taste_map_layouts  pk (user_id, lens)    cached 3D solve per lens
--   taste_map_pins     pk (user_id, node_key) user-dragged positions
--   taste_map_groups   pk id                  user's named groups
--   taste_map_members  pk (group_id, node_key) soft membership
--   taste_map_eras     pk (user_id, artist_id) manual era splits
--   taste_map_metric   pk (user_id, lens)    learned personal metric
--   artist_similar     pk (artist_id, source) Last.fm / ListenBrainz
--
-- RLS: owner-only read/write on every taste_map_* table (members via
-- their group's owner). artist_similar is public read; writes come only
-- from the service role (scripts/backfill-artist-similar.ts), which
-- bypasses RLS — there are deliberately no write policies.
-- visibility = 'link' on a layout is reserved for a read-only share link;
-- that read goes through a server route with the service role, so no
-- public policy is added here.
--
-- Additive and idempotent: new tables only, IF NOT EXISTS / DROP POLICY
-- IF EXISTS throughout, no backfill (cheap on the Micro instance).
--
-- Run in the Supabase SQL editor (or scripts/db-exec.ts).
-- ================================================================

BEGIN;

-- ── 1. Cached layout solves ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS taste_map_layouts (
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lens        text        NOT NULL DEFAULT 'sound',
  -- { "<node_key>": [x, y, z], ... } (LayoutResult.positions)
  positions   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  dims        int         NOT NULL DEFAULT 3,
  version     int         NOT NULL DEFAULT 1,
  -- Hash of the inputs (ratings, pins, eras, metric) the solve was built
  -- from; a mismatch means the cache is stale.
  input_hash  text,
  visibility  text        NOT NULL DEFAULT 'private',
  solved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lens),
  CONSTRAINT taste_map_layouts_visibility_check CHECK (visibility IN ('private', 'link')),
  CONSTRAINT taste_map_layouts_dims_check       CHECK (dims IN (2, 3)),
  CONSTRAINT taste_map_layouts_positions_check  CHECK (jsonb_typeof(positions) = 'object')
);

-- ── 2. Pins (user-dragged nodes) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS taste_map_pins (
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  node_key   text        NOT NULL,
  x          real        NOT NULL,
  y          real        NOT NULL,
  z          real        NOT NULL DEFAULT 0,
  pinned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_key),
  CONSTRAINT taste_map_pins_node_key_check CHECK (char_length(node_key) BETWEEN 3 AND 200)
);

-- ── 3. Groups ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS taste_map_groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  color       text        NOT NULL,
  -- World key from lib/taste/worlds.ts that seeded this group, if any.
  seed_world  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT taste_map_groups_name_check  CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT taste_map_groups_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE INDEX IF NOT EXISTS idx_taste_map_groups_user ON taste_map_groups (user_id);

-- ── 4. Group membership (soft) ───────────────────────────────────
-- Reads go user → groups (idx above) → members by group_id (pk prefix),
-- so no node_key index is needed.
CREATE TABLE IF NOT EXISTS taste_map_members (
  group_id  uuid    NOT NULL REFERENCES taste_map_groups(id) ON DELETE CASCADE,
  node_key  text    NOT NULL,
  weight    real    NOT NULL DEFAULT 1,
  -- true = the user put it there (never overwritten by auto-assignment).
  manual    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, node_key),
  CONSTRAINT taste_map_members_weight_check   CHECK (weight >= 0 AND weight <= 1),
  CONSTRAINT taste_map_members_node_key_check CHECK (char_length(node_key) BETWEEN 3 AND 200)
);

-- ── 5. Era overrides ─────────────────────────────────────────────
-- Split the artist's discography before each listed release group.
CREATE TABLE IF NOT EXISTS taste_map_eras (
  user_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  artist_id     uuid        NOT NULL REFERENCES artists(id)  ON DELETE CASCADE,
  split_rg_ids  uuid[]      NOT NULL DEFAULT '{}',
  manual        boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);

-- ── 6. Learned personal metric ───────────────────────────────────
CREATE TABLE IF NOT EXISTS taste_map_metric (
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lens        text        NOT NULL DEFAULT 'sound',
  -- { "tags": w, "text": w, "graph": w, "era": w } (MetricWeights.block)
  block_w     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Per tag-dimension weights { "<tag id>": w } (MetricWeights.tagDims), null = unit.
  dim_w       jsonb,
  -- Held-out triplet accuracy etc. from the fit.
  eval        jsonb,
  n_triplets  int         NOT NULL DEFAULT 0,
  fitted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lens)
);

-- ── 7. Similar artists (catalog-wide, from outside sources) ──────
-- similar: SimilarArtist[] (lib/tasteMap/types.ts) -- "similar" is quoted: SIMILAR is a reserved word in Postgres
--   [{ "name", "mbid" | null, "artistId" (our artists.id) | null, "match" 0–1 }]
-- An empty array means "fetched, the source had nothing" (not "unfetched").
CREATE TABLE IF NOT EXISTS artist_similar (
  artist_id   uuid        NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  source      text        NOT NULL,
  "similar"   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, source),
  CONSTRAINT artist_similar_source_check  CHECK (source IN ('lastfm', 'listenbrainz')),
  CONSTRAINT artist_similar_similar_check CHECK (jsonb_typeof("similar") = 'array')
);

-- ── 8. RLS ───────────────────────────────────────────────────────
ALTER TABLE taste_map_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_map_pins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_map_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_map_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_map_eras    ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_map_metric  ENABLE ROW LEVEL SECURITY;
ALTER TABLE artist_similar    ENABLE ROW LEVEL SECURITY;

-- Owner-only, one FOR ALL policy per user-keyed table.
DROP POLICY IF EXISTS taste_map_layouts_owner ON taste_map_layouts;
CREATE POLICY taste_map_layouts_owner ON taste_map_layouts
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS taste_map_pins_owner ON taste_map_pins;
CREATE POLICY taste_map_pins_owner ON taste_map_pins
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS taste_map_groups_owner ON taste_map_groups;
CREATE POLICY taste_map_groups_owner ON taste_map_groups
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS taste_map_eras_owner ON taste_map_eras;
CREATE POLICY taste_map_eras_owner ON taste_map_eras
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS taste_map_metric_owner ON taste_map_metric;
CREATE POLICY taste_map_metric_owner ON taste_map_metric
  FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);

-- Members belong to whoever owns the group.
DROP POLICY IF EXISTS taste_map_members_owner ON taste_map_members;
CREATE POLICY taste_map_members_owner ON taste_map_members
  FOR ALL
  USING (EXISTS (SELECT 1 FROM taste_map_groups g
                 WHERE g.id = group_id AND g.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM taste_map_groups g
                      WHERE g.id = group_id AND g.user_id = (select auth.uid())));

-- Public read; no write policies (service role only).
DROP POLICY IF EXISTS artist_similar_select ON artist_similar;
CREATE POLICY artist_similar_select ON artist_similar FOR SELECT USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  taste_map_layouts, taste_map_pins, taste_map_groups,
  taste_map_members, taste_map_eras, taste_map_metric
  TO authenticated;
GRANT SELECT ON artist_similar TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON artist_similar FROM anon, authenticated;

COMMIT;
