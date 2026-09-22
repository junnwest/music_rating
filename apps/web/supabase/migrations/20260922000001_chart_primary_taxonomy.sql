-- Chart primary genre → taxonomy closure membership (2026-09-22, Phase 2 task 2).
--
-- Repoints the CHART-primary path off the hand-maintained PRECEDENCE substring
-- matcher onto the canonical taxonomy graph, using the id-based category
-- membership projected by 20260921000001_genre_taxonomy_sql.sql (_taxonomy_closure
-- + _primary_genre_id). This DEPENDS on that migration and MUST run after it.
--
-- WHAT CHANGES (and, deliberately, what does NOT):
--   • rg_primary_genre.primary_genre now stores a taxonomy NODE ID ("death-metal",
--     "house", "k-pop") instead of a coarse PRECEDENCE bucket string ("metal",
--     "electronic"). _compute_primary_genre (which the trigger and backfill call)
--     is repointed to _primary_genre_id — the SQL twin of resolver.ts primaryOf().
--   • _rg_primary_matches now tests CLOSURE MEMBERSHIP: the filter slug resolves to
--     a node id, and the album matches iff that id is an ancestor-or-self of the
--     album's primary id. This is what the coarse→specific shift REQUIRES: with
--     ids, filtering "Electronic" (family) matches a "house"/"techno" primary that
--     the old substring matcher missed ('house' does NOT contain 'electronic'),
--     while filtering "Metal" still matches "death-metal", etc.
--   • The 5 genre-filtered RPCs (get_charts_top_rated / most_rated / hidden_gems /
--     trending_for_genres / get_silla_leaderboard) and the trg_sync_primary_genre
--     trigger are UNTOUCHED — they call these two functions, so redefining the
--     functions repoints them in place.
--
-- GRACEFUL FALLBACK (unchanged contract): when the album has no stored primary
-- (row not yet backfilled) OR the filter slug does not resolve to a taxonomy node,
-- _rg_primary_matches falls back to the old whole-array substring membership
-- (_rg_has_genre over rg.genres), so charts never go empty mid-migration and any
-- off-taxonomy slug still behaves as before.
--
-- SLUG CONTRACT: the 8 chart genre buttons now pass a family NODE ID
-- ("hip-hop","k-pop","jazz","electronic","classical","metal","rnb-soul","pop")
-- as p_genre (charts/page.tsx GENRES) so a broad button maps to the whole family
-- and its descendants. The "For You" path still passes the user's RAW genre tags,
-- which _genre_resolve folds to node ids the same way. Both resolve through
-- _genre_resolve, so the matcher treats ids and raw tags uniformly.

BEGIN;

-- ── primary compute → taxonomy id (drives trg_sync_primary_genre + the backfill) ──
-- Now STABLE (reads the _taxonomy_* projection) rather than IMMUTABLE. Returns a
-- node id, or NULL when no tag resolves (→ whole-array fallback in the matcher).
CREATE OR REPLACE FUNCTION _compute_primary_genre(p_genres text[])
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT _primary_genre_id(p_genres);
$$;

-- ── chart genre-filter membership via the taxonomy closure ─────────────────────
-- p_primary : the album's stored primary NODE ID (rg_primary_genre.primary_genre)
-- p_genres  : the album's raw genres[] (only used by the fallback path)
-- p_slug    : the filter — a family node id (button) or a raw user tag (For You)
CREATE OR REPLACE FUNCTION _rg_primary_matches(p_primary text, p_genres text[], p_slug text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- Both sides land on the taxonomy → id-based ancestor-or-self membership.
    WHEN p_primary IS NOT NULL AND _genre_resolve(p_slug) IS NOT NULL THEN
      EXISTS (
        SELECT 1 FROM _taxonomy_closure c
        WHERE c.ancestor_id = _genre_resolve(p_slug)
          AND c.descendant_id = p_primary
      )
    -- Unbackfilled row or non-taxonomy slug → old whole-array substring behavior.
    ELSE _rg_has_genre(p_genres, p_slug)
  END;
$$;

COMMIT;

-- ── one-time re-backfill: recompute every chart-eligible row as a node id ───────
-- rg_primary_genre is the lightweight side table (~3.8k rows), so this UPDATE is
-- cheap (no release_groups rewrite). Idempotent: re-running recomputes from the
-- current taxonomy. Rows whose tags are all off-taxonomy become NULL and fall
-- back to whole-array matching, exactly like a not-yet-populated row.
UPDATE rg_primary_genre pg
SET primary_genre = _compute_primary_genre(rg.genres)
FROM release_groups rg
WHERE rg.id = pg.release_group_id;
