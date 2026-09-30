-- Per-album community score aggregates + the metadata the language resolver
-- needs, for the Taste page's "you vs the community" (2026-09-29).
--
-- The comparison moved off get_user_genre_standings (raw tags, so a Korean rock
-- album counted as plain "rock"; and it read `ratings`, so deactivated accounts
-- were still averaged in). /api/taste/profile now places every community-rated
-- album on the taste map in Node (lib/taste/worlds.ts — genre × language) and
-- averages per world. This function only supplies the per-album rows.
--
-- Reads active_ratings (deactivated accounts excluded, like every other
-- aggregate). Scores are aggregated, never per-user. One row per rated album
-- that has genres; ordered by id so callers can page past PostgREST's row cap.
-- Read-only; get_user_genre_standings is left in place, unused by the web.
CREATE OR REPLACE FUNCTION get_community_album_scores()
RETURNS TABLE (
  release_group_id uuid,
  score_sum        numeric,
  score_count      bigint,
  title            text,
  native_title     text,
  genres           text[],
  title_language   text,
  artist_country   text,
  artist_native_language text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rg.id,
    SUM(r.score)::numeric,
    COUNT(*)::bigint,
    rg.title,
    rg.native_title,
    rg.genres,
    rg.title_language,
    a.country,
    a.native_language
  FROM active_ratings r
  JOIN release_groups rg ON rg.id = r.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE r.score IS NOT NULL
    AND rg.genres IS NOT NULL
    AND cardinality(rg.genres) > 0
  GROUP BY rg.id, a.id
  ORDER BY rg.id;
$$;

REVOKE ALL ON FUNCTION get_community_album_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_community_album_scores() TO service_role;
