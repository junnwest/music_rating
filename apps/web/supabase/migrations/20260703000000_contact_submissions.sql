-- ================================================================
-- Contact submissions
-- 2026-07-03
-- ================================================================
-- Backs the Help page's contact form (apps/web/app/(main)/help).
-- Previously the form only set local React state on submit — no
-- record was ever created and no one saw the message. This table
-- is the fix: anyone can insert one, only the service role can read.
-- ================================================================
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS contact_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  email       text,
  category    text NOT NULL,
  message     text NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_submissions_category_check
    CHECK (category IN ('bug', 'feature', 'question', 'content')),
  CONSTRAINT contact_submissions_status_check
    CHECK (status IN ('open', 'reviewed', 'closed'))
);

ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone (including signed-out visitors) can submit; only the
-- service role (used by the admin review route) can read.
DROP POLICY IF EXISTS contact_submissions_insert ON contact_submissions;
CREATE POLICY contact_submissions_insert ON contact_submissions
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions (status, created_at DESC);

COMMIT;
