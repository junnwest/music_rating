-- Completely remove Instinct mode (pairwise Elo-based comparison rating).
--
-- Product decision: Instinct mode is gone, not hidden behind a flag. Every user's
-- existing Instinct-only ratings (score IS NULL, elo_score IS NOT NULL) are converted
-- to a manual score BEFORE anything is dropped, using the exact same elo->score
-- logistic curve already live in _rating_display_score() (itself documented as a
-- mirror of web's lib/elo.ts eloToScore() and iOS's Elo.toScore) -- so the converted
-- value matches what was already being displayed to the user as their score. No
-- rating is lost; only the pairwise-comparison mechanism goes away.
--
-- Ordering matters: backfill scores first, THEN drop the columns/tables the backfill
-- and the live _taste_profile_sync trigger depend on. _taste_profile_sync is a live
-- AFTER INSERT/UPDATE/DELETE trigger on `ratings` -- it must be redefined to stop
-- referencing elo_score in the SAME migration that drops the column, or every future
-- rating write starts throwing.
--
-- Rollout note: any app build still capable of writing rating_mode/elo_score (a user
-- on an old App Store version) will error against this schema once applied. Apply
-- after the Instinct-removal app builds are live, not before.

BEGIN;

-- ── 1. Backfill: elo-only ratings get an equivalent manual score ────────────────
UPDATE ratings
  SET score = _rating_display_score(score, elo_score)
  WHERE score IS NULL AND elo_score IS NOT NULL;

UPDATE track_ratings
  SET score = _rating_display_score(score, elo_score)
  WHERE score IS NULL AND elo_score IS NOT NULL;

-- ── 2. Redefine the live trigger BEFORE dropping elo_score (see ordering note) ──
CREATE OR REPLACE FUNCTION _taste_profile_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_genres text[];
  v_old numeric;
  v_new numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := NEW.score;
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
    PERFORM _taste_apply(
      NEW.user_id,
      CASE WHEN v_new IS NULL THEN NULL ELSE v_genres END,
      COALESCE(v_new, 3.0) - 3.0, 1, 1
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old := OLD.score;
    v_new := NEW.score;

    IF OLD.release_group_id IS DISTINCT FROM NEW.release_group_id THEN
      -- treat as remove + add (rare; unique(user, rg) makes this an edge case)
      IF v_old IS NOT NULL THEN
        SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = OLD.release_group_id;
        PERFORM _taste_apply(OLD.user_id, v_genres, -(v_old - 3.0), -1, 0);
      END IF;
      IF v_new IS NOT NULL THEN
        SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
        PERFORM _taste_apply(NEW.user_id, v_genres, v_new - 3.0, 1, 0);
      END IF;
      RETURN NEW;
    END IF;

    IF v_old IS NULL AND v_new IS NULL THEN
      RETURN NEW; -- nothing scored either side
    END IF;
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = NEW.release_group_id;
    IF v_old IS NULL THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, v_new - 3.0, 1, 0);
    ELSIF v_new IS NULL THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, -(v_old - 3.0), -1, 0);
    ELSIF v_old <> v_new THEN
      PERFORM _taste_apply(NEW.user_id, v_genres, v_new - v_old, 0, 0);
    END IF;
    RETURN NEW;

  ELSE -- DELETE
    v_old := OLD.score;
    SELECT rg.genres INTO v_genres FROM release_groups rg WHERE rg.id = OLD.release_group_id;
    PERFORM _taste_apply(
      OLD.user_id,
      CASE WHEN v_old IS NULL THEN NULL ELSE v_genres END,
      -(COALESCE(v_old, 3.0) - 3.0), CASE WHEN v_old IS NULL THEN 0 ELSE -1 END, -1
    );
    RETURN OLD;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Never block a rating write over taste bookkeeping; a full recompute (see this
  -- feature's own migration, 20260712000009) can always re-derive state.
  RAISE WARNING 'taste_profile_sync failed (op %, user %): %', TG_OP,
    COALESCE(NEW.user_id, OLD.user_id), SQLERRM;
  RETURN COALESCE(NEW, OLD);
END
$$;

-- ── 3. Drop the elo->score conversion helper -- nothing left to convert from ────
DROP FUNCTION IF EXISTS _rating_display_score(numeric, numeric);

-- ── 4. Redefine functions that read elo_score/rating_mode, dropping those reads ─
-- get_charts_pulse: was `score IS NOT NULL OR elo_score IS NOT NULL` for
-- total_ratings; after the backfill above every elo-only rating now also has
-- `score` set, so this counts the exact same rows going forward.
CREATE OR REPLACE FUNCTION get_charts_pulse()
RETURNS TABLE(total_ratings bigint, avg_score numeric, today_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COUNT(*) FILTER (WHERE score IS NOT NULL),
    ROUND(AVG(score) FILTER (WHERE score IS NOT NULL)::numeric, 2),
    COUNT(*) FILTER (WHERE created_at > now() - interval '1 day')
  FROM ratings;
$$;

-- get_rankings_unlock_status: same "OR elo_score IS NOT NULL" removal, same
-- backfill-preserves-the-count reasoning as above, in all three CTEs.
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
    FROM ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE COALESCE(p.is_bot, false) = false
      AND r.score IS NOT NULL
  ),
  bot_events AS (
    SELECT COUNT(*) AS n
    FROM ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE p.is_bot = true
      AND r.score IS NOT NULL
  ),
  album_prestige_covered_cte AS (
    SELECT COUNT(*) AS n
    FROM (
      SELECT r.release_group_id
      FROM ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      WHERE r.score IS NOT NULL AND rg.prestige_score IS NOT NULL
      GROUP BY r.release_group_id
      HAVING COUNT(*) >= 3
    ) covered
  ),
  song_events_cte AS (
    SELECT COUNT(*) AS n
    FROM track_ratings
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

GRANT EXECUTE ON FUNCTION get_rankings_unlock_status() TO anon, authenticated, service_role;

-- get_profile_album_ratings / get_profile_song_ratings: drop elo_score from the
-- output shape entirely (iOS's Codable decode is updated in the same pass as this
-- migration to stop expecting it).
CREATE OR REPLACE FUNCTION get_profile_album_ratings(p_user_id uuid, p_subtab text)
RETURNS TABLE(id uuid, score numeric, review_text text,
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
    SELECT r.id, r.score, r.review_text, r.created_at,
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

CREATE OR REPLACE FUNCTION get_profile_song_ratings(p_user_id uuid, p_subtab text)
RETURNS TABLE(recording_id uuid, score numeric,
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
    SELECT tr.recording_id, tr.score, rec.title,
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

-- ── 5. Drop Instinct-specific tables (fully self-contained, nothing references them) ─
DROP TABLE IF EXISTS pairwise_comparisons;
DROP TABLE IF EXISTS track_pairwise_comparisons;

-- ── 6. Drop Instinct-specific columns ────────────────────────────────────────────
ALTER TABLE ratings DROP COLUMN IF EXISTS elo_score;
ALTER TABLE ratings DROP COLUMN IF EXISTS elo_games;
ALTER TABLE track_ratings DROP COLUMN IF EXISTS elo_score;
ALTER TABLE track_ratings DROP COLUMN IF EXISTS elo_games;
-- Drops profiles_rating_mode_check along with the column.
ALTER TABLE profiles DROP COLUMN IF EXISTS rating_mode;

COMMIT;
