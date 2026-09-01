-- Fix search_artists statement latency (2-4s per call, confirmed live via a timed script:
-- 4110ms cold / ~2000ms warm against `artists` at 67,629 rows).
--
-- Symptom this was traced from: the iOS artist page still read as "a few seconds to load" even
-- after this session's own query-merging fix to ArtistPageView.load() -- because that fix only
-- addressed client-side round trips. This RPC is the actual bottleneck, and it's entirely
-- server-side: `resolveArtistId` (SearchView.swift) calls it, unconditionally, on every artist
-- page navigation that doesn't already carry a resolved UUID (i.e. every tap from Add tab's
-- Spotify/Apple Music rows), and it runs BEFORE the page's own parallel releases/artist-row fetch
-- even starts.
--
-- Root cause: the identical disease already diagnosed and fixed for search_release_groups in
-- 20260706000017_search_rg_trgm_indexed.sql (see that file for the full mechanism writeup), but
-- never ported over to search_artists -- which kept carrying the same anti-pattern forward
-- through every later revision (20260703000006, 20260710000001, 20260728000000) without anyone
-- revisiting it once catalog scale caught up:
--
--   1. `word_similarity(nq.ql, lower(a.name)) > 0.5` is a plain function call, never an index
--      qual (only the `<%` operator is). Postgres can only build a BitmapOr across an OR clause
--      when EVERY arm is index-backed -- one non-indexable arm forces a full seq scan of the
--      WHOLE OR, not just that one arm.
--   2. Two of the three normalized-LIKE arms are wrapped in `coalesce(col, '')`. normalize_text()
--      already does `coalesce(t, '')` internally (see 20260630000000), so the wrapper changes
--      nothing about the result -- it just doesn't match the GIN trgm indexes already built on
--      the un-coalesced `normalize_text(col)` expression, which breaks index matching for no
--      behavioral benefit.
--
-- At ~67.6k artists, that's a seq scan computing normalize_text() up to 3x and word_similarity()
-- per row, on every single call -- exactly consistent with the measured multi-second latency.
--
-- Fix, mirroring 20260706000017 exactly:
--   * word_similarity(...) > 0.5  ->  ql <% lower(name), backed by a new GIN trgm index.
--   * Drop the coalesce() wrappers on name_native / name_phonetic_ko in the WHERE so those two
--     LIKE arms match the indexes that already exist for exactly those bare expressions
--     (idx_artist_phonetic_ko_norm_trgm from 20260703000006; idx_artists_name_native_norm_trgm is
--     new here -- the existing idx_artists_name_native_trgm indexes the *raw* column, not
--     normalize_text(name_native), so it never matched this arm either).
-- ORDER BY is intentionally left as word_similarity() calls, unchanged from before -- it only
-- runs over the already-filtered, already-small row set, so it was never the expensive part.
--
-- Signature is unchanged (same RETURNS TABLE), so no web/iOS client changes are needed.
--
-- Caveat, flagged not resolved here: this session had no way to run a live EXPLAIN ANALYZE
-- against production (no raw-SQL execution path available, only PostgREST + RPC calls), so this
-- fix is based on the same reasoning already validated for the sibling function, not a directly
-- confirmed query plan for THIS function. One arm this fix does NOT touch -- the alias match,
-- `EXISTS (SELECT 1 FROM artist_aliases al WHERE al.artist_id = a.id AND normalize_text(al.alias)
-- LIKE ...)` -- is a correlated subquery, which Postgres generally can't fold into a bitmap index
-- scan as an OR-arm either, regardless of how well-indexed artist_aliases itself is
-- (idx_artist_aliases_artist on artist_id keeps each individual invocation cheap, but that's
-- about the subquery's own cost, not whether the outer scan on `artists` can use an index). If
-- this migration doesn't fully resolve the latency, that EXISTS arm is the next thing to check
-- with a live EXPLAIN ANALYZE -- likely fix would be rewriting it as a LEFT JOIN + aggregation
-- instead of a correlated EXISTS, or moving alias matching into a separate indexed lookup.
--
-- USER: apply via the Supabase SQL editor (no Management API token on this machine, same as
-- every other migration in this repo) and re-time search_artists afterward.

CREATE INDEX IF NOT EXISTS idx_artists_name_lower_trgm
  ON artists USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_artists_name_native_norm_trgm
  ON artists USING gin (normalize_text(name_native) gin_trgm_ops);

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
    -- Must have something to show: mirrors get_artist_release_groups' primary UNION credited.
    AND (
         EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
      OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
    )
    AND (
         normalize_text(a.name)             LIKE '%' || nq.qn || '%'
      OR normalize_text(a.name_native)      LIKE '%' || nq.qn || '%'
      OR normalize_text(a.name_phonetic_ko) LIKE '%' || nq.qn || '%'
      OR EXISTS (
           SELECT 1 FROM artist_aliases al
           WHERE al.artist_id = a.id
             AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
         )
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
