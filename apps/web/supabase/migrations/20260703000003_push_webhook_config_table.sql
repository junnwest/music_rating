-- ================================================================
-- Push webhook config: replace ALTER DATABASE SET with a table
-- 2026-07-03
-- ================================================================
-- Migration 20260703000002's trigger read its URL/secret via
-- current_setting('app.settings...'), configured with
-- `ALTER DATABASE postgres SET ...`. That statement requires
-- instance-level privileges Supabase's hosted `postgres` role
-- doesn't have ("permission denied to set parameter") — it's
-- reserved for Supabase's own platform management.
--
-- Fix: store the two values in a plain table instead. RLS is
-- enabled with zero policies, so it's unreachable via the
-- PostgREST API (anon/authenticated/service-role all get denied
-- by default-deny) — only the SECURITY DEFINER trigger function
-- can read it, via direct table access which bypasses RLS for the
-- function's owner.
--
-- After running this migration, populate the two rows (SQL editor,
-- fill in your real secret — do NOT commit this to git):
--
--   INSERT INTO _app_config (key, value) VALUES
--     ('push_webhook_url', 'https://www.sillajuku.com/api/push/send-webhook'),
--     ('push_webhook_secret', '<same value as PUSH_WEBHOOK_SECRET in .env.local/Vercel>')
--   ON CONFLICT (key) DO UPDATE SET value = excluded.value;
--
-- Until both rows exist, the trigger silently no-ops — safe to
-- deploy immediately.
-- ================================================================
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE _app_config ENABLE ROW LEVEL SECURITY;
-- No policies added on purpose — default-deny for anon/authenticated/service-role
-- via PostgREST. Only reachable from SQL directly or a SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION _notify_push_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  webhook_url    text;
  webhook_secret text;
BEGIN
  SELECT value INTO webhook_url    FROM _app_config WHERE key = 'push_webhook_url';
  SELECT value INTO webhook_secret FROM _app_config WHERE key = 'push_webhook_secret';

  IF webhook_url IS NULL OR webhook_secret IS NULL THEN
    RETURN new; -- not configured yet — no-op
  END IF;

  PERFORM net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object('notificationId', new.id)
  );

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RETURN new;
END;
$$;

COMMIT;
