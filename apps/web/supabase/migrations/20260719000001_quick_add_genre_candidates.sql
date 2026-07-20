-- Quick Add: candidates by genre ("Explore other genres").
--
-- Quick Add has only ever been able to look *inward*: get_quick_add_candidates takes a list of
-- artist names assembled from the user's Spotify history and their own high ratings, so it can
-- only ever return more of what they already listen to. There was no way to say "show me jazz" —
-- a user who wants to widen their taste had to leave the page.
--
-- This is the same function with the seed predicate swapped from `artist_display = ANY(...)` to
-- the genre predicate the charts already use (_rg_primary_matches: primary_genre first, falling
-- back to the raw genres array while the backfill is incomplete). Identical return columns to
-- get_quick_add_candidates so the client renders both through one code path, and the same two
-- exclusions (already rated / not interested) so a genre row never re-offers a dismissed album.
--
-- Ordering is prestige-first, unlike the artist rows' `array_position(seeds, ...)` — inside a
-- genre there is no seed order to honour, and an unfamiliar genre is only ratable from memory if
-- it leads with that genre's best-known records.

CREATE OR REPLACE FUNCTION get_quick_add_genre_candidates(
  p_user_id uuid,
  p_genre   text,
  p_lim     int DEFAULT 20,
  p_offset  int DEFAULT 0
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
  WHERE _rg_primary_matches(rg.primary_genre, rg.genres, p_genre)
    AND rg.release_group_type IN ('album', 'ep')
    AND rg.cover_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ratings r
      WHERE r.user_id = p_user_id AND r.release_group_id = rg.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM not_interested ni
      WHERE ni.user_id = p_user_id AND ni.release_group_id = rg.id
    )
  ORDER BY rg.prestige_score DESC NULLS LAST,
           rg.first_release_date DESC
  LIMIT p_lim
  OFFSET p_offset;
$$;
