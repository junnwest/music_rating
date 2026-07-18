-- search_release_groups has hardcoded `release_group_type IN ('album', 'ep')` since it was
-- first written, silently excluding singles, compilations, and soundtracks from every fuzzy
-- search result -- flagged as a known gap in an earlier session ("worth widening the type
-- filter at the source rather than relying on every caller to route around it") but deferred
-- until now, when it directly broke iOS's Recently Listened catalog-matching: singles are
-- 169,564 of 413,812 release_groups (41% of the whole catalog, the single largest type), and any
-- Spotify/Apple Music single whose title isn't a byte-for-byte exact match (near-certain given
-- their "(feat. X)"/edition suffixes) fell through to this RPC and vanished, even though it
-- genuinely exists in the catalog.
--
-- Not gated behind a narrower allowlist (e.g. adding just 'single') -- dropping the filter
-- entirely covers the remaining 'compilation'/'soundtrack' types too, and the existing
-- prestige_score-weighted scoring (both CTEs already rank by `coalesce(prestige_score, 0) * 2`,
-- on top of a 10000-point exact-title-match bonus) means a low-prestige single won't crowd out
-- an artist's real albums for a broad artist-name search -- it only surfaces prominently when the
-- query is specific enough to actually match it well.

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
    WHERE nq.qn <> ''
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
             (1200 + coalesce(rg.prestige_score, 0) * 2)::double precision AS score
      FROM release_groups rg
      LEFT JOIN artists a ON a.id = rg.primary_artist_id
      WHERE _genres_text(rg.genres) LIKE '%' || gf.f || '%'
        AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
        AND (gf.countries IS NULL OR a.country = ANY(gf.countries))
      LIMIT GREATEST(lim * 5, 150)
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
