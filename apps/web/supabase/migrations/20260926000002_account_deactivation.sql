-- ================================================================
-- Account deactivation
-- 2026-09-26
-- ================================================================
-- A deactivated account is hidden from everyone but its owner until
-- they sign in and choose Reactivate:
--   * profile, ratings, song ratings, Mixes, shares, badges and follow
--     lists are hidden (via _sj_viewer_can_see, which already gates
--     private accounts — 20260926000000)
--   * their comments and likes on OTHER people's posts are hidden
--   * they drop out of search, suggestions, follower/following lists
--     and counts, and notifications they triggered are hidden
--   * their scores are EXCLUDED from averages, charts, the Silla Score
--     and leaderboard, and the Rankings unlock count: every SECURITY
--     DEFINER aggregate that read ratings/track_ratings now reads the
--     active_ratings / active_track_ratings views instead
--   * push token is cleared; the app re-registers after reactivation
--
-- Nothing is deleted, so reactivating restores everything.
--
-- The aggregate functions below are their latest migration definitions
-- with only the table references swapped (generated, not hand-edited).
-- Left out on purpose: get_calibrated_bayesian_scores (dropped in
-- 20260624000001) and get_silla_rating_scores (pre-renovation, still reads
-- ratings.release_id, no callers) — re-creating either would fail.
--
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_profiles_deactivated ON profiles (id) WHERE deactivated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION _sj_is_deactivated(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND deactivated_at IS NOT NULL)
$$;
GRANT EXECUTE ON FUNCTION _sj_is_deactivated(uuid) TO anon, authenticated;

-- ── Active-only views for aggregates ─────────────────────────────
-- Owner-privileged (security_invoker off), so they bypass RLS like the
-- SECURITY DEFINER functions that use them — which is why they're
-- closed to API roles.
CREATE OR REPLACE VIEW active_ratings AS
  SELECT r.* FROM ratings r
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.user_id AND p.deactivated_at IS NOT NULL);
CREATE OR REPLACE VIEW active_track_ratings AS
  SELECT t.* FROM track_ratings t
  WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = t.user_id AND p.deactivated_at IS NOT NULL);
REVOKE ALL ON active_ratings, active_track_ratings FROM PUBLIC, anon, authenticated;

-- ── Visibility checks (from 20260926000000, + deactivation) ──────
-- Owner always sees their own; otherwise the owner must not be
-- deactivated, and must be public or followed.
CREATE OR REPLACE FUNCTION _sj_viewer_can_see(p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
       p_owner IS NULL
    OR p_owner = auth.uid()
    OR (
         NOT EXISTS (SELECT 1 FROM profiles
                     WHERE id = p_owner AND deactivated_at IS NOT NULL)
         AND (
              NOT EXISTS (SELECT 1 FROM profiles
                          WHERE id = p_owner AND profile_visibility = 'Private')
           OR EXISTS (SELECT 1 FROM follows
                      WHERE follower_id = auth.uid() AND following_id = p_owner)
         )
       ),
    false)
$$;

CREATE OR REPLACE FUNCTION _sj_can_view(p_owner_id uuid, p_viewer_id uuid, p_vis text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
       p_viewer_id = p_owner_id
    OR (
         NOT EXISTS (SELECT 1 FROM profiles
                     WHERE id = p_owner_id AND deactivated_at IS NOT NULL)
         AND (
              (p_viewer_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM follows
                 WHERE follower_id = p_viewer_id AND following_id = p_owner_id))
           OR (p_vis = 'Public' AND NOT EXISTS (
                 SELECT 1 FROM profiles
                 WHERE id = p_owner_id AND profile_visibility = 'Private'))
         )
       ),
    false)
$$;

-- Web API routes (service role) filter with this; deactivated accounts
-- are hidden from everyone but themselves.
CREATE OR REPLACE FUNCTION get_hidden_user_ids(p_viewer uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM profiles p
  WHERE p.id IS DISTINCT FROM p_viewer
    AND (
         p.deactivated_at IS NOT NULL
      OR (p.profile_visibility = 'Private'
          AND NOT EXISTS (SELECT 1 FROM follows f
                          WHERE f.follower_id = p_viewer AND f.following_id = p.id))
    )
$$;

-- ── Their activity on other people's things ──────────────────────
DROP POLICY IF EXISTS deactivated_author_gate ON rating_comments;
CREATE POLICY deactivated_author_gate ON rating_comments AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON rating_likes;
CREATE POLICY deactivated_author_gate ON rating_likes AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON track_rating_comments;
CREATE POLICY deactivated_author_gate ON track_rating_comments AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON track_rating_likes;
CREATE POLICY deactivated_author_gate ON track_rating_likes AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON mix_likes;
CREATE POLICY deactivated_author_gate ON mix_likes AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON mix_share_likes;
CREATE POLICY deactivated_author_gate ON mix_share_likes AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

DROP POLICY IF EXISTS deactivated_author_gate ON mix_share_comments;
CREATE POLICY deactivated_author_gate ON mix_share_comments AS RESTRICTIVE FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(user_id));

