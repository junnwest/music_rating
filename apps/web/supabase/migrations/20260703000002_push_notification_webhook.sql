-- ================================================================
-- Push notification delivery webhook
-- 2026-07-03
-- ================================================================
-- Notifications were created (rating_likes/rating_comments/follows
-- triggers → notifications table, added 2026-06-19) but nothing
-- ever pushed them to a device — iOS registers an APNs token and
-- saves it to profiles.push_token, but the send half didn't exist.
--
-- This adds a trigger on notifications INSERT that calls the new
-- /api/push/send-webhook route via pg_net, which looks up the
-- recipient's push_token and calls Apple's push service.
--
-- ⚠️ Requires two DB settings NOT stored in this file (secrets
-- don't belong in git). Run once in the Supabase SQL editor,
-- filling in your real values:
--
--   ALTER DATABASE postgres SET app.settings.push_webhook_url = 'https://www.sillajuku.com/api/push/send-webhook';
--   ALTER DATABASE postgres SET app.settings.push_webhook_secret = '<same value as PUSH_WEBHOOK_SECRET in .env.local/Vercel>';
--
-- Until both settings are configured, the trigger silently no-ops
-- (caught in the EXCEPTION block below) — safe to deploy immediately.
-- ================================================================
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION _notify_push_webhook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  webhook_url    text := current_setting('app.settings.push_webhook_url', true);
  webhook_secret text := current_setting('app.settings.push_webhook_secret', true);
BEGIN
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
  -- Never let a push-delivery failure block the notification insert itself.
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_push_webhook ON notifications;
CREATE TRIGGER trg_notify_push_webhook
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION _notify_push_webhook();

COMMIT;
