-- Content-based "similar to what you loved" discovery for the Add tab's "For You" section.
--
-- release_groups.embedding (Jina v3, HNSW-indexed) already exists and is currently only ever
-- used to score text-query search results (search_release_groups) -- never for "given albums
-- this user rated highly, find musically similar new artists." This RPC is that lookup.
--
-- embedding is a general-purpose TEXT embedding (mb-enrich.ts's buildText(): "{title} by
-- {artist} / {native_title}. {genres} ({year})"), not an audio/music-similarity embedding --
-- confirmed live that pure embedding distance is noisy for this purpose: seeding with Simon
-- Dominic's "DAx4" (hip hop) returned Da-iCE (J-pop), Colton Dixon (Christian pop), SHISHAMO
-- (J-pop/rock) -- almost every result shared the digit "4" in its title ("D4", "4th Album",
-- "Mr.4", "SHISHAMO 4"), i.e. the embedding was clustering on title-string tokens, not genre.
-- Gated on genre array overlap (rg.genres && seed.genres) so embedding distance only ranks
-- *within* genre-matching candidates instead of letting that text noise dominate. Falls back to
-- ungated embedding distance only when the seed itself has no genres tagged (~13% of rows).
--
-- Takes multiple seed releases (a user's own top-rated albums) rather than one, since a single
-- seed skews recommendations toward one album's specific sound. A naive multi-seed query (e.g.
-- averaging embeddings, or a CROSS JOIN + GROUP BY MIN across all seeds) would force a full
-- sequential scan -- pgvector's HNSW index only accelerates a single-vector `ORDER BY ... LIMIT`.
-- Using a LATERAL join (one index-accelerated nearest-neighbor lookup per seed, unioned) keeps
-- every seed's lookup on the fast path.
CREATE OR REPLACE FUNCTION get_taste_similar_releases(
  p_seed_ids        uuid[],
  p_exclude_artists text[] DEFAULT NULL,
  p_per_seed        int    DEFAULT 8,
  p_lim             int    DEFAULT 30
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
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Widen HNSW's per-scan candidate window for this call only (SET LOCAL is scoped to the
  -- current transaction -- for a single RPC call, that's exactly this function's execution).
  -- Confirmed live: with the genre-overlap + exclude-artist filters attached, the default
  -- window returned only 1 genre-matching candidate for a seed genre with 38k tagged rows in
  -- the table -- the ANN search finds its nearest neighbors by raw embedding distance first,
  -- then discards almost all of them post-filter, instead of searching wide enough to satisfy
  -- the filter. Using set_config() here (a runtime call) rather than a function-level `SET`
  -- clause on the CREATE FUNCTION statement -- the SQL editor's role can create the function
  -- fine either way, but Supabase rejects the function-level form for this extension GUC at
  -- definition time ("permission denied to set parameter"); set_config() at call time doesn't
  -- hit that check.
  --
  -- 150, not the 300 first tried -- confirmed live that per-seed HNSW traversal cost scales
  -- with ef_search roughly independent of p_per_seed's final LIMIT: at 300, 4 seeds completed
  -- in ~3.3s but 5 seeds reliably hit the statement timeout (57014), even with p_per_seed
  -- turned down to 3. Caller-side seed count is now capped at 3 (see iOS) to leave real margin
  -- rather than riding right at the observed failure boundary.
  PERFORM set_config('hnsw.ef_search', '150', true);

  RETURN QUERY
  WITH seeds AS (
    SELECT rg.id AS seed_id, rg.embedding AS seed_embedding, rg.genres AS seed_genres
    FROM release_groups rg
    WHERE rg.id = ANY(p_seed_ids) AND rg.embedding IS NOT NULL
  ),
  matches AS (
    SELECT DISTINCT ON (m.id)
           m.id, m.title, m.artist_display, m.cover_url,
           m.native_title, m.release_group_type, m.first_release_date, m.dist
    FROM seeds s
    CROSS JOIN LATERAL (
      SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
             rg.release_group_type, rg.first_release_date,
             rg.embedding <=> s.seed_embedding AS dist
      FROM release_groups rg
      WHERE rg.embedding IS NOT NULL
        AND rg.id <> ALL(p_seed_ids)
        AND coalesce(rg.release_group_type, '') <> 'single'
        AND (p_exclude_artists IS NULL OR NOT (rg.artist_display = ANY(p_exclude_artists)))
        -- Requires overlap on 2+ genres when the seed has that many, not just any single shared
        -- tag -- confirmed live that a lone shared broad genre (e.g. both ATEEZ and Roy Orbison
        -- tagged "pop") let the filter through, and within that loose set the embedding's
        -- title-text contamination took back over (ATEEZ's "GOLDEN HOUR" matched Roy Orbison's
        -- "A Golden Hour Of..." on the shared phrase, not on any real style similarity). A
        -- seed with only 1 genre tagged still just needs that 1 to match (2+ would be
        -- impossible), and an untagged seed (~13% of rows) stays ungated.
        AND (
             s.seed_genres IS NULL OR cardinality(s.seed_genres) = 0
          OR (SELECT count(*) FROM unnest(rg.genres) g WHERE g = ANY(s.seed_genres))
             >= LEAST(2, cardinality(s.seed_genres))
        )
      ORDER BY rg.embedding <=> s.seed_embedding
      LIMIT p_per_seed
    ) m
    ORDER BY m.id, m.dist
  )
  SELECT matches.id, matches.title, matches.artist_display, matches.cover_url,
         matches.native_title, matches.release_group_type, matches.first_release_date::text
  FROM matches
  ORDER BY matches.dist
  LIMIT p_lim;
END;
$$;
