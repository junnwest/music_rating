-- search_artists and search_release_groups each compute a relevance `score`
-- internally (exact match = 10000, prefix match ~400-500, trigram similarity
-- * 1000, plus a small popularity/prestige boost -- both use the same scale
-- on purpose) but never returned it: search_release_groups computed it only
-- to ORDER BY, then dropped it from the final SELECT; search_artists never
-- named it as a column at all, just inlined the expression into ORDER BY.
--
-- The web search bar (apps/web/app/(main)/search/page.tsx) runs these as two
-- independent queries and rendered them as fixed sections -- Artists always
-- above Albums, regardless of which one actually matched better. Exposing
-- `score` lets the client compare "best artist match" against "best album
-- match" directly (same scale, see above) and promote whichever is the
-- stronger match to a "Top Match" card above both sections.

-- Both RETURNS TABLE shapes below gain a `score` column, and Postgres rejects
-- CREATE OR REPLACE FUNCTION for a changed return signature (must drop first) --
-- same reason 20260706000017 and 20260710000001 had to do this for these same
-- two functions.
DROP FUNCTION IF EXISTS search_artists(text, int);
DROP FUNCTION IF EXISTS search_release_groups(text, int, text, vector);

CREATE OR REPLACE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, artist_display text, cover_url text, native_title text,
  release_group_type text, first_release_date text, artist_native text, primary_artist_id uuid,
  score double precision
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (
    SELECT normalize_text(strip_edition_decorations(q)) AS qn,
           lower(btrim(strip_edition_decorations(q)))    AS ql
  ),
  qwords AS (
    SELECT words FROM (
      SELECT array_agg(DISTINCT w) AS words
      FROM (SELECT unnest(regexp_split_to_array(nq.ql, '\s+')) AS w FROM nq) t
      WHERE length(w) >= 3 AND normalize_text(w) <> ''
    ) s
    WHERE array_length(words, 1) BETWEEN 2 AND 5
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
  ),
  word_hits AS (
    SELECT w, wc.id
    FROM qwords
    CROSS JOIN LATERAL unnest(qwords.words) AS w
    CROSS JOIN LATERAL (
      SELECT rg.id
      FROM release_groups rg
      WHERE normalize_text(rg.title)          LIKE '%' || normalize_text(w) || '%'
         OR normalize_text(rg.artist_display) LIKE '%' || normalize_text(w) || '%'
         OR w <% lower(rg.title)
         OR w <% lower(rg.artist_display)
      LIMIT 3000
    ) wc
  ),
  word_candidates AS (
    SELECT id FROM word_hits
    GROUP BY id
    HAVING count(DISTINCT w) >= (SELECT array_length(words, 1) FROM qwords)
  ),
  combined_matches AS (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
           rg.release_group_type, rg.first_release_date::text AS first_release_date,
           a.name_native AS artist_native, rg.primary_artist_id,
           (
              9000
            + coalesce(rg.prestige_score, 0) * 2
            + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
                   THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
           ) AS score
    FROM word_candidates wc
    JOIN release_groups rg ON rg.id = wc.id
    LEFT JOIN artists a ON a.id = rg.primary_artist_id
    WHERE NOT EXISTS (SELECT 1 FROM lexical lx WHERE lx.id = rg.id)
      AND NOT EXISTS (SELECT 1 FROM genre_matches gm WHERE gm.id = rg.id)
  )
  SELECT id, title, artist_display, cover_url, native_title, release_group_type,
         first_release_date, artist_native, primary_artist_id, score
  FROM (
    SELECT * FROM lexical
    UNION ALL
    SELECT * FROM genre_matches
    UNION ALL
    SELECT * FROM combined_matches
  ) combined
  ORDER BY score DESC
  LIMIT lim;
$$;

CREATE OR REPLACE FUNCTION search_artists(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id            uuid,
  name          text,
  name_native   text,
  genres        text,
  popularity    int,
  cover_url     text,
  release_count bigint,
  aliases       text[],
  score         double precision
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql),
  candidates AS (
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name_native) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND normalize_text(a.name_phonetic_ko) LIKE '%' || nq.qn || '%'
    UNION
    SELECT al.artist_id AS id FROM artist_aliases al, nq
    WHERE nq.qn <> '' AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
    UNION
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND nq.ql <% lower(a.name)
  )
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count,
         ARRAY(SELECT al.alias FROM artist_aliases al WHERE al.artist_id = a.id LIMIT 25) AS aliases,
         (
            CASE WHEN normalize_text(a.name) = nq.qn
                   OR normalize_text(a.name_native) = nq.qn
                   OR normalize_text(a.name_phonetic_ko) = nq.qn
                   OR EXISTS (
                        SELECT 1 FROM artist_aliases al
                        WHERE al.artist_id = a.id AND normalize_text(al.alias) = nq.qn
                      ) THEN 10000 ELSE 0 END
          + CASE WHEN normalize_text(a.name) LIKE nq.qn || '%' THEN 500 ELSE 0 END
          + CASE WHEN normalize_text(a.name_phonetic_ko) LIKE nq.qn || '%' THEN 400 ELSE 0 END
          + GREATEST(
              word_similarity(nq.ql, lower(a.name)),
              coalesce(word_similarity(nq.ql, lower(a.name_native)), 0)
            ) * 1000
          + coalesce(a.popularity, 0)
         ) AS score
  FROM candidates c
  JOIN artists a ON a.id = c.id
  CROSS JOIN nq
  WHERE EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
     OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
  ORDER BY score DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_artists(text, int) TO anon, authenticated, service_role;
