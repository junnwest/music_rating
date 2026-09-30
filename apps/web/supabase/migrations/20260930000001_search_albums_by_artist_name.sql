-- Album search finds an artist's albums by their Korean / alternate names
-- (2026-09-30). "에픽하이" returned 0 albums while search_artists found Epik
-- High: the artist is stored as name "Epik High" with name_phonetic_ko
-- "에픽하이" and aliases (에픽 하이, Epik Hai...), but search_release_groups
-- only ever compared the query to rg.title / rg.artist_display /
-- rg.native_title. Same for "이센스" (E SENS). Confirmed live 2026-09-30.
--
-- Fix: an exact artist-name branch on BOTH paths of the router from
-- 20260929000001. The query's normalize_text form is matched against
-- artists.name / name_native / name_phonetic_ko and artist_aliases.alias --
-- all btree-indexed (20260926000001) -- and that artist's release groups
-- (idx_release_groups_artist) are added at score 9000 + prestige, the same
-- tier as a combined-word hit, below an exact title match (10000).
-- search_release_groups_long is untouched; its rows win on duplicates.

BEGIN;

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
             (9000 + coalesce(rg.prestige_score, 0) * 2)::double precision
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
         (best.s + coalesce(rg.prestige_score, 0) * 2)::double precision
  FROM best
  JOIN release_groups rg ON rg.id = best.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE yr IS NULL OR rg.first_release_date::text LIKE yr || '%'
  ORDER BY 10 DESC, rg.title
  LIMIT lim;
END;
$fn$;

COMMIT;
