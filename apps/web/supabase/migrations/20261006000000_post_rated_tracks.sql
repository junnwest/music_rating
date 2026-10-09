-- ════════════════════════════════════════════════════════════════════════════
-- get_post_rated_tracks — the "Rated N tracks" dropdown on album posts.
-- 2026-10-06 · additive; apply BEFORE the web deploy (and before
-- 20261006000001_song_ratings_no_posts, which goes after it).
-- ════════════════════════════════════════════════════════════════════════════
--
-- Song ratings no longer post; they show in the album tracklist and, for an
-- album post, as the tracks its author rated on that album. One call per page
-- of posts: `p_user_ids[i]` pairs with `p_release_group_ids[i]` (zipped by
-- unnest). Tracks come from the canonical edition — the same tracklist the
-- album page shows — in disc/position order.
--
-- Privacy: SECURITY INVOKER, so track_ratings' private_account_gate (RLS)
-- applies as it does everywhere else; on top of that, the author's catalog
-- visibility, matching get_profile_song_ratings.
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_post_rated_tracks(uuid[], uuid[]);
CREATE FUNCTION get_post_rated_tracks(p_user_ids uuid[], p_release_group_ids uuid[])
RETURNS TABLE (user_id uuid, release_group_id uuid, recording_id uuid, title text,
               disc_number int, track_position int, score numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH pairs AS (
    SELECT DISTINCT p.user_id, p.release_group_id
    FROM unnest(p_user_ids, p_release_group_ids) AS p(user_id, release_group_id)
    WHERE p.user_id IS NOT NULL AND p.release_group_id IS NOT NULL
  )
  SELECT pr.user_id, pr.release_group_id, rec.id, rec.title,
         COALESCE(rt.disc_number, 1), rt.position, tr.score
  FROM pairs pr
  JOIN profiles prof ON prof.id = pr.user_id
  JOIN LATERAL (
    SELECT r.id FROM releases r
    WHERE r.release_group_id = pr.release_group_id AND r.is_canonical
    LIMIT 1
  ) canon ON true
  JOIN release_tracks rt ON rt.release_id = canon.id
  JOIN recordings rec ON rec.id = rt.recording_id
  JOIN track_ratings tr ON tr.user_id = pr.user_id AND tr.recording_id = rt.recording_id
  WHERE tr.score IS NOT NULL
    AND _sj_can_view(pr.user_id, auth.uid(),
                     COALESCE(prof.catalog_visibility, prof.profile_visibility))
  ORDER BY pr.user_id, pr.release_group_id, COALESCE(rt.disc_number, 1), rt.position;
$$;
GRANT EXECUTE ON FUNCTION get_post_rated_tracks(uuid[], uuid[]) TO anon, authenticated;
