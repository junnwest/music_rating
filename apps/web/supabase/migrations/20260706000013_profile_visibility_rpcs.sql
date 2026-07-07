-- Real enforcement of profile/catalog/library/stats visibility, for the
-- first time -- the baseline RLS on ratings/track_ratings/profiles/mixes has
-- always been fully open (confirmed this session), so this doesn't touch
-- those blanket policies (other features like leaderboards/global feed may
-- depend on open reads) and instead gates access at the RPC layer, only used
-- by UserProfileView.swift's "view someone else's profile" surface. The
-- owner's own ProfileView.swift/MixLibraryView.swift keep using direct table
-- queries unchanged -- an owner always sees their own data regardless.
--
-- SET search_path = public on every function here, even though none of them
-- fire from an auth.users trigger -- cheap insurance per the lesson from
-- migration 20260706000008 (unqualified table references can silently fail
-- to resolve depending on the calling role's search_path).

CREATE OR REPLACE FUNCTION _sj_can_view(p_owner_id uuid, p_viewer_id uuid, p_vis text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_viewer_id = p_owner_id
      OR p_vis = 'Public'
      OR (p_vis = 'Private' AND p_viewer_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM follows
            WHERE follower_id = p_viewer_id AND following_id = p_owner_id))
$$;

-- Single status struct the client fetches once per profile load (mirrors
-- get_rankings_unlock_status's convention of one RPC call -> one status row).
CREATE OR REPLACE FUNCTION get_profile_subtab_access(p_user_id uuid)
RETURNS TABLE(profile_visible boolean, catalog_visible boolean,
              library_visible boolean, stats_visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    _sj_can_view(p.id, auth.uid(), p.profile_visibility),
    _sj_can_view(p.id, auth.uid(), COALESCE(p.catalog_visibility, p.profile_visibility)),
    _sj_can_view(p.id, auth.uid(), COALESCE(p.library_visibility, p.profile_visibility)),
    _sj_can_view(p.id, auth.uid(), COALESCE(p.stats_visibility,  p.profile_visibility))
  FROM profiles p WHERE p.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION get_profile_subtab_access(uuid) TO anon, authenticated;

-- p_subtab is 'catalog' or 'stats' -- selects which override column gates
-- the read, since Catalog and Stats read the same underlying `ratings` rows
-- but can have independently different effective visibility (plain RLS
-- can't express "same table, different gate depending on which UI surface is
-- asking"). Shape matches ProfileView.swift's UserRating/ReleaseRef decode
-- (release_groups jsonb incl. native_title/artists.name_native) so the
-- client's existing Codable types decode this unchanged. LIMIT 60 matches
-- ProfileView's own existing cap on the owner's page -- real precedent, not
-- a new regression.
CREATE OR REPLACE FUNCTION get_profile_album_ratings(p_user_id uuid, p_subtab text)
RETURNS TABLE(id uuid, score numeric, elo_score numeric, review_text text,
              created_at timestamptz, release_groups jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(
    pr.id, auth.uid(),
    COALESCE(CASE p_subtab WHEN 'stats' THEN pr.stats_visibility ELSE pr.catalog_visibility END,
             pr.profile_visibility)
  ) INTO v_allowed
  FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT r.id, r.score, r.elo_score, r.review_text, r.created_at,
           jsonb_build_object(
             'id', rg.id, 'title', rg.title, 'artist_display', rg.artist_display,
             'cover_url', rg.cover_url, 'release_group_type', rg.release_group_type,
             'native_title', rg.native_title,
             'artists', jsonb_build_object('name_native', a.name_native)
           ) AS release_groups
    FROM ratings r
    JOIN release_groups rg ON rg.id = r.release_group_id
    LEFT JOIN artists a ON a.id = rg.primary_artist_id
    WHERE r.user_id = p_user_id
    ORDER BY r.created_at DESC
    LIMIT 60;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_album_ratings(uuid, text) TO anon, authenticated;

-- Same gating, mirrors UserProfileView's existing 2-step client-side fetch
-- (recording -> release_tracks -> releases -> release_groups, preferring the
-- canonical release for cover art) as one server-side query instead.
CREATE OR REPLACE FUNCTION get_profile_song_ratings(p_user_id uuid, p_subtab text)
RETURNS TABLE(recording_id uuid, score numeric, elo_score numeric,
              track_title text, release_groups jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(
    pr.id, auth.uid(),
    COALESCE(CASE p_subtab WHEN 'stats' THEN pr.stats_visibility ELSE pr.catalog_visibility END,
             pr.profile_visibility)
  ) INTO v_allowed
  FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT tr.recording_id, tr.score, tr.elo_score, rec.title,
           -- NULL (not a jsonb object with null fields) when no matching
           -- release was found -- a jsonb_build_object with a null "id"
           -- would decode into Swift's non-optional ReleaseRef.id: UUID and
           -- crash/fail; a genuinely-null column decodes cleanly as nil.
           CASE WHEN rg.id IS NULL THEN NULL ELSE
             jsonb_build_object(
               'id', rg.id, 'title', rg.title,
               'artist_display', COALESCE(rg.artist_display, rec.artist_display),
               'cover_url', rg.cover_url
             )
           END AS release_groups
    FROM track_ratings tr
    JOIN recordings rec ON rec.id = tr.recording_id
    LEFT JOIN LATERAL (
      SELECT rgi.*
      FROM release_tracks rt
      JOIN releases rel ON rel.id = rt.release_id
      JOIN release_groups rgi ON rgi.id = rel.release_group_id
      WHERE rt.recording_id = tr.recording_id
      ORDER BY rel.is_canonical DESC
      LIMIT 1
    ) rg ON true
    WHERE tr.user_id = p_user_id
    ORDER BY tr.created_at DESC
    LIMIT 60;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_song_ratings(uuid, text) TO anon, authenticated;

-- Gates on the subtab-level Library setting, then returns only
-- is_public = true mixes -- the per-mix flag stays a second, independent
-- gate even when Library itself is effectively Public (a private individual
-- mix never shows to anyone but its owner regardless of this subtab
-- setting).
CREATE OR REPLACE FUNCTION get_profile_mixes(p_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, name text, is_public boolean,
              is_default boolean, created_at timestamptz, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(pr.id, auth.uid(), COALESCE(pr.library_visibility, pr.profile_visibility))
  INTO v_allowed FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.id, m.user_id, m.name, m.is_public, m.is_default, m.created_at,
           COUNT(mi.mix_id) AS item_count
    FROM mixes m
    LEFT JOIN mix_items mi ON mi.mix_id = m.id
    WHERE m.user_id = p_user_id AND m.is_public = true
    GROUP BY m.id
    ORDER BY m.is_default DESC, m.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_mixes(uuid) TO anon, authenticated;
