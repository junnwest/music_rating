-- Fix: "kpop" timed out even after the LATERAL+LIMIT restructuring (20260712000005).
--
-- ROOT CAUSE: unlike 'hip hop'+KR (a small matching set -- Korean hip-hop is a narrow slice of
-- the catalog), 'k-pop' is a large, well-covered genre here (thousands of tagged release_groups).
-- The per-filter LATERAL subquery's `ORDER BY rg.prestige_score DESC NULLS LAST LIMIT lim` cannot
-- early-exit a scan when the filter's matching set is large: prestige_score isn't covered by the
-- trigram index used for the WHERE clause, so Postgres has no way to retrieve rows already in
-- prestige order -- it must fetch and sort the ENTIRE matching bitmap before LIMIT can cut it
-- down. LIMIT only bounds cost when there's no ORDER BY forcing full materialization first (a
-- LIMIT-without-ORDER-BY scan can stop as soon as it has enough rows; a LIMIT-with-ORDER-BY scan
-- generally can't, unless the sort itself is index-satisfied).
--
-- Fix: drop the ORDER BY inside the per-filter lookup. Genre-tier results no longer come back in
-- strict prestige order among themselves, but they're already a single flat 300-point score tier
-- below all real lexical matches -- losing internal ordering there is a reasonable trade for
-- actually not timing out on common genres. The final SELECT's outer `ORDER BY score DESC` still
-- sorts the full (now small, bounded) combined result set correctly.

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
