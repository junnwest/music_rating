-- `ratings.status` is a legacy "Listened" marker that existed only in prod
-- (added via the SQL editor, never captured in a migration) as NOT NULL with
-- no default. Because Postgres validates NOT NULL on the proposed insert tuple
-- BEFORE ON CONFLICT resolution, any upsert that omitted `status` failed with
-- 23502 — most recently the Instinct comparison upsert in /api/rate/compare.
--
-- This (a) backfills the column into the migration history so the repo matches
-- prod, and (b) adds a DEFAULT so write paths no longer have to supply it.
--
-- Run via the Supabase SQL editor. Idempotent.

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS status text;
UPDATE ratings SET status = 'Listened' WHERE status IS NULL;
ALTER TABLE ratings ALTER COLUMN status SET DEFAULT 'Listened';
ALTER TABLE ratings ALTER COLUMN status SET NOT NULL;
