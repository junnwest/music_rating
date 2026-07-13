-- get_quick_add_song_candidates had no per-album cap, so a page was just an artist's entire
-- unrated tracklist in album order (e.g. all 11 tracks of "Actual Life 3" before any other
-- artist/album showed up) -- reported as "not sophisticated, just lists entire tracklists."
-- Same flooding problem loadPersonalized()'s exploit slice and loadTasteAlbums() already solve
-- on the album side (cap 3 albums/artist) -- applied here as a cap of 4 tracks/album so a page
-- mixes across an artist's discography (and across artists) instead of exhausting one album.
--
-- No per-song popularity signal exists in the schema (recordings has no play-count/chart data),
-- so "first 4 tracks in tracklist order" is the available proxy, not a claim of picking the
-- artist's most popular songs.
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
