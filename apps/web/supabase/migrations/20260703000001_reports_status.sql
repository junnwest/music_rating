-- ================================================================
-- Reports: add a status column for the admin review queue
-- 2026-07-03
-- ================================================================
-- reports existed with no way to mark one as reviewed/actioned —
-- nothing in the app ever read them. Adds the column the new
-- /admin/reports queue needs to track review state.
-- ================================================================
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

ALTER TABLE reports
  ADD CONSTRAINT reports_status_check
  CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);

COMMIT;
