-- Follow-up to 20260818000000_search_artists_trgm_indexed.sql -- that migration fixed the
-- word_similarity() and coalesce() index-breaking issues, but re-timing search_artists
-- afterward showed NO improvement (still ~2-4s, essentially identical to before). This
-- migration fixes the residual cause that migration's own comment already flagged as unverified.
--
-- Root cause: the alias-match arm is a correlated subquery used as an OR-arm --
--
--   OR EXISTS (
--        SELECT 1 FROM artist_aliases al
--        WHERE al.artist_id = a.id
--          AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
--      )
--
-- Each individual invocation is cheap (idx_artist_aliases_artist on artist_id makes the
-- al.artist_id = a.id lookup an index hit, and a given artist has ~1.4 aliases on average --
-- 96,719 rows / 67,629 artists). But a correlated subquery's presence as an OR-arm is exactly
-- the same disease as the word_similarity() arm the prior migration fixed: Postgres can't fold
-- it into a bitmap index scan on the OUTER `artists` table, so it forces a full sequential scan
-- of all 67,629 artists rows regardless of how well-indexed the OTHER four arms now are -- since
-- a BitmapOr needs every single arm to be index-backed, not just most of them.
--
-- Fix: hoist the alias match into its own CTE, computed ONCE (not once per artists row), so the
-- outer WHERE only ever needs `a.id IN (SELECT ... FROM matched_alias_artists)` -- a semi-join
-- against `artists`'s own primary key, which Postgres CAN combine with the other index-backed
-- arms. New GIN trgm index on `artist_aliases (normalize_text(alias))` so the CTE's own scan is
-- index-backed too, rather than trading a 67k-row seq scan for a 96k-row one.
--
-- ORDER BY's own alias-exact-match EXISTS is untouched, same reasoning as before: it only runs
-- over the already-filtered, already-small result set, never the expensive part.
--
-- USER: apply via the Supabase SQL editor, then re-time search_artists to confirm this is
-- actually what was left.

CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias_norm_trgm
  ON artist_aliases USING gin (normalize_text(alias) gin_trgm_ops);

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
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql),
       matched_alias_artists AS (
         SELECT DISTINCT al.artist_id
         FROM artist_aliases al, nq
         WHERE normalize_text(al.alias) LIKE '%' || nq.qn || '%'
       )
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count,
         ARRAY(SELECT al.alias FROM artist_aliases al WHERE al.artist_id = a.id LIMIT 25) AS aliases
  FROM artists a, nq
  WHERE nq.qn <> ''
    -- Must have something to show: mirrors get_artist_release_groups' primary UNION credited.
    AND (
         EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
      OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
    )
    AND (
         normalize_text(a.name)             LIKE '%' || nq.qn || '%'
      OR normalize_text(a.name_native)      LIKE '%' || nq.qn || '%'
      OR normalize_text(a.name_phonetic_ko) LIKE '%' || nq.qn || '%'
      OR a.id IN (SELECT artist_id FROM matched_alias_artists)
      OR nq.ql <% lower(a.name)
    )
  ORDER BY (
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
    + coalesce(a.popularity, 0)
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_artists(text, int) TO anon, authenticated, service_role;
