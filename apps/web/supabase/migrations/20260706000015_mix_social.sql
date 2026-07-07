-- Mix social features: bio, likes on the mix itself, and mixes shareable
-- as their own feed posts (with a caption + like/comment thread), mirroring
-- the existing per-entity convention (rating_likes/rating_comments) rather
-- than introducing a generic/polymorphic posts system.
BEGIN;

-- ── mixes.description ────────────────────────────────────────────────────
ALTER TABLE mixes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE mixes DROP CONSTRAINT IF EXISTS mixes_description_length;
ALTER TABLE mixes ADD CONSTRAINT mixes_description_length
  CHECK (description IS NULL OR char_length(description) <= 500);

-- ── mix_likes: liking the mix entity itself ─────────────────────────────
CREATE TABLE IF NOT EXISTS mix_likes (
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mix_id     uuid NOT NULL REFERENCES mixes(id)    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mix_id)
);
CREATE INDEX IF NOT EXISTS idx_mix_likes_mix_id ON mix_likes(mix_id);

ALTER TABLE mix_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view mix likes"
  ON mix_likes FOR SELECT USING (auth.role() = 'authenticated');

-- Unlike rating_likes' plain auth.uid()=user_id check, mixes have a
-- visibility flag, so the write check also verifies the target mix is
-- public or self-owned.
CREATE POLICY "users manage own mix likes"
  ON mix_likes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_likes.mix_id
        AND (mixes.is_public = true OR mixes.user_id = auth.uid())
    )
  );

-- ── mix_shares: a mix reposted as a post with a caption ─────────────────
CREATE TABLE IF NOT EXISTS mix_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  -- the sharer
  mix_id     uuid NOT NULL REFERENCES mixes(id)    ON DELETE CASCADE,  -- the mix shared
  caption    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mix_shares_caption_length CHECK (caption IS NULL OR char_length(caption) <= 500)
);
CREATE INDEX IF NOT EXISTS idx_mix_shares_user_id    ON mix_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_mix_shares_mix_id     ON mix_shares(mix_id);
CREATE INDEX IF NOT EXISTS idx_mix_shares_created_at ON mix_shares(created_at DESC);

ALTER TABLE mix_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view mix shares"
  ON mix_shares FOR SELECT USING (auth.role() = 'authenticated');

-- Anyone can share -- not just the owner -- but only a mix that is
-- actually public at share time.
CREATE POLICY "users manage own mix shares"
  ON mix_shares FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM mixes WHERE mixes.id = mix_shares.mix_id AND mixes.is_public = true)
  );

-- ── mix_share_likes: 1:1 mirror of rating_likes, keyed on mix_share_id ──
CREATE TABLE IF NOT EXISTS mix_share_likes (
  user_id      uuid NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  mix_share_id uuid NOT NULL REFERENCES mix_shares(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mix_share_id)
);
CREATE INDEX IF NOT EXISTS idx_mix_share_likes_mix_share_id ON mix_share_likes(mix_share_id);

ALTER TABLE mix_share_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view mix share likes"
  ON mix_share_likes FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "users manage own mix share likes"
  ON mix_share_likes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── mix_share_comments: 1:1 mirror of rating_comments ───────────────────
CREATE TABLE IF NOT EXISTS mix_share_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  mix_share_id uuid NOT NULL REFERENCES mix_shares(id) ON DELETE CASCADE,
  content      text NOT NULL CHECK (char_length(content) > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mix_share_comments_mix_share_id ON mix_share_comments(mix_share_id);

ALTER TABLE mix_share_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can view mix share comments"
  ON mix_share_comments FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "users can post mix share comments"
  ON mix_share_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own mix share comments"
  ON mix_share_comments FOR DELETE USING (auth.uid() = user_id);

-- ── notifications: extend type + add nullable FK columns ───────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'mix_like', 'mix_share_like', 'mix_share_comment'));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mix_id       uuid REFERENCES mixes(id)       ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mix_share_id uuid REFERENCES mix_shares(id)  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_mix_id       ON notifications(mix_id);
CREATE INDEX IF NOT EXISTS idx_notifications_mix_share_id ON notifications(mix_share_id);

