-- ════════════════════════════════════════════════════════════════════════════
-- Ranked comments for album + song pages, and per-track rating stats.
-- 2026-09-26 · WEB_CHANGE_PROMPTS_2 P5 / P6 / P7
-- ════════════════════════════════════════════════════════════════════════════
--
-- A "comment" is a rating with review_text: `ratings.review_text` for albums,
-- `track_ratings.review_text` for songs. Its likes are `rating_likes` /
-- `track_rating_likes`, its replies `rating_comments` / `track_rating_comments`.
-- (The old `comment_likes` table from 20260508000001 points at the retired
-- `reviews` table and is not used here.)
--
-- ── "Top" ranking (_comment_rank) ─────────────────────────────────────────
--   score = ( 1.00 · ln(1 + likes)                        engagement, log-damped:
--           + 0.50 · ln(1 + replies)                       one like never beats substance
--           + 1.20 · min(ln(1 + max(chars − 12, 0)) / ln(601), 1)
--                                                          substance: ≤12 chars ("good!") ≈ 0,
--                                                          diminishing, capped at ~600 chars
--           + 0.15 · ln(1 + author followers)              credibility
--           + 0.10 · min(ln(1 + author ratings) / ln(501), 1)
--           + 0.20 · min(|score − album avg|, 2)           an interesting (divergent) take
--           + 0.30 if the viewer follows the author )      personal
--         × role weight (_comment_role_weight: verified 1.25, else 1.0 —
--           the hook for critic/other roles once a role column exists)
--         × (0.6 + 0.4 · 2^(−age_days / 45))               gentle recency: 45-day half-life
--                                                          on 40% of the score (evergreen)
--   Per-author cap: ratings are unique per (user, album) and (user, recording),
--   so an author can hold at most one slot by construction.
--   Near-duplicates: under Top, short comments (<25 alnum chars) that normalise
--   to the same text collapse to their best-ranked copy. Other sorts list all.
--
-- ── Privacy ───────────────────────────────────────────────────────────────
--   Filtering happens BEFORE ranking/pagination, so reordering can never
--   surface a comment the viewer may not see: RLS on ratings/track_ratings
--   (security invoker) + the author's catalog visibility (_sj_can_view) +
--   deactivated authors + blocks in either direction + moderated/self-reported
--   ratings. The last two need rows the viewer can't read under RLS
--   (blocked_users only shows your own blocks; reports is admin-only), so they
--   live in one narrow SECURITY DEFINER predicate that returns a boolean only.
--   The viewer's own comment is excluded — the page pins it from its own state.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE INDEX IF NOT EXISTS idx_reports_rating_id ON reports (rating_id);

CREATE OR REPLACE FUNCTION _comment_role_weight(p_is_verified boolean)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p_is_verified, false) THEN 1.25 ELSE 1.0 END;
$$;

