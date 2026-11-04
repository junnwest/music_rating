-- ================================================================
-- Taste Map pins: soft depth (TASTE_MAP_PLAN.md D5, Phase 3).
-- 2026-11-04
--
-- A node pinned from the 2D view fixes only its place in the D5 plane;
-- its depth along the plane normal stays free for the force layout.
-- soft_z = true marks such a pin (apiTypes.ts PinInput.softZ). x, y, z
-- still hold the full 3D position at pin time.
--
-- The app works with or without this column: until it exists,
-- lib/tasteMap/store.ts reads and writes pins without soft_z and soft
-- pins are stored as ordinary (hard) pins.
--
-- Additive and idempotent: one column with a constant default (no table
-- rewrite on Postgres 11+), no backfill. RLS is unchanged (the existing
-- owner policy on taste_map_pins covers the new column).
--
-- Run in the Supabase SQL editor (or scripts/db-exec.ts).
-- ================================================================

BEGIN;

ALTER TABLE taste_map_pins ADD COLUMN IF NOT EXISTS soft_z boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN taste_map_pins.soft_z IS
  'Pinned from the 2D view: only the D5-plane position is fixed, depth stays free.';

COMMIT;