-- Follow rows: hidden from everyone except the deactivated person
-- themselves (so they vanish from other people's lists too).
DROP POLICY IF EXISTS deactivated_gate ON follows;
CREATE POLICY deactivated_gate ON follows AS RESTRICTIVE FOR SELECT
  USING ((follower_id  = (SELECT auth.uid()) OR NOT _sj_is_deactivated(follower_id))
     AND (following_id = (SELECT auth.uid()) OR NOT _sj_is_deactivated(following_id)));

-- "X liked your rating" from a deactivated X disappears too.
DROP POLICY IF EXISTS deactivated_actor_gate ON notifications;
CREATE POLICY deactivated_actor_gate ON notifications AS RESTRICTIVE FOR SELECT
  USING (actor_id IS NULL OR NOT _sj_is_deactivated(actor_id));

-- ── Deactivate / reactivate ──────────────────────────────────────
CREATE OR REPLACE FUNCTION deactivate_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE profiles SET deactivated_at = now(), push_token = NULL
  WHERE id = v_me AND deactivated_at IS NULL;
  -- Pending requests they sent would otherwise sit in someone's inbox
  -- pointing at a hidden account.
  DELETE FROM follow_requests WHERE requester_id = v_me;
  -- Leaderboard reads this cache; drop their stats now, not at the next cron.
  PERFORM refresh_user_score_stats();
END;
$$;
REVOKE EXECUTE ON FUNCTION deactivate_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION deactivate_my_account() TO authenticated;

CREATE OR REPLACE FUNCTION reactivate_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE profiles SET deactivated_at = NULL WHERE id = v_me;
  PERFORM refresh_user_score_stats();
END;
$$;
REVOKE EXECUTE ON FUNCTION reactivate_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reactivate_my_account() TO authenticated;

-- ── Client RPCs ──────────────────────────────────────────────────
-- get_follow_state gains is_deactivated (return type change → drop +
-- recreate); counts skip deactivated accounts.
DROP FUNCTION IF EXISTS get_follow_state(uuid);
CREATE FUNCTION get_follow_state(p_user_id uuid)
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
    (SELECT COUNT(*) FROM ratings WHERE user_id = p.id)
      + (SELECT COUNT(*) FROM track_ratings WHERE user_id = p.id),
    CASE WHEN p.id = auth.uid()
         THEN (SELECT COUNT(*) FROM follow_requests fr
               WHERE fr.target_id = p.id AND NOT _sj_is_deactivated(fr.requester_id))
         ELSE 0 END,
    p.deactivated_at IS NOT NULL
  FROM profiles p WHERE p.id = p_user_id;
$$;
GRANT EXECUTE ON FUNCTION get_follow_state(uuid) TO anon, authenticated;

-- Community averages exclude deactivated accounts.
CREATE OR REPLACE FUNCTION get_album_community_scores(p_release_group_ids uuid[])
RETURNS TABLE(release_group_id uuid, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.release_group_id, r.score
  FROM active_ratings r
  WHERE r.release_group_id = ANY(p_release_group_ids);
$$;

CREATE OR REPLACE FUNCTION get_song_community_scores(p_recording_ids uuid[])
RETURNS TABLE(recording_id uuid, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.recording_id, t.score
  FROM active_track_ratings t
  WHERE t.recording_id = ANY(p_recording_ids);
$$;

-- search_users (20260924000000) + skip deactivated accounts.
CREATE OR REPLACE FUNCTION search_users(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  is_verified  boolean,
  is_bot       boolean,
  score        double precision
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_verified, p.is_bot,
         (
            CASE WHEN normalize_text(p.username) = nq.qn
                   OR normalize_text(coalesce(p.display_name, '')) = nq.qn THEN 10000 ELSE 0 END
          + CASE WHEN normalize_text(p.username) LIKE nq.qn || '%' THEN 500
                 WHEN normalize_text(coalesce(p.display_name, '')) LIKE nq.qn || '%' THEN 400 ELSE 0 END
          + GREATEST(
              word_similarity(nq.ql, lower(p.username)),
              coalesce(word_similarity(nq.ql, lower(p.display_name)), 0)
            ) * 1000
          - CASE WHEN p.is_bot THEN 5000 ELSE 0 END
         ) AS score
  FROM profiles p, nq
  WHERE nq.qn <> ''
    AND p.deactivated_at IS NULL
    AND (
         normalize_text(p.username) LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(p.display_name, '')) LIKE '%' || nq.qn || '%'
      OR nq.ql <% lower(p.username)
    )
  ORDER BY score DESC
  LIMIT lim;
$$;

-- ── Aggregates: ratings → active_ratings (generated) ─────────────
-- get_charts_controversial: latest definition from 20260706000002_charts_release_type.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_controversial(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 5
  ORDER BY STDDEV(rt.score) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- get_charts_hidden_gems: latest definition from 20260706000019_primary_genre_join.sql, ratings → active views
CREATE OR REPLACE FUNCTION public.get_charts_hidden_gems(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$function$;

-- get_charts_most_rated: latest definition from 20260706000019_primary_genre_join.sql, ratings → active views
CREATE OR REPLACE FUNCTION public.get_charts_most_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- get_charts_most_rated_songs: latest definition from 20260723000000_song_charts_lateral_fix_reapply.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_most_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM active_track_ratings track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.rating_count DESC
  LIMIT p_limit;
$$;

-- get_charts_pulse: latest definition from 20260810010000_remove_instinct_mode.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_pulse()
RETURNS TABLE(total_ratings bigint, avg_score numeric, today_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COUNT(*) FILTER (WHERE score IS NOT NULL),
    ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 2),
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
  FROM active_ratings ratings;
$$;

-- get_charts_top_rated: latest definition from 20260706000019_primary_genre_join.sql, ratings → active views
CREATE OR REPLACE FUNCTION public.get_charts_top_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 3
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- get_charts_top_rated_songs: latest definition from 20260723000000_song_charts_lateral_fix_reapply.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM active_track_ratings track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.avg_score DESC, s.rating_count DESC
  LIMIT p_limit;
$$;

-- get_charts_trending: latest definition from 20260706000002_charts_release_type.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_trending(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint,
              native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

-- get_charts_trending_for_genres: latest definition from 20260706000019_primary_genre_join.sql, ratings → active views
CREATE OR REPLACE FUNCTION public.get_charts_trending_for_genres(p_genres text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN active_ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_primary_matches(pg.primary_genre, rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- get_charts_trending_songs: latest definition from 20260723000000_song_charts_lateral_fix_reapply.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_charts_trending_songs(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, new_count bigint, album_title_native text, artist_native text,
              album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, COUNT(*) AS new_count
    FROM active_track_ratings track_ratings WHERE created_at > now() - interval '7 days' GROUP BY recording_id
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.new_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN LATERAL (
    SELECT rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    WHERE rtk.recording_id = s.recording_id
    ORDER BY rel.is_canonical DESC NULLS LAST
    LIMIT 1
  ) loc ON true
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.new_count DESC
  LIMIT p_limit;
$$;

-- get_rankings_unlock_status: latest definition from 20260810010000_remove_instinct_mode.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_rankings_unlock_status()
RETURNS TABLE (
  album_events           int,
  album_events_target    int,
  album_prestige_covered int,
  album_prestige_target  int,
  album_unlocked         boolean,
  song_events            int,
  song_events_target     int,
  song_unlocked          boolean
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH real_events AS (
    SELECT COUNT(*) AS n
    FROM active_ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE COALESCE(p.is_bot, false) = false
      AND r.score IS NOT NULL
  ),
  bot_events AS (
    SELECT COUNT(*) AS n
    FROM active_ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE p.is_bot = true
      AND r.score IS NOT NULL
  ),
  album_prestige_covered_cte AS (
    SELECT COUNT(*) AS n
    FROM (
      SELECT r.release_group_id
      FROM active_ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      WHERE r.score IS NOT NULL AND rg.prestige_score IS NOT NULL
      GROUP BY r.release_group_id
      HAVING COUNT(*) >= 3
    ) covered
  ),
  song_events_cte AS (
    SELECT COUNT(*) AS n
    FROM active_track_ratings track_ratings
    WHERE score IS NOT NULL
  ),
  weighted AS (
    SELECT
      re.n AS real_n,
      LEAST(be.n::float8, 3000) * (2000.0 / (2000.0 + re.n)) AS bot_contribution
    FROM real_events re, bot_events be
  )
  SELECT
    ROUND(w.real_n + w.bot_contribution)::int,
    10000,
    apc.n::int,
    350,
    ((w.real_n + w.bot_contribution) >= 10000 AND apc.n >= 350),
    se.n::int,
    2500,
    (se.n >= 2500)
  FROM weighted w, album_prestige_covered_cte apc, song_events_cte se;
$$;

-- get_silla_leaderboard: latest definition from 20260920000000_silla_leaderboard_user_stats_cache.sql, ratings → active views
CREATE OR REPLACE FUNCTION public.get_silla_leaderboard(p_genre text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(release_id uuid, spotify_id text, title text, artist text, cover_url text, release_date text, silla_score double precision, rating_norm double precision, prestige_score double precision, rating_count bigint, source_count integer, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
  WITH
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM active_ratings ratings WHERE score IS NOT NULL
    ),
    calibrated AS (
      SELECT
        r.release_group_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75, 0.5), 5.0)
          ELSE r.score
        END AS cal_score
      FROM active_ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      LEFT JOIN user_score_stats us ON us.user_id = r.user_id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE r.score IS NOT NULL
        AND (p_genre   IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    ),
    rating_agg AS (
      SELECT
        release_group_id,
        (COUNT(*)::float8 / (COUNT(*) + 3)) * AVG(cal_score)
          + (3.0 / (COUNT(*) + 3)) * (SELECT c FROM global_mean) AS bayesian_score,
        COUNT(*)::bigint AS rating_count
      FROM calibrated GROUP BY release_group_id
    ),
    all_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)
          ),
          0.95
        ) AS prestige
      FROM (
        SELECT
          mb_release_group_id,
          source_tier,
          MAX(normalized_score)  AS tier_max,
          COUNT(DISTINCT source) AS tier_src_count
        FROM external_scores
        WHERE mb_release_group_id IS NOT NULL
        GROUP BY mb_release_group_id, source_tier
      ) g
      GROUP BY mb_release_group_id
    ),
    scored AS (
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        rg.prestige_score        AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            rg.prestige_score
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * rg.prestige_score
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NULL
        AND rg.prestige_score IS NOT NULL
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))

      UNION ALL

      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        ap.prestige              AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            ap.prestige
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * ap.prestige
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM all_prestige ap
      JOIN release_groups rg ON rg.mb_release_group_id = ap.mb_release_group_id
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NOT NULL
        AND rg.primary_artist_id IN (
              SELECT id FROM artists WHERE country = upper(p_country)
            )
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    )
  SELECT
    s.rg_id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = s.rg_id AND rel.is_canonical = true LIMIT 1) AS spotify_id,
    s.title,
    s.artist_display                                 AS artist,
    s.cover_url,
    s.first_release_date::text                       AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)     AS silla_score,
    s.r_norm                                         AS rating_norm,
    s.p_score                                        AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id AND s.mb_rg_id IS NOT NULL
    ), 0)                                            AS source_count,
    s.native_title,
    a.name_native                                    AS artist_native,
    s.release_group_type
  FROM scored s
  LEFT JOIN artists a ON a.id = s.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;

