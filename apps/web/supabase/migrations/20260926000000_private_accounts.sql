-- ================================================================
-- Private accounts: approval-gated follows + real read enforcement
-- 2026-09-26
-- ================================================================
-- Before this, profile_visibility = 'Private' only gated the four
-- profile RPCs (20260706000013), and following was instant for any
-- account. Everything else (feed, album pages, comments, likes,
-- Mixes, follows) read straight from tables whose SELECT policies
-- are USING (true) / "any authenticated user", so a private user's
-- ratings were visible everywhere.
--
-- Model (Instagram-style):
--   * A private account's content is visible only to the owner and
--     to APPROVED followers. Everyone else sees the profile header
--     (name, avatar, counts) and a Request button.
--   * Following a private account creates a follow_requests row; the
--     target approves (→ follows row) or declines.
--   * Going Private keeps existing followers. Going Public
--     auto-approves every pending request.
--   * A private user's scores still count toward averages/charts,
--     anonymously: SECURITY DEFINER aggregates are unaffected, and
--     get_*_community_scores below return scores without user ids for
--     the screens that averaged raw rows on the client.
--
-- Enforcement is done with RESTRICTIVE policies (ANDed with every
-- existing permissive policy) so nothing already in place — own-row
-- access, comment/mix rules — has to be dropped or re-stated.
-- The service role (web API routes) bypasses RLS; those routes filter
-- explicitly with _sj_viewer_can_see / get_hidden_user_ids().
--
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

-- ── 1. Core visibility check ─────────────────────────────────────
-- True when the current viewer may see p_owner's content: it's the
-- viewer's own, the owner is not private, or the viewer is an
-- approved follower. SECURITY DEFINER so reading profiles/follows
-- here isn't itself subject to the policies below (no recursion).
CREATE OR REPLACE FUNCTION _sj_viewer_can_see(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- COALESCE: signed out, auth.uid() is NULL and the chain would be NULL,
  -- not false (RLS treats both as "hidden", but RPC callers get a null).
  SELECT COALESCE(
       p_owner IS NULL
    OR p_owner = auth.uid()
    OR NOT EXISTS (SELECT 1 FROM profiles
                   WHERE id = p_owner AND profile_visibility = 'Private')
    OR EXISTS (SELECT 1 FROM follows
               WHERE follower_id = auth.uid() AND following_id = p_owner),
    false)
$$;
GRANT EXECUTE ON FUNCTION _sj_viewer_can_see(uuid) TO anon, authenticated;

-- Private accounts the current viewer can't see. Used by web API
-- routes (service role) that need to filter explicitly.
CREATE OR REPLACE FUNCTION get_hidden_user_ids(p_viewer uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM profiles p
  WHERE p.profile_visibility = 'Private'
    AND p.id IS DISTINCT FROM p_viewer
    AND NOT EXISTS (SELECT 1 FROM follows f
                    WHERE f.follower_id = p_viewer AND f.following_id = p.id)
$$;
REVOKE EXECUTE ON FUNCTION get_hidden_user_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_hidden_user_ids(uuid) TO service_role;

-- Existing per-subtab gate (20260706000013): the account-level setting
-- now wins. A private account's Public override no longer exposes
-- that subtab to non-followers; approved followers see everything.
CREATE OR REPLACE FUNCTION _sj_can_view(p_owner_id uuid, p_viewer_id uuid, p_vis text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
       p_viewer_id = p_owner_id
    OR (p_viewer_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = p_viewer_id AND following_id = p_owner_id))
    OR (p_vis = 'Public' AND NOT EXISTS (
          SELECT 1 FROM profiles
          WHERE id = p_owner_id AND profile_visibility = 'Private')),
    false)
$$;

-- ── 2. Follow requests ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id, created_at DESC);

ALTER TABLE follow_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS follow_requests_select ON follow_requests;
CREATE POLICY follow_requests_select ON follow_requests FOR SELECT
  USING ((SELECT auth.uid()) IN (requester_id, target_id));

-- Requester cancels, or target declines.
DROP POLICY IF EXISTS follow_requests_delete ON follow_requests;
CREATE POLICY follow_requests_delete ON follow_requests FOR DELETE
  USING ((SELECT auth.uid()) IN (requester_id, target_id));

-- Direct inserts are allowed but normally unnecessary: inserting into
-- follows for a private target is rerouted here by the trigger below.
DROP POLICY IF EXISTS follow_requests_insert ON follow_requests;
CREATE POLICY follow_requests_insert ON follow_requests FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = requester_id
    AND EXISTS (SELECT 1 FROM profiles WHERE id = target_id AND profile_visibility = 'Private')
    AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = requester_id AND following_id = target_id)
  );

