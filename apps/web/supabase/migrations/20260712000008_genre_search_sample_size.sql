-- Fix: "korean hiphop" quality regressed after dropping the inner ORDER BY (20260712000006) --
-- shifted from Beenzino/G-Dragon/Epik High to less-relevant K-pop co-tag hits (Stray Kids, NMIXX).
--
-- ROOT CAUSE: the per-filter LATERAL already scores by prestige (1200 + prestige_score*2, not
-- actually flat), and the OUTER combined query already does `ORDER BY score DESC` correctly --
-- but that outer sort can only rank whatever survived the INNER `LIMIT lim` cutoff. With no inner
-- ORDER BY (needed to avoid the earlier timeout), that cutoff grabs an arbitrary/scan-order sample
-- of matching rows, not necessarily the most prestigious ones -- so for a broad match set, the
-- handful that happen to be sampled may well be low-prestige K-pop co-tag noise rather than the
-- artists a user would actually expect.
--
-- Fix: widen the inner sample (LIMIT GREATEST(lim * 5, 150) instead of LIMIT lim) -- still an
-- unordered, early-exit-capable scan (bounded cost regardless of total match count, same
-- reasoning as 20260712000006), just a bigger pool for the outer prestige-aware sort to actually
-- choose from. Worst case ~5 filters * 150 rows = 750 candidates before the outer sort, trivial.

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
             (1200 + coalesce(rg.prestige_score, 0) * 2)::double precision AS score
      FROM release_groups rg
      LEFT JOIN artists a ON a.id = rg.primary_artist_id
      WHERE _genres_text(rg.genres) LIKE '%' || gf.f || '%'
        AND rg.release_group_type IN ('album', 'ep')
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
