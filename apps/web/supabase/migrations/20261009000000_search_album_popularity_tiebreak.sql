-- ════════════════════════════════════════════════════════════════════════════
-- Album search: break exact-match ties by artist popularity.  2026-10-09
-- ════════════════════════════════════════════════════════════════════════════
--
-- Searching "SWAG" put 8ruki's single in Top Match ("최적의 결과") instead of
-- Justin Bieber's album: every album titled exactly SWAG scored the same
-- 11500 (exact 10000 + prefix 500 + similarity 1000), and the only popularity
-- term, prestige_score, is null for nearly all of them (critic-derived; a
-- 2025 album has none). Ties fell in arbitrary order. Same for "Adele",
-- "Coldplay", "Justin Bieber" -- an unknown act's same-named album first.
--
-- Adds the primary artist's popularity (artists.popularity, 0-100, filled for
-- 64,607 of 113,049 artists as of today) x 3 to every album score, in both the
-- long-query (search_release_groups_long) and short-query / by-artist paths
-- (search_release_groups). 0-300 points: orders ties and near-ties, can't lift
-- a non-exact match over an exact one (10000), and keeps albums (<= 11800)
-- below exact artist hits (12000+), so Top Match's artist-first behaviour holds.
-- search_artists already adds popularity x 1.
--
-- Drift guard: get_suggested_users turned out to have been edited in place in
-- the live DB (2026-10-08). Both functions are rewritten here from the repo
-- definitions (20260929000001, 20260930000001), so the migration first checks
-- the live bodies are still those, and aborts rather than overwrite anything
-- it hasn't seen. If it aborts, send the live pg_get_functiondef.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  long_md5  text;
  short_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO long_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.oid = 'public.search_release_groups_long(text, int, text, vector)'::regprocedure;
  SELECT md5(p.prosrc) INTO short_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.oid = 'public.search_release_groups(text, int, text, vector)'::regprocedure;
  IF long_md5 IS DISTINCT FROM '34829f2253e60a0b89fe4cb2fff0fc01' THEN
    RAISE EXCEPTION 'search_release_groups_long differs from 20260929000001 (live md5 %) -- not overwriting', long_md5;
  END IF;
  IF short_md5 IS DISTINCT FROM 'c52a9d1ff2db042a1152a5d359ada642' THEN
    RAISE EXCEPTION 'search_release_groups differs from 20260930000001 (live md5 %) -- not overwriting', short_md5;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION search_release_groups_long(
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
            + coalesce(a.popularity, 0) * 3
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
             (1200 + coalesce(rg.prestige_score, 0) * 2 + coalesce(a.popularity, 0) * 3)::double precision AS score
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
            + coalesce(a.popularity, 0) * 3
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
LANGUAGE plpgsql STABLE AS $fn$
#variable_conflict use_column
DECLARE
  qn text := normalize_text(strip_edition_decorations(q));
BEGIN
  IF qn IS NULL OR qn = '' THEN
    RETURN;
  END IF;

  IF char_length(qn) >= 3 THEN
    RETURN QUERY
    WITH long AS (
      SELECT * FROM search_release_groups_long(q, lim, yr, query_embedding)
    ),
    arts AS (
      SELECT a.id FROM artists a
      WHERE normalize_text(a.name) = qn
         OR normalize_text(a.name_native) = qn
         OR normalize_text(a.name_phonetic_ko) = qn
      UNION
      SELECT aa.artist_id FROM artist_aliases aa WHERE normalize_text(aa.alias) = qn
      LIMIT 20
    ),
    by_artist AS (
      SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
             rg.release_group_type, rg.first_release_date::text, a.name_native, rg.primary_artist_id,
             (9000 + coalesce(rg.prestige_score, 0) * 2 + coalesce(a.popularity, 0) * 3)::double precision
      FROM arts
      JOIN release_groups rg ON rg.primary_artist_id = arts.id
      LEFT JOIN artists a ON a.id = rg.primary_artist_id
      WHERE (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
        AND NOT EXISTS (SELECT 1 FROM long l WHERE l.id = rg.id)
    )
    SELECT * FROM (SELECT * FROM long UNION ALL SELECT * FROM by_artist) x
    ORDER BY 10 DESC
    LIMIT lim;
    RETURN;
  END IF;

  RETURN QUERY
  WITH arts AS (
    SELECT a.id FROM artists a
    WHERE normalize_text(a.name) = qn
       OR normalize_text(a.name_native) = qn
       OR normalize_text(a.name_phonetic_ko) = qn
    UNION
    SELECT aa.artist_id FROM artist_aliases aa WHERE normalize_text(aa.alias) = qn
    LIMIT 20
  ),
  hits AS (
    SELECT r.id, 10000 AS s FROM release_groups r WHERE normalize_text(r.title) = qn
    UNION ALL
    SELECT r.id, 10000 FROM release_groups r WHERE normalize_text(r.native_title) = qn
    UNION ALL
    SELECT r.id, 9000 FROM release_groups r JOIN arts ON r.primary_artist_id = arts.id
    UNION ALL
    (SELECT r.id, 500 FROM release_groups r
      WHERE normalize_text(r.title) ~>=~ qn AND normalize_text(r.title) ~<~ (qn || chr(1114111))
      LIMIT 400)
  ),
  best AS (SELECT h.id, max(h.s) AS s FROM hits h GROUP BY h.id)
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title,
         rg.release_group_type, rg.first_release_date::text, a.name_native, rg.primary_artist_id,
         (best.s + coalesce(rg.prestige_score, 0) * 2 + coalesce(a.popularity, 0) * 3)::double precision
  FROM best
  JOIN release_groups rg ON rg.id = best.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE yr IS NULL OR rg.first_release_date::text LIKE yr || '%'
  ORDER BY 10 DESC, rg.title
  LIMIT lim;
END;
$fn$;

COMMIT;