CREATE OR REPLACE FUNCTION _comment_rank(
  p_likes bigint, p_replies bigint, p_chars int, p_followers bigint, p_author_ratings bigint,
  p_is_verified boolean, p_age_days double precision, p_divergence double precision, p_followed boolean
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT (
      1.00 * ln(1 + p_likes)
    + 0.50 * ln(1 + p_replies)
    + 1.20 * least(ln(1 + greatest(p_chars - 12, 0)) / ln(601), 1.0)
    + 0.15 * ln(1 + p_followers)
    + 0.10 * least(ln(1 + p_author_ratings) / ln(501), 1.0)
    + 0.20 * least(COALESCE(p_divergence, 0), 2.0)
    + CASE WHEN p_followed THEN 0.30 ELSE 0 END
  ) * _comment_role_weight(p_is_verified)
    * (0.6 + 0.4 * power(2.0, -greatest(p_age_days, 0) / 45.0));
$$;

-- True when this viewer must not see this author's comment (block either way),
-- or the album rating was actioned by moderation / reported by the viewer.
CREATE OR REPLACE FUNCTION _comment_hidden_for(p_author uuid, p_viewer uuid, p_rating_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (p_viewer IS NOT NULL AND EXISTS (
       SELECT 1 FROM blocked_users b
       WHERE (b.blocker_id = p_viewer AND b.blocked_id = p_author)
          OR (b.blocker_id = p_author AND b.blocked_id = p_viewer)))
    OR (p_rating_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM reports rp
       WHERE rp.rating_id = p_rating_id
         AND (rp.status = 'actioned'
              OR (p_viewer IS NOT NULL AND rp.reporter_id = p_viewer AND rp.status <> 'dismissed'))));
$$;
REVOKE ALL ON FUNCTION _comment_hidden_for(uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION _comment_hidden_for(uuid, uuid, uuid) TO anon, authenticated;

-- ── Album comments ─────────────────────────────────────────────────────────
-- p_sort: 'top' | 'newest' | 'highest' | 'lowest' | 'following'
DROP FUNCTION IF EXISTS get_album_comments(uuid, text, int, int);
CREATE FUNCTION get_album_comments(
  p_release_group_id uuid, p_sort text DEFAULT 'top', p_limit int DEFAULT 20, p_offset int DEFAULT 0
) RETURNS TABLE (
  rating_id uuid, user_id uuid, username text, display_name text, avatar_url text,
  is_verified boolean, score numeric, review_text text, created_at timestamptz,
  likes bigint, replies bigint, liked_by_me boolean, author_followers bigint,
  rank_score double precision, total_count bigint
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH viewer AS (SELECT auth.uid() AS id),
  album_avg AS (
    SELECT avg(score)::double precision AS a FROM ratings
    WHERE release_group_id = p_release_group_id AND score IS NOT NULL
  ),
  base AS (
    SELECT r.id, r.user_id, r.score, r.review_text, r.created_at,
           p.username, p.display_name, p.avatar_url, COALESCE(p.is_verified, false) AS is_verified
    FROM ratings r
    JOIN profiles p ON p.id = r.user_id
    CROSS JOIN viewer v
    WHERE r.release_group_id = p_release_group_id
      AND r.review_text IS NOT NULL AND length(btrim(r.review_text)) > 0
      AND r.user_id IS DISTINCT FROM v.id
      AND p.deactivated_at IS NULL
      AND _sj_can_view(p.id, v.id, COALESCE(p.catalog_visibility, p.profile_visibility))
      AND NOT _comment_hidden_for(r.user_id, v.id, r.id)
      AND (p_sort <> 'following' OR EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.following_id = r.user_id))
  ),
  enriched AS (
    SELECT b.*,
      (SELECT count(*) FROM rating_likes l WHERE l.rating_id = b.id) AS likes,
      (SELECT count(*) FROM rating_comments c WHERE c.rating_id = b.id) AS replies,
      EXISTS (SELECT 1 FROM rating_likes l, viewer v WHERE l.rating_id = b.id AND l.user_id = v.id) AS liked_by_me,
      (SELECT count(*) FROM follows f WHERE f.following_id = b.user_id) AS followers,
      (SELECT count(*) FROM ratings r2 WHERE r2.user_id = b.user_id) AS author_ratings,
      EXISTS (SELECT 1 FROM follows f, viewer v WHERE f.follower_id = v.id AND f.following_id = b.user_id) AS followed,
      lower(regexp_replace(b.review_text, '[^[:alnum:]]+', '', 'g')) AS norm
    FROM base b
  ),
  ranked AS (
    SELECT e.*,
      _comment_rank(e.likes, e.replies, length(e.review_text), e.followers, e.author_ratings, e.is_verified,
                    extract(epoch FROM now() - e.created_at) / 86400.0,
                    abs(e.score::double precision - (SELECT a FROM album_avg)), e.followed) AS rs
    FROM enriched e
  ),
  deduped AS (
    SELECT rk.*, row_number() OVER (
      PARTITION BY CASE WHEN length(rk.norm) BETWEEN 1 AND 24 THEN rk.norm ELSE rk.id::text END
      ORDER BY rk.rs DESC, rk.id) AS dup_rank
    FROM ranked rk
  )
  SELECT d.id, d.user_id, d.username, d.display_name, d.avatar_url, d.is_verified, d.score,
         d.review_text, d.created_at, d.likes, d.replies, d.liked_by_me, d.followers, d.rs,
         count(*) OVER () AS total_count
  FROM deduped d
  WHERE d.dup_rank = 1 OR p_sort <> 'top'
  ORDER BY
    CASE WHEN p_sort = 'top' THEN d.rs END DESC NULLS LAST,
    CASE WHEN p_sort = 'highest' THEN d.score END DESC NULLS LAST,
    CASE WHEN p_sort = 'lowest' THEN d.score END ASC NULLS LAST,
    d.created_at DESC, d.id
  LIMIT least(greatest(p_limit, 1), 50) OFFSET greatest(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION get_album_comments(uuid, text, int, int) TO anon, authenticated;

-- ── Song comments (same ranking over track_ratings) ─────────────────────────
DROP FUNCTION IF EXISTS get_song_comments(uuid, text, int, int);
CREATE FUNCTION get_song_comments(
  p_recording_id uuid, p_sort text DEFAULT 'top', p_limit int DEFAULT 20, p_offset int DEFAULT 0
) RETURNS TABLE (
  track_rating_id uuid, user_id uuid, username text, display_name text, avatar_url text,
  is_verified boolean, score numeric, review_text text, created_at timestamptz,
  likes bigint, replies bigint, liked_by_me boolean, author_followers bigint,
  rank_score double precision, total_count bigint
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH viewer AS (SELECT auth.uid() AS id),
  song_avg AS (
    SELECT avg(score)::double precision AS a FROM track_ratings
    WHERE recording_id = p_recording_id AND score IS NOT NULL
  ),
  base AS (
    SELECT r.id, r.user_id, r.score, r.review_text, r.created_at,
           p.username, p.display_name, p.avatar_url, COALESCE(p.is_verified, false) AS is_verified
    FROM track_ratings r
    JOIN profiles p ON p.id = r.user_id
    CROSS JOIN viewer v
    WHERE r.recording_id = p_recording_id
      AND r.review_text IS NOT NULL AND length(btrim(r.review_text)) > 0
      AND r.user_id IS DISTINCT FROM v.id
      AND p.deactivated_at IS NULL
      AND _sj_can_view(p.id, v.id, COALESCE(p.catalog_visibility, p.profile_visibility))
      AND NOT _comment_hidden_for(r.user_id, v.id, NULL)
      AND (p_sort <> 'following' OR EXISTS (
            SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.following_id = r.user_id))
  ),
  enriched AS (
    SELECT b.*,
      (SELECT count(*) FROM track_rating_likes l WHERE l.track_rating_id = b.id) AS likes,
      (SELECT count(*) FROM track_rating_comments c WHERE c.track_rating_id = b.id) AS replies,
      EXISTS (SELECT 1 FROM track_rating_likes l, viewer v WHERE l.track_rating_id = b.id AND l.user_id = v.id) AS liked_by_me,
      (SELECT count(*) FROM follows f WHERE f.following_id = b.user_id) AS followers,
      (SELECT count(*) FROM ratings r2 WHERE r2.user_id = b.user_id) AS author_ratings,
      EXISTS (SELECT 1 FROM follows f, viewer v WHERE f.follower_id = v.id AND f.following_id = b.user_id) AS followed,
      lower(regexp_replace(b.review_text, '[^[:alnum:]]+', '', 'g')) AS norm
    FROM base b
  ),
  ranked AS (
    SELECT e.*,
      _comment_rank(e.likes, e.replies, length(e.review_text), e.followers, e.author_ratings, e.is_verified,
                    extract(epoch FROM now() - e.created_at) / 86400.0,
                    abs(e.score::double precision - (SELECT a FROM song_avg)), e.followed) AS rs
    FROM enriched e
  ),
  deduped AS (
    SELECT rk.*, row_number() OVER (
      PARTITION BY CASE WHEN length(rk.norm) BETWEEN 1 AND 24 THEN rk.norm ELSE rk.id::text END
      ORDER BY rk.rs DESC, rk.id) AS dup_rank
    FROM ranked rk
  )
  SELECT d.id, d.user_id, d.username, d.display_name, d.avatar_url, d.is_verified, d.score,
         d.review_text, d.created_at, d.likes, d.replies, d.liked_by_me, d.followers, d.rs,
         count(*) OVER () AS total_count
  FROM deduped d
  WHERE d.dup_rank = 1 OR p_sort <> 'top'
  ORDER BY
    CASE WHEN p_sort = 'top' THEN d.rs END DESC NULLS LAST,
    CASE WHEN p_sort = 'highest' THEN d.score END DESC NULLS LAST,
    CASE WHEN p_sort = 'lowest' THEN d.score END ASC NULLS LAST,
    d.created_at DESC, d.id
  LIMIT least(greatest(p_limit, 1), 50) OFFSET greatest(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION get_song_comments(uuid, text, int, int) TO anon, authenticated;

-- ── Per-track community stats (album tracklist + song page) ────────────────
-- PostgREST aggregates are disabled on this project, and a raw select of every
-- track_ratings row hits the 1000-row cap on popular albums. `dist` is ten
-- 0.5-wide buckets (0.5 … 5.0), the same bucketing as the album histogram.
DROP FUNCTION IF EXISTS get_track_rating_stats(uuid[]);
CREATE FUNCTION get_track_rating_stats(p_recording_ids uuid[])
RETURNS TABLE (recording_id uuid, rating_count bigint, avg_score double precision, dist int[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH b AS (
    SELECT t.recording_id, t.score,
           least(greatest(round(t.score * 2)::int - 1, 0), 9) AS bucket
    FROM track_ratings t
    WHERE t.recording_id = ANY(p_recording_ids) AND t.score IS NOT NULL
  )
  SELECT b.recording_id, count(*), avg(b.score)::double precision,
         (SELECT array_agg(COALESCE(x.n, 0) ORDER BY g.i)
          FROM generate_series(0, 9) AS g(i)
          LEFT JOIN (SELECT b2.bucket, count(*)::int AS n FROM b b2
                     WHERE b2.recording_id = b.recording_id GROUP BY b2.bucket) x ON x.bucket = g.i)
  FROM b
  GROUP BY b.recording_id;
$$;
GRANT EXECUTE ON FUNCTION get_track_rating_stats(uuid[]) TO anon, authenticated;

COMMIT;
