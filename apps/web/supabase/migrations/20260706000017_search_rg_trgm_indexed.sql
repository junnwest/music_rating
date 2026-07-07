-- Fix search_release_groups statement timeouts (57014) at catalog scale.
--
-- Symptom (verified 2026-07-06 via scripts/debug-web-queries.ts): the RPC takes
-- ~7.4s under service_role (8s timeout) and always dies under anon (3s timeout),
-- blanking the web Search page for signed-out/anon sessions.
--
-- Root cause: the WHERE clause is an OR of 5 branches, and Postgres can only use
-- a BitmapOr when EVERY branch is index-backed — one non-indexable arm forces a
-- full seq scan of the whole OR. Two arms were never indexable:
--   1. word_similarity(ql, lower(col)) > 0.5 — a plain function call is never an
--      index qual (only the <% operator is), and even <% needs a trgm index on
--      lower(col), which didn't exist (the 20260630000000 indexes are on
--      normalize_text(col), a different expression).
--   2. normalize_text(coalesce(native_title, '')) — no index, and the coalesce
--      wrapper wouldn't have matched one anyway.
-- So every call seq-scanned all ~295k release_groups computing normalize_text()
-- ×3 + word_similarity() ×2 per row. This was merely slow at the 73k catalog the
-- function was written against (20260630000000) and is fatal at 295k. The
-- 20260703000004 rebuild (adds artist_native) kept the same shape.
--
-- Fix — make every OR arm index-backed, preserving match semantics:
--   * word_similarity(...) > 0.5  →  ql <% lower(col). GIN gin_trgm_ops
--     supports <%. The operator compares against pg_trgm.word_similarity_
--     threshold, which stays at its DEFAULT 0.6 (was 0.5): hosted Supabase
--     denies setting that GUC ("permission denied to set parameter", verified
--     live — a function-level SET clause both fails to CREATE and would be a
--     runtime hazard in backends that haven't loaded pg_trgm yet). Net effect:
--     the fuzzy-typo arm is slightly stricter; the substring/normalized arms
--     (the primary match path) and the ORDER BY ranking are unchanged.
--   * New GIN trgm indexes: lower(title), lower(artist_display),
--     normalize_text(native_title) (the coalesce is dropped from the SQL —
--     normalize_text() already coalesces NULL to '' internally).
--   * The existing idx_rg_title_norm_trgm / idx_rg_artist_norm_trgm keep
--     covering the two normalized-LIKE arms.
-- Ranking (ORDER BY) is unchanged — it only runs over matched rows.
--
-- Known caveat, flagged not fixed: queries whose normalized form is < 3 chars
-- ("iu", "bts" is fine at 3) extract no complete trigram, so the planner falls
-- back to the seq scan and anon will still time out for those. Fixing that needs
-- either stored normalized columns or a separate short-query path — out of scope
-- here; the web client should keep its min-query-length debounce.
--
-- Note: 3 GIN trgm index builds over ~295k rows — run when the DB is quiet
-- (each can take ~30-90s on Micro and eats Disk IO burst budget).

CREATE INDEX IF NOT EXISTS idx_rg_title_lower_trgm
  ON release_groups USING gin (lower(title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rg_artist_lower_trgm
  ON release_groups USING gin (lower(artist_display) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rg_native_title_norm_trgm
  ON release_groups USING gin (normalize_text(native_title) gin_trgm_ops);

-- Rebuild from the live 20260703000004 definition (same signature + return
-- shape — no iOS/web client changes needed).
DROP FUNCTION IF EXISTS search_release_groups(text, int, text, vector);
CREATE FUNCTION search_release_groups(
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
  artist_native      text
)
LANGUAGE sql STABLE
AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text,
         a.name_native
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

GRANT EXECUTE ON FUNCTION search_release_groups(text, int, text, vector)
  TO anon, authenticated, service_role;
