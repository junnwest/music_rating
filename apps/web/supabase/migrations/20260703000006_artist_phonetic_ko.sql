-- Korean phonetic search aliases (Windows handoff task #2).
--
-- Problem: a Korean user searching "드레이크" (the standard Korean phonetic rendering of "Drake")
-- finds nothing, because no Korean transliteration is stored for non-Korean artists. The search
-- code already normalizes + trigram-matches correctly — this is purely a missing-data problem.
--
-- Design (per handoff): a SEPARATE column, NOT an overload of name_native. name_native means
-- "this artist's actual native-script identity" (IU = 아이유). name_phonetic_ko means "the standard
-- Korean phonetic spelling a Korean would type to find this artist" (Drake = 드레이크). Conflating
-- them would reintroduce exactly the ambiguity the 2026-07-03 native-name cleanup removed.
--
-- Source: Korean Wikipedia interlanguage links (backfill-phonetic-ko.ts). No return-signature change
-- to search_artists, so no iOS/web client changes are needed — the new column only widens matching.

ALTER TABLE artists ADD COLUMN IF NOT EXISTS name_phonetic_ko text;

-- Functional trigram index so normalized LIKE '%q%' on the phonetic column stays index-backed.
CREATE INDEX IF NOT EXISTS idx_artist_phonetic_ko_norm_trgm
  ON artists USING gin (normalize_text(name_phonetic_ko) gin_trgm_ops);

-- Rebuild search_artists to also match/rank the phonetic column. Identical RETURN signature to
-- 20260630000000 (id, name, name_native, genres, popularity, cover_url, release_count) — the
-- phonetic column participates only in WHERE + ORDER BY, never in the projection.
CREATE OR REPLACE FUNCTION search_artists(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id            uuid,
  name          text,
  name_native   text,
  genres        text,
  popularity    int,
  cover_url     text,
  release_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count
  FROM artists a, nq
  WHERE nq.qn <> ''
    AND (
         normalize_text(a.name)                          LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(a.name_native, ''))     LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(a.name_phonetic_ko, '')) LIKE '%' || nq.qn || '%'
      OR EXISTS (
           SELECT 1 FROM artist_aliases al
           WHERE al.artist_id = a.id
             AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
         )
      OR word_similarity(nq.ql, lower(a.name)) > 0.5
    )
  ORDER BY (
      CASE WHEN normalize_text(a.name) = nq.qn
             OR normalize_text(coalesce(a.name_native, '')) = nq.qn
             OR normalize_text(coalesce(a.name_phonetic_ko, '')) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(a.name) LIKE nq.qn || '%' THEN 500 ELSE 0 END
    + CASE WHEN normalize_text(coalesce(a.name_phonetic_ko, '')) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(a.name)),
        coalesce(word_similarity(nq.ql, lower(a.name_native)), 0)
      ) * 1000
    + coalesce(a.popularity, 0)
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_artists(text, int) TO anon, authenticated, service_role;