-- refresh_user_score_stats: latest definition from 20260920000000_silla_leaderboard_user_stats_cache.sql, ratings → active views
CREATE OR REPLACE FUNCTION refresh_user_score_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO user_score_stats (user_id, mean_score, vol, n, updated_at)
  SELECT user_id, AVG(score), STDDEV(score), COUNT(*), now()
  FROM active_ratings ratings
  WHERE score IS NOT NULL
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE
    SET mean_score = EXCLUDED.mean_score,
        vol         = EXCLUDED.vol,
        n           = EXCLUDED.n,
        updated_at  = EXCLUDED.updated_at;

  -- Drops stats for users whose ratings all got deleted since the last
  -- refresh (rare) -- keeps the table from accumulating stale rows forever.
  DELETE FROM user_score_stats
  WHERE user_id NOT IN (SELECT DISTINCT user_id FROM active_ratings ratings WHERE score IS NOT NULL);
END;
$$;

-- get_suggested_users: latest definition from 20260706000005_suggested_users_human_first.sql, ratings → active views
CREATE OR REPLACE FUNCTION get_suggested_users(p_user_id uuid)
RETURNS TABLE(
    id           uuid,
    username     text,
    display_name text,
    avatar_url   text,
    rating_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        p.id,
        p.username,
        p.display_name,
        p.avatar_url,
        COUNT(r.id)::bigint AS rating_count
    FROM profiles p
    JOIN active_ratings r ON r.user_id = p.id
    WHERE p.id <> p_user_id
      AND p.id NOT IN (
          SELECT following_id FROM follows WHERE follower_id = p_user_id
      )
    GROUP BY p.id, p.username, p.display_name, p.avatar_url, p.is_bot
    ORDER BY p.is_bot ASC, rating_count DESC
    LIMIT 30;
$$;

COMMIT;
