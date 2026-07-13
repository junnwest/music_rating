-- Quick Add "Songs" mode: the song-level counterpart to get_quick_add_candidates
-- (20260710000005_quick_add_candidates.sql). Same shape -- artist-name-array match,
-- NOT EXISTS exclusion of already-rated content, priority-ordered, offset-paginated -- applied
-- to recordings instead of release_groups.
--
-- recordings has no cover/prestige of its own -- both come from the parent release_group via
-- release_tracks -> releases (is_canonical) -> release_groups, the same two-hop join
-- fetchSongResultsRaw (SearchView.swift) already does client-side for song search results.
-- DISTINCT ON (r.id) picks one canonical release per recording, same tiebreak
-- fetchSongResultsRaw already uses (prefer is_canonical, else first-seen -- here: prefer
-- is_canonical, else highest prestige_score, deterministic either way).
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
           r.id, r.title, r.artist_display, rg.cover_url, rg.title AS album_title, rg.prestige_score
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
    ORDER BY r.id, rel.is_canonical DESC NULLS LAST, rg.prestige_score DESC NULLS LAST
  )
  SELECT id, title, artist_display, cover_url, album_title
  FROM matches
  ORDER BY array_position(p_artist_names, artist_display), prestige_score DESC NULLS LAST
  LIMIT p_lim
  OFFSET p_offset;
$$;
