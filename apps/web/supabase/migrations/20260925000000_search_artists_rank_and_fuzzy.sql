-- search_artists: rank by whether the artist actually has music, and tolerate a misspelling.
--
-- TWO REPORTED FAILURES, ONE FUNCTION.
--
-- 1. "when i search 'kid', i see 9 artists that i've never heard of but not kid cudi, kid milli".
--    The score was:
--        10000 exact name/alias  +  500 name prefix  +  400 phonetic prefix
--      + word_similarity * 1000  +  coalesce(popularity, 0)
--    For a whole-word query every "Kid X" artist scores 500 + 1000 = exactly 1500, a flat tie
--    broken arbitrarily by whatever order the scan returned. Nothing in the formula asked whether
--    the artist has any releases, so empty credit stubs (Kid Kapri, Kid Commando, Kid Cruise -- 0
--    releases each) outranked Kid Rock (52) and pushed Kid Cudi (61) off the first page entirely.
--    The one term meant to discriminate, `popularity`, is a dead Spotify column: 0 of 72,179 rows
--    are populated, so it has always added exactly 0.
--
--    Fix: add LEAST(release_count, 60) * 25. Capped so a 600-release compilation artist cannot
--    dominate on catalogue size alone, and weighted so a full discography (1500) is worth about the
--    same as a prefix+word match -- enough to sort real artists above empty stubs without
--    overpowering an exact-name hit (10000).
--
-- 2. "kid kudi" returned NOTHING while Kid Cudi sat in the catalogue with 61 releases. The fuzzy
--    branch uses `<%`, whose pg_trgm.word_similarity_threshold defaults to 0.6; similarity between
--    "kid kudi" and "kid cudi" is 0.545, so a single transposed letter made a major artist
--    invisible. Adding a `%` branch (similarity_threshold, default 0.3) catches it. `%` is
--    index-accelerated by idx_artists_name_lower_trgm, unlike a bare similarity() > x predicate.
--    Guarded to queries of 4+ characters so short inputs do not fuzzy-match half the catalogue.
--
-- The candidate set is otherwise unchanged, as is the existing requirement that an artist have at
-- least one release or credit to appear at all.

CREATE OR REPLACE FUNCTION public.search_artists(q text, lim integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, name_native text, genres text, popularity integer,
               cover_url text, release_count bigint, aliases text[], score double precision)
 LANGUAGE sql
 STABLE
AS $function$
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
    UNION
    -- Misspelling tolerance. `%` uses similarity_threshold (0.3) rather than `<%`'s
    -- word_similarity_threshold (0.6), which is what excluded "kid kudi" -> "Kid Cudi" at 0.545.
    SELECT a.id FROM artists a, nq
    WHERE nq.qn <> '' AND length(nq.ql) >= 4 AND lower(a.name) % nq.ql
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
          -- Catalogue depth. Breaks the flat tie that let empty credit stubs outrank real artists.
          + LEAST((SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id), 60) * 25
          + coalesce(a.popularity, 0)
         ) AS score
  FROM candidates c
  JOIN artists a ON a.id = c.id
  CROSS JOIN nq
  WHERE EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
     OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
  ORDER BY score DESC
  LIMIT lim;
$function$;