-- Inserting a follow on a private account becomes a request instead.
-- Works for every client (old app builds, web route) without changes.
-- respond_follow_request sets sj.approving_follow to bypass this.
CREATE OR REPLACE FUNCTION _sj_follow_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('sj.approving_follow', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = NEW.following_id AND profile_visibility = 'Private')
     AND NOT EXISTS (SELECT 1 FROM follows
                     WHERE follower_id = NEW.follower_id AND following_id = NEW.following_id) THEN
    INSERT INTO follow_requests (requester_id, target_id)
    VALUES (NEW.follower_id, NEW.following_id)
    ON CONFLICT DO NOTHING;
    RETURN NULL; -- skip the follows row
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_private_gate ON follows;
CREATE TRIGGER trg_follow_private_gate
  BEFORE INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION _sj_follow_gate();

-- Approve or decline, called by the target.
CREATE OR REPLACE FUNCTION respond_follow_request(p_requester uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM follow_requests WHERE requester_id = p_requester AND target_id = v_me;
  IF NOT FOUND OR NOT p_accept THEN
    RETURN;
  END IF;

  PERFORM set_config('sj.approving_follow', 'on', true);
  INSERT INTO follows (follower_id, following_id) VALUES (p_requester, v_me)
  ON CONFLICT DO NOTHING;
  PERFORM set_config('sj.approving_follow', 'off', true);

  INSERT INTO notifications (user_id, actor_id, type)
  VALUES (p_requester, v_me, 'follow_accept');
END;
$$;
REVOKE EXECUTE ON FUNCTION respond_follow_request(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION respond_follow_request(uuid, boolean) TO authenticated;

-- Going Public auto-approves pending requests. The target is already
-- Public when this AFTER trigger runs, so the gate lets the rows
-- through and _notify_on_follow sends the usual "started following".
CREATE OR REPLACE FUNCTION _sj_on_visibility_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.profile_visibility = 'Private' AND NEW.profile_visibility = 'Public' THEN
    INSERT INTO follows (follower_id, following_id)
    SELECT requester_id, target_id FROM follow_requests WHERE target_id = NEW.id
    ON CONFLICT DO NOTHING;
    DELETE FROM follow_requests WHERE target_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_visibility_change ON profiles;
CREATE TRIGGER trg_profile_visibility_change
  AFTER UPDATE OF profile_visibility ON profiles
  FOR EACH ROW EXECUTE FUNCTION _sj_on_visibility_change();

-- ── 3. Notifications ─────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'mix_like', 'mix_share_like', 'mix_share_comment',
                  'track_rating_like', 'track_rating_comment',
                  'follow_request', 'follow_accept'));

-- The target approved it themselves; "X started following you" would
-- be noise. (Unchanged otherwise from 20260619000004.)
CREATE OR REPLACE FUNCTION _notify_on_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF current_setting('sj.approving_follow', true) = 'on' THEN
    RETURN NEW;
  END IF;
  INSERT INTO notifications (user_id, actor_id, type)
  VALUES (NEW.following_id, NEW.follower_id, 'follow');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _notify_on_follow_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (user_id, actor_id, type)
    VALUES (NEW.target_id, NEW.requester_id, 'follow_request');
    RETURN NEW;
  END IF;
  -- Approved, declined or cancelled: the request notification is stale.
  DELETE FROM notifications
  WHERE user_id = OLD.target_id AND actor_id = OLD.requester_id AND type = 'follow_request';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_follow_request ON follow_requests;
CREATE TRIGGER trg_notify_follow_request
  AFTER INSERT OR DELETE ON follow_requests
  FOR EACH ROW EXECUTE FUNCTION _notify_on_follow_request();

-- ── 4. Read enforcement (RESTRICTIVE, ANDed with existing policies) ──
-- Content owned directly by a user.
DROP POLICY IF EXISTS private_account_gate ON ratings;
CREATE POLICY private_account_gate ON ratings AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id));

DROP POLICY IF EXISTS private_account_gate ON track_ratings;
CREATE POLICY private_account_gate ON track_ratings AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id));

DROP POLICY IF EXISTS private_account_gate ON rating_history;
CREATE POLICY private_account_gate ON rating_history AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id));

DROP POLICY IF EXISTS private_account_gate ON mixes;
CREATE POLICY private_account_gate ON mixes AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id));

DROP POLICY IF EXISTS private_account_gate ON user_accomplishments;
CREATE POLICY private_account_gate ON user_accomplishments AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id));

-- A private user's shares are theirs; a share of a private user's mix
-- is hidden along with the mix.
DROP POLICY IF EXISTS private_account_gate ON mix_shares;
CREATE POLICY private_account_gate ON mix_shares AS RESTRICTIVE FOR SELECT
  USING (_sj_viewer_can_see(user_id)
         AND EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_shares.mix_id AND _sj_viewer_can_see(m.user_id)));

-- Child rows follow their parent: if you can't see the rating/mix/share,
-- you can't see its likes and comments. (A private user's comment on a
-- PUBLIC user's rating stays visible, as on Instagram.)
DROP POLICY IF EXISTS private_account_gate ON rating_likes;
CREATE POLICY private_account_gate ON rating_likes AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM ratings r WHERE r.id = rating_likes.rating_id AND _sj_viewer_can_see(r.user_id)));

