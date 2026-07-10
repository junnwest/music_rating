-- Romanization-aware matching (fixes the largest coverage-looking bug found by
-- the 2026-07-10 verify-coverage baseline).
--
-- PROBLEM: search_artists already MATCHES an artist via its romanized alias
-- (e.g. "HYUKOH" for the row whose canonical name is the Hangul "혁오"), but it
-- only PROJECTS name / name_native. The iOS resolveArtist()/fetchRelease()
-- confidence gate then checks the returned name/name_native against the query
-- ("Hyukoh") for bidirectional substring overlap — which FAILS for a native-
-- script name — so the correct, already-in-catalog artist is thrown away. This
-- silently breaks Spotify/Apple matching for essentially every CJK-named artist
-- whose romanization lives only in artist_aliases (the core target audience).
-- Measured: 8 of 9 "artist misses" in the baseline were this, each with a full
-- 7–68 release-group discography already ingested.
--
-- FIX (DB half): give the gate the data it needs to say yes.
--   1. search_artists now RETURNS `aliases text[]` — the client gate can accept
--      a candidate when the query overlaps any alias, not just name/native.
--   2. search_artists now also counts an EXACT alias match in the top (+10000)
--      ranking tier, so the right native-named artist can't be pushed past `lim`
--      by Latin-script fuzzy noise (was happening for "Jannabi": 잔나비 ranked
--      3rd behind "Enzo Jannacci"/"Janna Blbulyan").
--   3. search_release_groups now RETURNS `primary_artist_id uuid` — so the album
--      gate can match a recently-played album by resolved artist id instead of a
--      brittle native-vs-romanized artist_display string compare.
--
-- Both changes are ADDITIVE columns. supabase-js / Swift decode RPC rows by key,
-- so existing callers that don't read the new keys are unaffected. The client
-- gate changes that consume these ship alongside (iOS SearchView, harness).
--
-- Rebuilt from the LIVE definitions (pg_get_functiondef, 2026-07-10), NOT the
-- original migration files — search_release_groups had already gained an
-- `artist_native` column + artists LEFT JOIN + the <% index-backed operator in a
-- later perf migration; all of that is preserved verbatim here.

-- Adding OUT columns changes the return type, which CREATE OR REPLACE can't do
-- (42P13) — DROP + CREATE inside one transaction so there's no window where the
-- function is missing, and a CREATE failure rolls the DROP back.
BEGIN;

DROP FUNCTION IF EXISTS search_artists(text, int);
DROP FUNCTION IF EXISTS search_release_groups(text, int, text, vector);

-- ── search_artists: + aliases[] projection, + alias-exact ranking ────────────
CREATE OR REPLACE FUNCTION search_artists(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id            uuid,
  name          text,
  name_native   text,
  genres        text,
  popularity    int,
  cover_url     text,
  release_count bigint,
  aliases       text[]
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count,
         ARRAY(SELECT al.alias FROM artist_aliases al WHERE al.artist_id = a.id LIMIT 25) AS aliases
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
             OR normalize_text(coalesce(a.name_phonetic_ko, '')) = nq.qn
             OR EXISTS (
                  SELECT 1 FROM artist_aliases al
                  WHERE al.artist_id = a.id AND normalize_text(al.alias) = nq.qn
                ) THEN 10000 ELSE 0 END
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

-- ── search_release_groups: + primary_artist_id projection (rest verbatim) ────
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
  first_release_date text,
  artist_native      text,
  primary_artist_id  uuid
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text,
         a.name_native, rg.primary_artist_id
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

GRANT EXECUTE ON FUNCTION search_artists(text, int)                      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_release_groups(text, int, text, vector) TO anon, authenticated, service_role;

COMMIT;
