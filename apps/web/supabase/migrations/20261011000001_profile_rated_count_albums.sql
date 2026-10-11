-- ════════════════════════════════════════════════════════════════════════════
-- Profile "Rated" count: albums only.  2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- get_follow_state.ratings_count fed the profile header's "Rated" number on
-- web and iOS, and it added track_ratings to album ratings. Songs are no longer
-- shown on profiles (only on album pages and the album-post dropdown), so the
-- count, like the Stats tab, is now albums only. Same signature: CREATE OR
-- REPLACE, grants kept. Drift guard: aborts if the live body isn't the
-- 20260926000002 one this was written from.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_follow_state(uuid)'::regprocedure)
     IS DISTINCT FROM 'ed820f1ecab01c6327beeb3e11f2c7c9' THEN
    RAISE EXCEPTION 'get_follow_state differs from 20260926000002 -- not overwriting';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION get_follow_state(p_user_id uuid)
RETURNS TABLE(is_private boolean, is_following boolean, is_requested boolean,
              follows_you boolean, can_view boolean,
              followers_count bigint, following_count bigint, ratings_count bigint,
              pending_requests bigint, is_deactivated boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.profile_visibility = 'Private',
    EXISTS (SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = p.id),
    EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = auth.uid() AND target_id = p.id),
    EXISTS (SELECT 1 FROM follows WHERE follower_id = p.id AND following_id = auth.uid()),
    _sj_viewer_can_see(p.id),
    (SELECT COUNT(*) FROM follows f
      WHERE f.following_id = p.id AND NOT _sj_is_deactivated(f.follower_id)),
    (SELECT COUNT(*) FROM follows f
      WHERE f.follower_id = p.id AND NOT _sj_is_deactivated(f.following_id)),
    -- Albums only (2026-10-11): song ratings show only on album pages and
    -- in the album-post dropdown, so the profile's "Rated" count leaves them out.
    (SELECT COUNT(*) FROM ratings WHERE user_id = p.id),
    CASE WHEN p.id = auth.uid()
         THEN (SELECT COUNT(*) FROM follow_requests fr
               WHERE fr.target_id = p.id AND NOT _sj_is_deactivated(fr.requester_id))
         ELSE 0 END,
    p.deactivated_at IS NOT NULL
  FROM profiles p WHERE p.id = p_user_id;
$$;

COMMIT;
