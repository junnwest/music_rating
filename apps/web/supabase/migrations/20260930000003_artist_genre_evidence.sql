-- Artist-level genre evidence for album placement (GENRE_AUDIT.md §8, 2026-09-29).
-- (Numbered 20260930000003: first written as 20260929000001, renumbered on merge to
-- avoid colliding with 20260929000001_short_query_search. Already applied live.)
--
-- The taste map now places an album in its world by weighted evidence: the album's
-- own tags plus an ARTIST PRIOR (lib/genres/placement.ts). The prior's outside
-- sources are stored here, per artist, as fetched:
--
--   { "musicbrainz": [["hip hop", 12], ...],   -- MB artist genres + vote counts
--     "lastfm":      [["korean hip hop", 100], ...],  -- Last.fm top tags (by MB id)
--     "wikidata":    ["hip-hop", "k-pop"],     -- Wikidata P136 genre labels
--     "fetched_at":  { "musicbrainz": "...", "lastfm": "...", "wikidata": "..." } }
--
-- Written by mb-ingest (musicbrainz, on every ingest / freshness re-poll) and
-- scripts/backfill-artist-genres.ts (all three). Additive; nothing reads it except
-- /api/taste/profile. artists.genres (always empty) is left alone.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS genre_evidence jsonb;

-- get_community_album_scores gains primary_artist_id (so community albums get the
-- same artist prior as the user's own) and no longer drops untagged albums — they
-- are placed by their artist now. The return type changes, so drop + recreate.
DROP FUNCTION IF EXISTS get_community_album_scores();
CREATE FUNCTION get_community_album_scores()
RETURNS TABLE (
  release_group_id uuid,
  score_sum        numeric,
  score_count      bigint,
  title            text,
  native_title     text,
  genres           text[],
  title_language   text,
  artist_country   text,
  artist_native_language text,
  primary_artist_id uuid,
  artist_name      text
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
    a.native_language,
    a.id,
    a.name
  FROM active_ratings r
  JOIN release_groups rg ON rg.id = r.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE r.score IS NOT NULL
  GROUP BY rg.id, a.id
  ORDER BY rg.id;
$$;

REVOKE ALL ON FUNCTION get_community_album_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_community_album_scores() TO service_role;
