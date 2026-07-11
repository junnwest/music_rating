-- Quick Add: candidate releases the user has probably already heard but hasn't rated yet.
--
-- No existing RPC excludes already-rated releases at the SQL level -- every other discovery
-- section (loadPersonalized's exploit slice, loadTasteAlbums) fetches a fixed-size batch and
-- only filters out rated releases client-side, which is fine for a one-shot list but would
-- silently under-fill a page under real pagination. This RPC does the exclusion in SQL via
-- NOT EXISTS against `ratings`, so LIMIT/OFFSET pagination returns full pages.
--
-- p_artist_names is exact-match (artist_display = ANY(...)), not fuzzy -- matches the existing
-- precedent in the iOS client's loadPersonalized() exploit-slice query (.in("artist_display",
-- seeds)), not a new matching strategy. The caller is expected to pass names already ordered by
-- confidence (Spotify top artists first, then recently-played, then Apple Music, then
-- highly-rated artist history) -- array_position() below sorts by that caller-supplied order
-- rather than computing any ranking server-side, so "most likely already heard first" is
-- entirely controlled by how the client builds the array.
CREATE OR REPLACE FUNCTION get_quick_add_candidates(
  p_user_id      uuid,
  p_artist_names text[],
  p_lim          int DEFAULT 20,
  p_offset       int DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  artist_display     text,
  cover_url          text,
  native_title       text,
  release_group_type text,
  first_release_date text
)
LANGUAGE sql STABLE AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text
  FROM release_groups rg
  WHERE rg.artist_display = ANY(p_artist_names)
    AND rg.release_group_type IN ('album', 'ep')
    AND rg.cover_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ratings r
      WHERE r.user_id = p_user_id AND r.release_group_id = rg.id
    )
  ORDER BY array_position(p_artist_names, rg.artist_display), rg.first_release_date DESC
  LIMIT p_lim
  OFFSET p_offset;
$$;
