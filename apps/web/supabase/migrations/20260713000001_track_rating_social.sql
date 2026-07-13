-- Song ratings had no social features at all -- no review text, no likes, no comments -- while
-- album ratings (`ratings`) have all three. Profile's Posts view got a real song-post card this
-- session, but it couldn't show a review or let anyone like/comment on it since none of that
-- exists in the schema for track_ratings. This brings song ratings to parity, mirroring
-- ratings/rating_likes/rating_comments (and mix_share_likes/mix_share_comments, the newer of the
-- two precedents) exactly in shape -- including the now-established wrapped-auth-call RLS
-- pattern (20260708000001) from the start, rather than needing a follow-up fix migration like
-- both of those originals did.

ALTER TABLE track_ratings ADD COLUMN IF NOT EXISTS review_text text;

CREATE TABLE IF NOT EXISTS track_rating_likes (
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  track_rating_id uuid NOT NULL REFERENCES track_ratings(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_rating_id)
);
CREATE INDEX IF NOT EXISTS idx_track_rating_likes_track_rating_id ON track_rating_likes(track_rating_id);

CREATE TABLE IF NOT EXISTS track_rating_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  track_rating_id uuid NOT NULL REFERENCES track_ratings(id) ON DELETE CASCADE,
  content         text NOT NULL CHECK (char_length(content) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_track_rating_comments_track_rating_id ON track_rating_comments(track_rating_id);

ALTER TABLE track_rating_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE track_rating_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view track likes"
  ON track_rating_likes FOR SELECT USING ((select auth.role()) = 'authenticated');

CREATE POLICY "users manage own track likes"
  ON track_rating_likes FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "authenticated users can view track comments"
  ON track_rating_comments FOR SELECT USING ((select auth.role()) = 'authenticated');

CREATE POLICY "users can post track comments"
  ON track_rating_comments FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can delete own track comments"
  ON track_rating_comments FOR DELETE USING ((select auth.uid()) = user_id);

-- ── notifications: extend type + add nullable FK column (mirrors the mix_share_id precedent
-- in 20260706000015 exactly) ──────────────────────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'mix_like', 'mix_share_like', 'mix_share_comment',
                  'track_rating_like', 'track_rating_comment'));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS track_rating_id uuid REFERENCES track_ratings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_track_rating_id ON notifications(track_rating_id);

CREATE OR REPLACE FUNCTION _notify_on_track_rating_like()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM track_ratings WHERE id = NEW.track_rating_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, track_rating_id)
    VALUES (owner_id, NEW.user_id, 'track_rating_like', NEW.track_rating_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_track_rating_like ON track_rating_likes;
CREATE TRIGGER trg_notify_track_rating_like
  AFTER INSERT ON track_rating_likes
  FOR EACH ROW EXECUTE FUNCTION _notify_on_track_rating_like();

CREATE OR REPLACE FUNCTION _notify_on_track_rating_comment()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM track_ratings WHERE id = NEW.track_rating_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, track_rating_id)
    VALUES (owner_id, NEW.user_id, 'track_rating_comment', NEW.track_rating_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_track_rating_comment ON track_rating_comments;
CREATE TRIGGER trg_notify_track_rating_comment
  AFTER INSERT ON track_rating_comments
  FOR EACH ROW EXECUTE FUNCTION _notify_on_track_rating_comment();
