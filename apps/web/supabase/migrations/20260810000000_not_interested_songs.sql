-- "Not interested" for songs -- the album-only `not_interested` table (20260719000000) has no
-- song/recording equivalent, so a user has no way to tell the recommender "not this track"
-- short of ignoring it forever, and get_quick_add_song_candidates keeps re-surfacing it.
--
-- Deliberately a SECOND simple table, not a nullable `recording_id` column bolted onto
-- `not_interested`: a single table with two mutually-exclusive nullable target columns needs a
-- partial unique index per target (Postgres can't express one non-partial unique constraint
-- across "release_group_id OR recording_id" cleanly), and Supabase's client-side
-- `.upsert(onConflict:)` can't attach a `WHERE` predicate to the conflict target, so it can't
-- address a partial index at all. Two plain composite-PK tables (same shape as `not_interested`
-- itself, and as `blocked_users`) sidestep that entirely and leave the working album table
-- byte-for-byte untouched.
CREATE TABLE IF NOT EXISTS not_interested_songs (
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id)
);

CREATE INDEX IF NOT EXISTS idx_not_interested_songs_recording_id
  ON not_interested_songs(recording_id);

ALTER TABLE not_interested_songs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own not_interested_songs"
  ON not_interested_songs FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── Quick Add (songs): exclude dismissed tracks at the source ───────────────────────────────
-- Same body as 20260713000000 (per-album cap preserved) plus one added NOT EXISTS, mirroring
-- the album RPC's existing not_interested exclusion. Signature and columns unchanged, so no
-- client change is required for the exclusion to take effect.
CREATE OR REPLACE FUNCTION get_quick_add_song_candidates(
  p_user_id      uuid,
  p_artist_names text[],
  p_lim          int DEFAULT 20,
  p_offset       int DEFAULT 0
)
RETURNS TABLE (
  id             uuid,
  title          text,
  artist_display text,
  cover_url      text,
  album_title    text
)
LANGUAGE sql STABLE AS $$
  WITH matches AS (
    SELECT DISTINCT ON (r.id)
           r.id, r.title, r.artist_display, rg.id AS rg_id, rg.cover_url,
           rg.title AS album_title, rg.prestige_score, rt.position
    FROM recordings r
    JOIN release_tracks rt ON rt.recording_id = r.id
    JOIN releases rel ON rel.id = rt.release_id
    JOIN release_groups rg ON rg.id = rel.release_group_id
    WHERE r.artist_display = ANY(p_artist_names)
      AND rg.cover_url IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM track_ratings tr
        WHERE tr.user_id = p_user_id AND tr.recording_id = r.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM not_interested_songs nis
        WHERE nis.user_id = p_user_id AND nis.recording_id = r.id
      )
    ORDER BY r.id, rel.is_canonical DESC NULLS LAST, rg.prestige_score DESC NULLS LAST
  ),
  capped AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY rg_id ORDER BY position) AS rn
    FROM matches
  )
  SELECT id, title, artist_display, cover_url, album_title
  FROM capped
  WHERE rn <= 4
  ORDER BY array_position(p_artist_names, artist_display), prestige_score DESC NULLS LAST, position
  LIMIT p_lim
  OFFSET p_offset;
$$;
