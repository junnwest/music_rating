-- blocked_users was never actually created live, despite being defined in
-- 20260625000001_report_block.sql in the same transaction as `reports` (which DID
-- get created). Found while building a DB backup script — .from('blocked_users')
-- returned PGRST205 "Could not find the table" on a live query. Since both tables
-- were in one BEGIN/COMMIT block, this can only mean that migration was applied
-- partially (e.g. only the `reports` section was pasted/run), not that the table
-- was dropped afterward.
--
-- Impact: every block attempt — both web's ReportBlockMenu.tsx and iOS's existing
-- block flow — has been silently failing since Report/Block shipped. Reports work
-- (that table exists); blocking specifically does not.
--
-- Definition copied verbatim from 20260625000001; CREATE TABLE IF NOT EXISTS makes
-- this safe regardless of the actual current state.

CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocked_users_no_self_block CHECK (blocker_id != blocked_id)
);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

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
