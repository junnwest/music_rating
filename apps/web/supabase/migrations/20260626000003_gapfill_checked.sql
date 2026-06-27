-- GAPFILL lane support: a "we already tried iTunes for this group" marker so the cover/
-- tracklist gap-fill doesn't re-query iTunes forever for groups it genuinely can't fill
-- (iTunes simply doesn't have them). Set on every attempt regardless of success.
--
-- Additive + defaulted → safe to run anytime. Apply via the Supabase SQL editor.
-- (The GAPFILL lane degrades gracefully if this column is missing — it just won't run.)

ALTER TABLE release_groups
  ADD COLUMN IF NOT EXISTS gapfill_checked_at timestamptz;

-- Partial index: the lane scans for "MB-missing data, not yet gap-checked".
CREATE INDEX IF NOT EXISTS idx_rg_gapfill_todo
  ON release_groups (created_at)
  WHERE gapfill_checked_at IS NULL AND cover_url IS NULL;
