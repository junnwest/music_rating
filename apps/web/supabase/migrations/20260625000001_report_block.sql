-- ================================================================
-- Report and Block
-- 2026-06-25
-- ================================================================
-- reports: stores abuse reports on feed posts
-- blocked_users: stores user-level blocks; blocked users are
--   filtered from the reporter's feed on the client
-- ================================================================
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- reports
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating_id         uuid REFERENCES ratings(id) ON DELETE SET NULL,
  reason            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_reason_check
    CHECK (reason IN ('Spam', 'Inappropriate Content', 'Harassment', 'Other'))
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Users can submit reports; only service role can read them
DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_user_id);

-- ─────────────────────────────────────────────────────────────────
-- blocked_users
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocked_users_no_self_block CHECK (blocker_id != blocked_id)
);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- Users manage their own block list; blocked users cannot see they are blocked
DROP POLICY IF EXISTS blocked_users_select ON blocked_users;
CREATE POLICY blocked_users_select ON blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS blocked_users_insert ON blocked_users;
CREATE POLICY blocked_users_insert ON blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS blocked_users_delete ON blocked_users;
CREATE POLICY blocked_users_delete ON blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users (blocker_id);

COMMIT;