DROP POLICY IF EXISTS private_account_gate ON rating_comments;
CREATE POLICY private_account_gate ON rating_comments AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM ratings r WHERE r.id = rating_comments.rating_id AND _sj_viewer_can_see(r.user_id)));

DROP POLICY IF EXISTS private_account_gate ON track_rating_likes;
CREATE POLICY private_account_gate ON track_rating_likes AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM track_ratings t WHERE t.id = track_rating_likes.track_rating_id AND _sj_viewer_can_see(t.user_id)));

DROP POLICY IF EXISTS private_account_gate ON track_rating_comments;
CREATE POLICY private_account_gate ON track_rating_comments AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM track_ratings t WHERE t.id = track_rating_comments.track_rating_id AND _sj_viewer_can_see(t.user_id)));

DROP POLICY IF EXISTS private_account_gate ON mix_items;
CREATE POLICY private_account_gate ON mix_items AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_items.mix_id AND _sj_viewer_can_see(m.user_id)));

DROP POLICY IF EXISTS private_account_gate ON mix_song_items;
CREATE POLICY private_account_gate ON mix_song_items AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_song_items.mix_id AND _sj_viewer_can_see(m.user_id)));

DROP POLICY IF EXISTS private_account_gate ON mix_likes;
CREATE POLICY private_account_gate ON mix_likes AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_likes.mix_id AND _sj_viewer_can_see(m.user_id)));

DROP POLICY IF EXISTS private_account_gate ON mix_share_likes;
CREATE POLICY private_account_gate ON mix_share_likes AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM mix_shares s WHERE s.id = mix_share_likes.mix_share_id AND _sj_viewer_can_see(s.user_id)));

DROP POLICY IF EXISTS private_account_gate ON mix_share_comments;
CREATE POLICY private_account_gate ON mix_share_comments AS RESTRICTIVE FOR SELECT
  USING (EXISTS (SELECT 1 FROM mix_shares s WHERE s.id = mix_share_comments.mix_share_id AND _sj_viewer_can_see(s.user_id)));

-- A follow row is visible if the viewer is on either side or can see
-- either side — so a private user still appears in a public user's
-- follower list (Instagram behavior), but a private user's own lists
-- are hidden from non-followers. Profile counts come from
-- get_follow_state, which isn't affected by this.
DROP POLICY IF EXISTS private_account_gate ON follows;
CREATE POLICY private_account_gate ON follows AS RESTRICTIVE FOR SELECT
  USING ((SELECT auth.uid()) IN (follower_id, following_id)
         OR _sj_viewer_can_see(follower_id)
         OR _sj_viewer_can_see(following_id));

-- ── 5. RPCs for clients ──────────────────────────────────────────
-- Everything a profile header needs, in one call.
CREATE OR REPLACE FUNCTION get_follow_state(p_user_id uuid)
RETURNS TABLE(is_private boolean, is_following boolean, is_requested boolean,
              follows_you boolean, can_view boolean,
              followers_count bigint, following_count bigint, ratings_count bigint,
              pending_requests bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.profile_visibility = 'Private',
    EXISTS (SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = p.id),
    EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = auth.uid() AND target_id = p.id),
    EXISTS (SELECT 1 FROM follows WHERE follower_id = p.id AND following_id = auth.uid()),
    _sj_viewer_can_see(p.id),
    (SELECT COUNT(*) FROM follows WHERE following_id = p.id),
    (SELECT COUNT(*) FROM follows WHERE follower_id = p.id),
    (SELECT COUNT(*) FROM ratings WHERE user_id = p.id)
      + (SELECT COUNT(*) FROM track_ratings WHERE user_id = p.id),
    CASE WHEN p.id = auth.uid()
         THEN (SELECT COUNT(*) FROM follow_requests WHERE target_id = p.id)
         ELSE 0 END
  FROM profiles p WHERE p.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION get_follow_state(uuid) TO anon, authenticated;

-- Anonymous scores for community averages/spread. No user ids, so a
-- private user's score counts without revealing who gave it.
CREATE OR REPLACE FUNCTION get_album_community_scores(p_release_group_ids uuid[])
RETURNS TABLE(release_group_id uuid, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.release_group_id, r.score
  FROM ratings r
  WHERE r.release_group_id = ANY(p_release_group_ids);
$$;
GRANT EXECUTE ON FUNCTION get_album_community_scores(uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION get_song_community_scores(p_recording_ids uuid[])
RETURNS TABLE(recording_id uuid, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.recording_id, t.score
  FROM track_ratings t
  WHERE t.recording_id = ANY(p_recording_ids);
$$;
GRANT EXECUTE ON FUNCTION get_song_community_scores(uuid[]) TO anon, authenticated;

COMMIT;
