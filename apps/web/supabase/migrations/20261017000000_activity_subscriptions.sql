-- ================================================================
-- Post notifications for people you follow (the per-follow bell).
--
-- A follower can turn on notifications for one account they follow.
-- When that account posts a new album rating or a comment on someone's
-- album rating, each subscriber gets a notification row (and so a push,
-- via trg_notify_push_webhook). Song ratings aren't posts
-- (20261006000001), so they don't notify.
--
--   activity_subscriptions(subscriber_id, target_id)
--     RLS: a user reads/adds/removes only their own rows, and can only
--     subscribe to an account they follow. Unfollowing removes it.
--
--   New notification types:
--     following_rating   rating_id — they rated an album
--     following_comment  rating_id — they commented on a rating
--
-- Only INSERTs notify. Clients upsert ratings, so re-rating an album is an
-- UPDATE and stays quiet. A rating with no score and no review is skipped.
-- Same recipient + actor + type at most once per 10 minutes, so rating ten
-- albums in a row doesn't send ten pushes.
--
-- Fan-out never blocks the write that triggered it — any error is swallowed.
--
-- Run in the Supabase SQL editor (or scripts/db-exec.ts).
-- ================================================================

BEGIN;

-- ── 1. Subscriptions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_subscriptions (
  subscriber_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, target_id),
  CONSTRAINT activity_subscriptions_no_self CHECK (subscriber_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_subscriptions_target ON activity_subscriptions (target_id);

ALTER TABLE activity_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_subscriptions_select ON activity_subscriptions;
CREATE POLICY activity_subscriptions_select ON activity_subscriptions
  FOR SELECT USING ((select auth.uid()) = subscriber_id);

DROP POLICY IF EXISTS activity_subscriptions_insert ON activity_subscriptions;
CREATE POLICY activity_subscriptions_insert ON activity_subscriptions
  FOR INSERT WITH CHECK (
    (select auth.uid()) = subscriber_id
    AND EXISTS (SELECT 1 FROM follows f
                WHERE f.follower_id = subscriber_id AND f.following_id = target_id)
  );

DROP POLICY IF EXISTS activity_subscriptions_delete ON activity_subscriptions;
CREATE POLICY activity_subscriptions_delete ON activity_subscriptions
  FOR DELETE USING ((select auth.uid()) = subscriber_id);

GRANT SELECT, INSERT, DELETE ON activity_subscriptions TO authenticated;

-- Unfollowing drops the subscription (it also stops mattering: the
-- fan-out requires a live follow).
CREATE OR REPLACE FUNCTION _sj_unsubscribe_on_unfollow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM activity_subscriptions
  WHERE subscriber_id = OLD.follower_id AND target_id = OLD.following_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unsubscribe_on_unfollow ON follows;
CREATE TRIGGER trg_unsubscribe_on_unfollow
  AFTER DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION _sj_unsubscribe_on_unfollow();

-- ── 2. Notification types ────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'mix_like', 'mix_share_like', 'mix_share_comment',
                  'follow_request', 'follow_accept',
                  'following_rating', 'following_comment'));

-- ── 3. Fan-out ───────────────────────────────────────────────────
-- Inserts one notification per subscriber of p_actor. p_owner is the
-- owner of the post being commented on (NULL for the actor's own
-- ratings): a subscriber must be able to see it, and the owner is skipped
-- because they already get the ordinary 'comment' notification.
CREATE OR REPLACE FUNCTION _sj_notify_subscribers(
  p_actor uuid, p_type text, p_rating_id uuid, p_owner uuid
)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (user_id, actor_id, type, rating_id)
  SELECT s.subscriber_id, p_actor, p_type, p_rating_id
  FROM activity_subscriptions s
  WHERE s.target_id = p_actor
    AND EXISTS (SELECT 1 FROM follows f
                WHERE f.follower_id = s.subscriber_id AND f.following_id = p_actor)
    AND NOT EXISTS (SELECT 1 FROM profiles p
                    WHERE p.id = p_actor AND p.deactivated_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM blocked_users b
                    WHERE (b.blocker_id = s.subscriber_id AND b.blocked_id = p_actor)
                       OR (b.blocker_id = p_actor AND b.blocked_id = s.subscriber_id))
    AND (p_owner IS NULL OR (
          s.subscriber_id <> p_owner
          AND (NOT EXISTS (SELECT 1 FROM profiles p
                           WHERE p.id = p_owner AND p.profile_visibility = 'Private')
               OR EXISTS (SELECT 1 FROM follows f
                          WHERE f.follower_id = s.subscriber_id AND f.following_id = p_owner))
          AND NOT EXISTS (SELECT 1 FROM blocked_users b
                          WHERE (b.blocker_id = s.subscriber_id AND b.blocked_id = p_owner)
                             OR (b.blocker_id = p_owner AND b.blocked_id = s.subscriber_id))))
    AND NOT EXISTS (SELECT 1 FROM notifications n
                    WHERE n.user_id = s.subscriber_id AND n.actor_id = p_actor
                      AND n.type = p_type AND n.created_at > now() - interval '10 minutes');
$$;
REVOKE EXECUTE ON FUNCTION _sj_notify_subscribers(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _notify_subscribers_on_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.score IS NULL AND COALESCE(btrim(NEW.review_text), '') = '' THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM _sj_notify_subscribers(NEW.user_id, 'following_rating', NEW.id, NULL);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- never block the rating itself
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_subscribers_rating ON ratings;
CREATE TRIGGER trg_notify_subscribers_rating
  AFTER INSERT ON ratings
  FOR EACH ROW EXECUTE FUNCTION _notify_subscribers_on_rating();

-- An earlier draft of this migration also fired on track_ratings.
DROP TRIGGER IF EXISTS trg_notify_subscribers_track_rating ON track_ratings;
DROP FUNCTION IF EXISTS _sj_notify_subscribers(uuid, text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION _notify_subscribers_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
BEGIN
  BEGIN
    SELECT user_id INTO v_owner FROM ratings WHERE id = NEW.rating_id;
    IF v_owner IS NOT NULL THEN
      PERFORM _sj_notify_subscribers(NEW.user_id, 'following_comment', NEW.rating_id, v_owner);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- never block the comment itself
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_subscribers_comment ON rating_comments;
CREATE TRIGGER trg_notify_subscribers_comment
  AFTER INSERT ON rating_comments
  FOR EACH ROW EXECUTE FUNCTION _notify_subscribers_on_comment();

COMMIT;
