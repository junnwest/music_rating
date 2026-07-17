-- Quick Add's PURPOSE is albums the user has probably already heard, so they can rate from
-- memory. The original get_quick_add_candidates ordered each known artist's albums by
-- first_release_date DESC (newest first) -- which surfaces an artist's most OBSCURE recent
-- release before the famous album that's the actual reason the user knows them. Reported as
-- "recommends stuff I don't know."
--
-- Fix: order by prestige within each artist (rg.prestige_score DESC), release date only as a
-- tiebreaker -- so the artist's most acclaimed/known work leads. This mirrors the ordering the
-- song counterpart (get_quick_add_song_candidates, 20260713000000) already uses
-- (array_position, then prestige_score DESC). Signature, columns, exclusion (NOT EXISTS against
-- ratings), and pagination are all unchanged -- purely a re-order of the same result set, so no
-- client change is required.
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
  ORDER BY array_position(p_artist_names, rg.artist_display),
           rg.prestige_score DESC NULLS LAST,
           rg.first_release_date DESC
  LIMIT p_lim
  OFFSET p_offset;
$$;
