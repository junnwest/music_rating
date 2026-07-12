-- Fix: "korean hiphop" returned zero results even after the timeout fix (20260712000002).
--
-- ROOT CAUSE (confirmed live via direct data inspection, not assumed): Korean hip-hop releases
-- in this catalog are NOT tagged with any Korea-specific genre string. Simon Dominic's entire
-- discography (DAx4, Simon Says, No Open Flames, ...) carries genres = ["hip hop"] only -- no
-- "korean hip hop"/"k-rap"/"korean" substring anywhere in the tag data. The alias filters seeded
-- in 20260712000000 for Korean-scene phrases (e.g. 'korean hiphop' -> ['k-rap','korean rap',
-- 'korean hip hop']) were matching against tag strings that essentially don't exist in the real
-- data -- genre tagging in this catalog marks GENRE, not NATIONALITY, for most content.
--
-- What DOES reliably carry nationality: artists.country (confirmed populated -- Simon Dominic =
-- 'KR'). So scene-specific queries need to gate on artist country IN ADDITION to (now broadened,
-- generic) genre tags, not rely on a Korea-specific genre tag that mostly doesn't exist.
--
-- Separately, ALSO confirmed live: much of the Korean indie catalog (e.g. 검정치마/The Black
-- Skirts, most of dress's discography) has genres = NULL entirely -- no tag of any kind. No
-- genre-matching strategy, country-gated or not, can surface a NULL-genre release via a genre
-- search -- that's a real, pre-existing catalog gap (flagged as a real risk in the original
-- plan), not something this migration attempts to paper over.

ALTER TABLE genre_query_aliases ADD COLUMN IF NOT EXISTS countries text[];

-- Broaden Korean-scene phrases to the GENERIC tags that actually appear in the data, and gate
-- them on country instead of a Korea-specific tag string.
UPDATE genre_query_aliases SET countries = ARRAY['KR'], filters = ARRAY['hip hop','rap','trap']
  WHERE phrase IN ('korean hip-hop','korean hip hop','korean hiphop','korean rap','k rap','k-rap');
UPDATE genre_query_aliases SET countries = ARRAY['KR'], filters = ARRAY['r&b','soul','rnb']
  WHERE phrase IN ('korean r&b','korean rnb','k-r&b','k r&b');
UPDATE genre_query_aliases SET countries = ARRAY['KR'], filters = ARRAY['indie','folk','ballad','pop']
  WHERE phrase IN ('korean indie','korean indie and ballad','k indie','korean ballads','korean ballad','k ballad','korean folk','k folk');
-- k-pop/kpop already match a real literal tag ("k-pop" confirmed present on ATEEZ etc.) --
-- country added as a belt-and-suspenders check, doesn't change behavior for the common case.
UPDATE genre_query_aliases SET countries = ARRAY['KR']
  WHERE phrase IN ('k-pop','kpop','korean pop','k pop');

-- Japanese-scene phrases: city pop/j-rock/visual kei appear to carry real literal tags, but
-- broaden + country-gate the same way on principle, since it costs nothing and protects against
-- the same generic-tagging pattern found on the Korean side.
UPDATE genre_query_aliases SET countries = ARRAY['JP'], filters = ARRAY['rock','alternative']
  WHERE phrase IN ('j-rock','jrock','japanese rock');
UPDATE genre_query_aliases SET countries = ARRAY['JP']
  WHERE phrase IN ('j-pop','jpop','japanese pop','city pop','visual kei');

-- search_release_groups: genre_filter now carries countries alongside each filter substring;
-- genre_matches joins artists (already joined for name_native) and applies the country gate when
-- present. Signature still unchanged -- no client-side changes.
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
      AND (gf.countries IS NULL OR a.country = ANY(gf.countries))
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
