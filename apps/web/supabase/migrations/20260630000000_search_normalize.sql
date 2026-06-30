-- Work Item B — search normalization (fixes #4).
--
-- Root cause: catalog search matched raw substrings (ILIKE '%q%') with no punctuation/space
-- normalization, so "new jeans" missed "NewJeans", and "sikk" / "Sik-K" missed "Sik‐K" (which is
-- stored with a U+2010 typographic hyphen). This adds a normalized match path used by both the
-- iOS app (new RPCs) and the web (repointed lib/dbCache).
--
-- normalize_text() strips ONLY whitespace + punctuation and lowercases — it must NOT strip
-- non-ASCII letters, or Korean/Japanese native titles would collapse to empty. So we use the
-- POSIX classes [:space:] + [:punct:] (which, under the DB's UTF-8 ctype, also catches U+2010),
-- not a naive [^a-z0-9].

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── normalize_text: lower + strip spaces/punctuation (keeps Hangul/Kana/accented letters) ──
CREATE OR REPLACE FUNCTION normalize_text(t text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(t, '')), '[[:space:][:punct:]]+', '', 'g');
$$;

-- Functional trigram indexes so normalized LIKE '%q%' stays index-backed (catalog ~73k rows).
CREATE INDEX IF NOT EXISTS idx_rg_title_norm_trgm
  ON release_groups USING gin (normalize_text(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rg_artist_norm_trgm
  ON release_groups USING gin (normalize_text(artist_display) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artist_name_norm_trgm
  ON artists USING gin (normalize_text(name) gin_trgm_ops);

-- ── search_release_groups: normalized lexical + optional semantic, albums/EPs only ──
-- Returns exactly the columns the iOS `Release` model and web `AlbumRelease` mapper decode.
CREATE OR REPLACE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  artist_display     text,
  cover_url          text,
  native_title       text,
  release_group_type text,
  first_release_date text
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text
  FROM release_groups rg, nq
  WHERE rg.release_group_type IN ('album', 'ep')
    AND nq.qn <> ''
    AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
    AND (
         normalize_text(rg.title)                       LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.artist_display)              LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(rg.native_title, ''))  LIKE '%' || nq.qn || '%'
      OR word_similarity(nq.ql, lower(rg.title))          > 0.5
      OR word_similarity(nq.ql, lower(rg.artist_display)) > 0.5
    )
  ORDER BY (
      CASE WHEN normalize_text(rg.title) = nq.qn
             OR normalize_text(rg.artist_display) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(rg.title)          LIKE nq.qn || '%' THEN 500
           WHEN normalize_text(rg.artist_display) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(rg.title)),
        word_similarity(nq.ql, lower(rg.artist_display))
      ) * 1000
    + coalesce(rg.prestige_score, 0) * 2
    + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
           THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
  ) DESC
  LIMIT lim;
$$;

-- ── search_artists: normalized search over the artists table (name / native / aliases) ──
-- One row per artist → collapses credit-string splits like "Kanye West" + "Ye" into one entry.
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
         normalize_text(a.name)                      LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(a.name_native, '')) LIKE '%' || nq.qn || '%'
      OR EXISTS (
           SELECT 1 FROM artist_aliases al
           WHERE al.artist_id = a.id
             AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
         )
      OR word_similarity(nq.ql, lower(a.name)) > 0.5
    )
  ORDER BY (
      CASE WHEN normalize_text(a.name) = nq.qn
             OR normalize_text(coalesce(a.name_native, '')) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(a.name) LIKE nq.qn || '%' THEN 500 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(a.name)),
        coalesce(word_similarity(nq.ql, lower(a.name_native)), 0)
      ) * 1000
    + coalesce(a.popularity, 0)
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION normalize_text(text)                                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_release_groups(text, int, text, vector)      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_artists(text, int)                           TO anon, authenticated, service_role;
