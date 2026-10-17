-- ================================================================
-- Post notifications: group consecutive ratings, 2-minute window.
--
-- 20261017000000 dropped every following_* notification for 10 minutes
-- after the first, so a rating spree showed up as just its first album.
-- Now:
--   • following_rating: a rating within 2 minutes of the actor's previous
--     one folds into the same notification instead of a new row —
--     group_count + 1, rating_id moves to the newest rating, created_at
--     moves to now (so it resurfaces as unread). The window slides, so a
--     long run of ratings stays one notification. Only the first rating
--     of a run INSERTs, so only it sends a push (the webhook is AFTER
--     INSERT).
--   • following_comment: still one per 2 minutes per actor, no grouping.
--
-- Clients read group_count: 1 = "rated X", n > 1 = "rated X and n-1
-- more albums" (linking to the actor's profile). The column is additive,
-- so older app builds are unaffected.
-- ================================================================

BEGIN;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_count int NOT NULL DEFAULT 1;

-- Subscribers of p_actor who should hear about this post. p_owner is the
-- owner of the rating being commented on (NULL for the actor's own
-- ratings): the subscriber must be able to see it, and the owner is skipped
-- because they already get the ordinary 'comment' notification.
CREATE OR REPLACE FUNCTION _sj_post_recipients(p_actor uuid, p_owner uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.subscriber_id
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
$$;
REVOKE EXECUTE ON FUNCTION _sj_post_recipients(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _sj_notify_subscribers(
  p_actor uuid, p_type text, p_rating_id uuid, p_owner uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_type = 'following_rating' THEN
    UPDATE notifications n
    SET group_count = n.group_count + 1, rating_id = p_rating_id, created_at = now()
    WHERE n.actor_id = p_actor AND n.type = 'following_rating'
      AND n.created_at > now() - interval '2 minutes'
      AND n.user_id IN (SELECT _sj_post_recipients(p_actor, p_owner));
  END IF;

  -- Everyone without an open group (or, for comments, without one in the
  -- last 2 minutes) gets a new row.
  INSERT INTO notifications (user_id, actor_id, type, rating_id)
  SELECT r, p_actor, p_type, p_rating_id
  FROM _sj_post_recipients(p_actor, p_owner) AS r
  WHERE NOT EXISTS (SELECT 1 FROM notifications n
                    WHERE n.user_id = r AND n.actor_id = p_actor AND n.type = p_type
                      AND n.created_at > now() - interval '2 minutes');
END;
$$;
REVOKE EXECUTE ON FUNCTION _sj_notify_subscribers(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
