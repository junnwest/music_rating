-- search_release_groups fuzzy-matches the whole query string against `title` and
-- `artist_display` INDEPENDENTLY -- it never considers them together. So a query that
-- combines both, e.g. "Masta Wu Father" for the "Father" EP by artist "Masta Wu", fails
-- both the substring LIKE and the trigram similarity (`<%`) checks: the full phrase is
-- not a substring of either field alone, and the extra words from the other field dilute
-- word_similarity() below the match threshold on both sides at once. Reproduced live:
-- searching "Father" alone finds it at rank 1, "Masta Wu" alone finds it at rank 4, but
-- "masta wu father" -- the natural way to search for a specific release -- returns a
-- single, unrelated result, and "Masta Wu Father EP" returns zero. The release itself is
-- fine (correctly ingested, linked, has cover art); this is purely a search-matching gap,
-- and it isn't specific to this release -- any combined artist+title query can hit it.
--
-- FIRST ATTEMPT AT THIS FIX (matching against `artist_display || ' ' || title`
-- concatenated) was reverted within minutes of deploying: per 20260706000017's own
-- lesson, Postgres can only build a BitmapOr plan when EVERY arm of the WHERE's OR is
-- index-backed, and a concatenated expression has no matching index -- it forced a full
-- seq scan of release_groups on EVERY query, timing out even previously-instant ones
-- ("Father" alone went from <100ms to 57014 statement timeout).
--
-- CORRECT FIX: never touch the OR-of-single-field arms (proven fast, untouched below).
-- Add a SEPARATE candidate source, `combined_matches`, that only activates for a 2-5
-- word query and works by searching for EACH WORD INDIVIDUALLY -- using the exact same
-- index-backed shape as the existing single-term arms (idx_rg_title_norm_trgm /
-- idx_rg_artist_norm_trgm / idx_rg_title_lower_trgm / idx_rg_artist_lower_trgm), just
-- parameterized per word instead of per whole query -- then INTERSECTs the per-word hit
-- sets (via a GROUP BY ... HAVING count) so only release groups where EVERY word matched
-- somewhere across title-or-artist survive. This never computes a new expression over
-- the full table: each word's lookup is a small indexed scan, exactly like the query
-- already does once per search; running it 2-5 times and intersecting is cheap.

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
  -- 2-5 meaningful words only, each >= 3 chars. Below 3 chars pg_trgm can't form a
  -- full trigram (the same documented limit 20260706000017 already lives with for
  -- single-term search), so the GIN index barely filters and Postgres has to
  -- recheck a huge fraction of the table per short word -- measured live: a 2-char
  -- word ("wu") ballooned this from ~120ms to ~8.6s (160k rows recheck vs. 264).
  -- Dropping short words from the AND-set (rather than requiring them) trades a
  -- little precision for keeping every word here cheaply indexed.
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
  -- One index-backed lookup per word (same 4-arm shape as `lexical`'s single-term
  -- OR, same CROSS JOIN LATERAL shape genre_matches below already uses to force a
  -- per-row parameterized index probe instead of a plain join, which a bare JOIN
  -- ON here planned as a full seq scan per word -- caught by EXPLAIN before this
  -- was considered fixed). Capped at 3000 hits/word, matching genre_matches' own
  -- defensive LIMIT, so one very common word can't blow up the candidate set.
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
  -- Keep only groups where EVERY word hit somewhere (across either field) --
  -- i.e. the query's artist token(s) and title token(s) both matched, just not
  -- necessarily on the same field.
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
              -- Just under a single-field exact match (10000): a true one-field
              -- exact hit should still win ties over a combined-field match.
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
         first_release_date, artist_native, primary_artist_id
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
