-- Fix: genre-phrase search (20260712000000) hit statement timeout (57014) in production.
--
-- ROOT CAUSE: the genre branch checked `EXISTS (SELECT 1 FROM unnest(genre_hit.filters) f WHERE
-- _rg_has_genre(rg.genres, f))` as a CORRELATED subquery evaluated once per outer release_groups
-- row -- Postgres has no index that accelerates this shape (it's not an independent lookup, it's
-- a per-row computation during a full sequential scan of ~295k+ rows), regardless of what index
-- exists on the table. The GIN array index added in 20260712000001 doesn't help either: GIN on a
-- text[] column accelerates && / @> (exact-value overlap), not substring matching -- exactly the
-- honest caveat that migration's own header already flagged, confirmed the hard way.
--
-- FIX: restructure genre matching as a real JOIN against a small set of filter strings, so each
-- filter becomes an independent, index-accelerated lookup (a nested-loop probe per filter, same
-- mechanism the existing lexical branch already uses successfully for
-- `normalize_text(rg.title) LIKE '%' || nq.qn || '%'` against idx_rg_title_norm_trgm -- a
-- runtime-bound pattern against a trigram index, not a hardcoded literal). This needs a NEW
-- trigram index on the genres array flattened to text (see the paired
-- 20260712000003_genre_text_trgm_index.sql -- run that one separately, same CONCURRENTLY
-- constraint as before).
--
-- Genre matches are queried as their own CTE and excluded if the row already matched lexically
-- (NOT EXISTS against the lexical CTE) rather than merged into one giant scored UNION -- simpler,
-- avoids needing to reconcile two different scoring scales for the same row.
--
-- `array_to_string` on its own isn't recognized as IMMUTABLE-enough for direct use in an index
-- expression (confirmed live: 42P17) -- same class of problem normalize_text() was already
-- written to work around. Wrapped here in an explicit IMMUTABLE SQL function; the paired index
-- migration (20260712000003) builds its trigram index on this EXACT same function call, since
-- Postgres matches expression indexes syntactically -- the query below has to call
-- `_genres_text(rg.genres)` verbatim, not just something equivalent, for the index to be used.
CREATE OR REPLACE FUNCTION _genres_text(g text[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(array_to_string(coalesce(g, ARRAY[]::text[]), ' '));
$$;

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
    SELECT gqa.filters
    FROM genre_query_aliases gqa, nq
    WHERE normalize_text(gqa.phrase) = nq.qn
    LIMIT 1
  ),
  genre_filter AS (
    SELECT lower(f) AS f FROM genre_hit, unnest(filters) AS f
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
    SELECT DISTINCT ON (rg.id)
           rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text AS first_release_date,
           a.name_native AS artist_native, rg.primary_artist_id,
           (300 + coalesce(rg.prestige_score, 0) * 2)::double precision AS score
    FROM genre_filter gf
    JOIN release_groups rg
      ON _genres_text(rg.genres) LIKE '%' || gf.f || '%'
    LEFT JOIN artists a ON a.id = rg.primary_artist_id
    WHERE rg.release_group_type IN ('album', 'ep')
      AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
      AND NOT EXISTS (SELECT 1 FROM lexical lx WHERE lx.id = rg.id)
    LIMIT lim
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
