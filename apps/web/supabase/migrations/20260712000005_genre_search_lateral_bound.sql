-- Fix: still timing out after the country gate (20260712000004). Root cause this time: some of
-- the broadened generic filter substrings (e.g. 'rap' inside the 'korean hiphop' alias) are short
-- and low-selectivity -- the trigram index still returns a large bitmap of candidate rows for
-- them, and genre_matches' single flat JOIN across ALL filters at once had no bound on that
-- candidate volume until the very end (DISTINCT ON + outer LIMIT), so a common substring could
-- still force materializing far more matching rows than lim ever needs.
--
-- Fix: bound each filter's lookup INDEPENDENTLY via a LATERAL join with its own ORDER BY + LIMIT
-- -- the exact same pattern get_taste_similar_releases already uses successfully for its per-seed
-- nearest-neighbor lookups (20260710000000_taste_similar_releases.sql: "Using a LATERAL join (one
-- index-accelerated lookup per seed, unioned) keeps every seed's lookup on the fast path" -- same
-- principle, applied per genre filter instead of per embedding seed). This lets Postgres push
-- LIMIT into each individual index probe rather than materializing an unbounded join first.
--
-- Also trimming the shortest/most generic substrings from the broadened filters added in
-- 20260712000004 ('rap' standalone, 'pop' inside the indie bucket) -- short, common substrings
-- produce a much larger trigram-index bitmap before any LIMIT can apply, and 'hip hop' alone is
-- the only tag confirmed present in the actual data (Simon Dominic's full discography) -- 'rap'/
-- 'trap' were speculative additions, not confirmed against real tags.
UPDATE genre_query_aliases SET filters = ARRAY['hip hop']
  WHERE phrase IN ('korean hip-hop','korean hip hop','korean hiphop','korean rap','k rap','k-rap');
UPDATE genre_query_aliases SET filters = ARRAY['indie','folk','ballad']
  WHERE phrase IN ('korean indie','korean indie and ballad','k indie','korean ballads','korean ballad','k ballad','korean folk','k folk');

CREATE OR REPLACE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, artist_display text, cover_url text, native_title text,
  release_group_type text, first_release_date text, artist_native text, primary_artist_id uuid
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (
    SELECT normalize_text(strip_edition_decorations(q)) AS qn,
           lower(btrim(strip_edition_decorations(q)))    AS ql
  ),
  genre_hit AS (
    SELECT gqa.filters, gqa.countries
    FROM genre_query_aliases gqa, nq
    WHERE normalize_text(gqa.phrase) = nq.qn
    LIMIT 1
  ),
  genre_filter AS (
    SELECT lower(f) AS f, genre_hit.countries AS countries
    FROM genre_hit, unnest(filters) AS f
  ),
  lexical AS (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text AS first_release_date,
           a.name_native AS artist_native, rg.primary_artist_id,
           (
              CASE WHEN normalize_text(rg.title) = nq.qn OR normalize_text(rg.artist_display) = nq.qn THEN 10000 ELSE 0 END
            + CASE WHEN normalize_text(rg.title) LIKE nq.qn || '%' THEN 500
                   WHEN normalize_text(rg.artist_display) LIKE nq.qn || '%' THEN 400 ELSE 0 END
            + GREATEST(word_similarity(nq.ql, lower(rg.title)), word_similarity(nq.ql, lower(rg.artist_display))) * 1000
            + coalesce(rg.prestige_score, 0) * 2
            + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
                   THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
           ) AS score
    FROM release_groups rg
    LEFT JOIN artists a ON a.id = rg.primary_artist_id, nq
    WHERE rg.release_group_type IN ('album', 'ep')
      AND nq.qn <> ''
      AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
      AND (
           normalize_text(rg.title)          LIKE '%' || nq.qn || '%'
        OR normalize_text(rg.artist_display) LIKE '%' || nq.qn || '%'
        OR normalize_text(rg.native_title)   LIKE '%' || nq.qn || '%'
        OR nq.ql <% lower(rg.title)
        OR nq.ql <% lower(rg.artist_display)
      )
  ),
  genre_matches AS (
    SELECT DISTINCT ON (m.id)
           m.id, m.title, m.artist_display, m.cover_url, m.native_title,
           m.release_group_type, m.first_release_date, m.artist_native, m.primary_artist_id, m.score
    FROM genre_filter gf
    CROSS JOIN LATERAL (
      SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
             rg.release_group_type, rg.first_release_date::text AS first_release_date,
             a.name_native AS artist_native, rg.primary_artist_id,
             (300 + coalesce(rg.prestige_score, 0) * 2)::double precision AS score
      FROM release_groups rg
      LEFT JOIN artists a ON a.id = rg.primary_artist_id
      WHERE _genres_text(rg.genres) LIKE '%' || gf.f || '%'
        AND rg.release_group_type IN ('album', 'ep')
        AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
        AND (gf.countries IS NULL OR a.country = ANY(gf.countries))
      ORDER BY rg.prestige_score DESC NULLS LAST
      LIMIT lim
    ) m
    WHERE NOT EXISTS (SELECT 1 FROM lexical lx WHERE lx.id = m.id)
  )
  SELECT id, title, artist_display, cover_url, native_title, release_group_type,
         first_release_date, artist_native, primary_artist_id
  FROM (
    SELECT * FROM lexical
    UNION ALL
    SELECT * FROM genre_matches
  ) combined
  ORDER BY score DESC
  LIMIT lim;
$$;