-- One column each, not a single shared column: a mix_like has no share
-- involved at all (needs mix_id), while mix_share_like/comment reach the
-- mix via mix_shares.mix_id (needs only mix_share_id).

-- ── Trigger: like on a mix → notify the mix's owner ─────────────────────
CREATE OR REPLACE FUNCTION _notify_on_mix_like()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM mixes WHERE id = NEW.mix_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, mix_id)
    VALUES (owner_id, NEW.user_id, 'mix_like', NEW.mix_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mix_like ON mix_likes;
CREATE TRIGGER trg_notify_mix_like
  AFTER INSERT ON mix_likes
  FOR EACH ROW EXECUTE FUNCTION _notify_on_mix_like();

-- ── Trigger: like on a mix share → notify the sharer ────────────────────
CREATE OR REPLACE FUNCTION _notify_on_mix_share_like()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM mix_shares WHERE id = NEW.mix_share_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, mix_share_id)
    VALUES (owner_id, NEW.user_id, 'mix_share_like', NEW.mix_share_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mix_share_like ON mix_share_likes;
CREATE TRIGGER trg_notify_mix_share_like
  AFTER INSERT ON mix_share_likes
  FOR EACH ROW EXECUTE FUNCTION _notify_on_mix_share_like();

-- ── Trigger: comment on a mix share → notify the sharer ─────────────────
CREATE OR REPLACE FUNCTION _notify_on_mix_share_comment()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM mix_shares WHERE id = NEW.mix_share_id;
  IF owner_id IS NOT NULL AND owner_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, actor_id, type, mix_share_id)
    VALUES (owner_id, NEW.user_id, 'mix_share_comment', NEW.mix_share_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_mix_share_comment ON mix_share_comments;
CREATE TRIGGER trg_notify_mix_share_comment
  AFTER INSERT ON mix_share_comments
  FOR EACH ROW EXECUTE FUNCTION _notify_on_mix_share_comment();

-- ── get_mix_covers: bounded top-N cover URLs per mix, for the stacked-  ──
-- covers visual and the share composer preview. A window function keeps
-- this a single fast query regardless of how large the underlying mix is.
CREATE OR REPLACE FUNCTION get_mix_covers(p_mix_ids uuid[], p_limit int DEFAULT 10)
RETURNS TABLE (mix_id uuid, release_group_id uuid, cover_url text)
LANGUAGE sql STABLE AS $$
  SELECT mix_id, release_group_id, cover_url FROM (
    SELECT mi.mix_id, mi.release_group_id, rg.cover_url,
           row_number() OVER (PARTITION BY mi.mix_id ORDER BY mi.created_at DESC) AS rn
    FROM mix_items mi
    JOIN release_groups rg ON rg.id = mi.release_group_id
    WHERE mi.mix_id = ANY(p_mix_ids)
  ) sub
  WHERE rn <= p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_mix_covers(uuid[], int) TO anon, authenticated;

-- ── get_profile_mixes: thread `description` through so MixDetailView's ──
-- hero renders correctly when reached from another user's profile Lists
-- tab, not just from a mix-share card. Postgres won't let CREATE OR
-- REPLACE change a function's RETURNS TABLE column list (adding
-- `description` counts as a change) -- it must be dropped first.
DROP FUNCTION IF EXISTS get_profile_mixes(uuid);
CREATE FUNCTION get_profile_mixes(p_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, name text, description text, is_public boolean,
              is_default boolean, created_at timestamptz, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(pr.id, auth.uid(), COALESCE(pr.library_visibility, pr.profile_visibility))
  INTO v_allowed FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.id, m.user_id, m.name, m.description, m.is_public, m.is_default, m.created_at,
           COUNT(mi.mix_id) AS item_count
    FROM mixes m
    LEFT JOIN mix_items mi ON mi.mix_id = m.id
    WHERE m.user_id = p_user_id AND m.is_public = true
    GROUP BY m.id
    ORDER BY m.is_default DESC, m.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_mixes(uuid) TO anon, authenticated;

COMMIT;
