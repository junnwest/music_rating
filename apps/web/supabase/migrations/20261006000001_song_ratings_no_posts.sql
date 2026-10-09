-- ════════════════════════════════════════════════════════════════════════════
-- Song ratings stop being posts.  2026-10-06
-- ════════════════════════════════════════════════════════════════════════════
--
-- Albums are the primary thing rated here; a song rating is now a score and
-- nothing else. It shows only in the album page's tracklist and in the
-- "rated N tracks" dropdown on the author's album post. That retires the
-- social layer 20260713000001 bolted onto track_ratings: review text, likes,
-- comments, their notifications, and the song-page comment RPCs.
--
-- Live data at the time of writing: 56 track_ratings (all kept), 0 with
-- review text, 1 like, 1 comment, 0 song notifications.
--
-- Two COLUMNS are left in place on purpose: `track_ratings.review_text` and
-- `notifications.track_rating_id`. App Store / TestFlight builds from before
-- this change name both in their selects, and PostgREST fails the whole query
-- on an unknown column -- which would blank those users' profile and
-- notifications screens until they update. Both are cleared here and nothing
-- writes them any more; drop them in a follow-up once old builds age out.
--
-- Apply AFTER the web deploy that stops reading these tables.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Notifications that pointed at song posts (none today, but be exact).
DELETE FROM notifications WHERE type IN ('track_rating_like', 'track_rating_comment');

DROP TRIGGER IF EXISTS trg_notify_track_rating_like    ON track_rating_likes;
DROP TRIGGER IF EXISTS trg_notify_track_rating_comment ON track_rating_comments;
DROP FUNCTION IF EXISTS _notify_on_track_rating_like();
DROP FUNCTION IF EXISTS _notify_on_track_rating_comment();

-- Song-page comment lists; the song page is gone.
DROP FUNCTION IF EXISTS get_song_comments(uuid, text, int, int);
DROP FUNCTION IF EXISTS get_song_ratings(uuid, text, int, int);

-- get_suggested_users counted song comments and song reviews toward a user's
-- activity. This live definition was never in a migration (it was edited in place
-- after 20260926000002); captured here from pg_get_functiondef on 2026-10-08,
-- unchanged except: the replies CTE drops track_rating_comments, and song reviews
-- are no longer counted (songs CTE + ranking). Song SCORES still count, both as
-- activity and in the taste match.
CREATE OR REPLACE FUNCTION public.get_suggested_users(p_user_id uuid)
 RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, rating_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eligible AS MATERIALIZED (
    SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_bot
    FROM profiles p
    WHERE p_user_id = (SELECT auth.uid())
      AND p.id <> p_user_id
      AND p.profile_visibility <> 'Private'
      AND p.deactivated_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = p_user_id AND f.following_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocked_users b
        WHERE (b.blocker_id = p_user_id AND b.blocked_id = p.id)
           OR (b.blocker_id = p.id AND b.blocked_id = p_user_id)
      )
  ),
  albums AS (
    SELECT r.user_id, count(*) AS ratings,
           count(*) FILTER (WHERE nullif(btrim(r.review_text), '') IS NOT NULL) AS reviews
    FROM active_ratings r
    JOIN eligible e ON e.id = r.user_id
    GROUP BY r.user_id
  ),
  songs AS (
    SELECT r.user_id, count(*) AS ratings
    FROM active_track_ratings r
    JOIN eligible e ON e.id = r.user_id
    GROUP BY r.user_id
  ),
  replies AS (
    SELECT c.user_id, count(*) AS comments
    FROM rating_comments c
    JOIN eligible e ON e.id = c.user_id
    GROUP BY c.user_id
  ),
  shared_scores AS (
    SELECT theirs.user_id,
           greatest(0.0, 1.0 - abs(theirs.score - mine.score) / 4.5)::double precision AS agreement
    FROM active_ratings mine
    JOIN active_ratings theirs ON theirs.release_group_id = mine.release_group_id
    JOIN eligible e ON e.id = theirs.user_id
    WHERE mine.user_id = p_user_id AND mine.score IS NOT NULL AND theirs.score IS NOT NULL
    UNION ALL
    SELECT theirs.user_id,
           greatest(0.0, 1.0 - abs(theirs.score - mine.score) / 4.5)::double precision
    FROM active_track_ratings mine
    JOIN active_track_ratings theirs ON theirs.recording_id = mine.recording_id
    JOIN eligible e ON e.id = theirs.user_id
    WHERE mine.user_id = p_user_id AND mine.score IS NOT NULL AND theirs.score IS NOT NULL
  ),
  taste AS (
    SELECT user_id, count(*) AS shared_count, avg(agreement) AS agreement
    FROM shared_scores
    GROUP BY user_id
  )
  SELECT e.id, e.username, e.display_name, e.avatar_url,
         (coalesce(a.ratings, 0) + coalesce(s.ratings, 0))::bigint AS rating_count
  FROM eligible e
  LEFT JOIN albums a ON a.user_id = e.id
  LEFT JOIN songs s ON s.user_id = e.id
  LEFT JOIN replies r ON r.user_id = e.id
  LEFT JOIN taste t ON t.user_id = e.id
  WHERE coalesce(a.ratings, 0) + coalesce(s.ratings, 0) + coalesce(r.comments, 0) > 0
  ORDER BY e.is_bot ASC,
    (
      -- Multiple close matches beat one accidental overlap; a mismatch
      -- contributes little. Activity breaks ties and helps new users.
      12.0 * (1.0 - exp(-coalesce(t.shared_count, 0) / 3.0)) * coalesce(t.agreement, 0)
      + 0.65 * ln(1.0 + coalesce(a.ratings, 0))
      + 0.35 * ln(1.0 + coalesce(s.ratings, 0))
      + 0.80 * ln(1.0 + coalesce(a.reviews, 0) + coalesce(r.comments, 0))
    ) DESC,
    rating_count DESC,
    e.id
  LIMIT 30;
$function$;

-- Drops their RLS policies (incl. private_account_gate / deactivated_author_gate) with them.
DROP TABLE IF EXISTS track_rating_comments;
DROP TABLE IF EXISTS track_rating_likes;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like', 'comment', 'follow', 'mix_like', 'mix_share_like', 'mix_share_comment',
                  'follow_request', 'follow_accept'));

UPDATE track_ratings SET review_text = NULL WHERE review_text IS NOT NULL;

-- Nothing else may still reference the dropped tables: plpgsql bodies aren't
-- dependency-tracked, so a straggler would only fail when called. Abort instead.
DO $$
DECLARE
  stragglers text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO stragglers
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.prosrc ILIKE '%track_rating_likes%' OR p.prosrc ILIKE '%track_rating_comments%');
  IF stragglers IS NOT NULL THEN
    RAISE EXCEPTION 'functions still reference the dropped song social tables: %', stragglers;
  END IF;
END $$;

COMMIT;
