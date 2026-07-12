-- Run this file SEPARATELY from 20260712000000_genre_query_aliases.sql -- paste and run it as
-- its own statement in the SQL editor, not bundled with anything else. CONCURRENTLY cannot run
-- inside a transaction block, and multi-statement pastes are commonly wrapped in one implicitly.
--
-- Honest note: this index accelerates && / @> / <@ (exact-value array overlap), NOT the
-- unnest()+ILIKE substring matching _rg_has_genre() actually does (genre tags are free-text-ish,
-- not a strict enum, which is why _rg_has_genre uses tolerant ILIKE instead of exact equality).
-- Included because it's cheap and harmless and useful for any FUTURE exact-tag query -- it does
-- not speed up the genre-query-alias search path added in 20260712000000. See that migration's
-- header and the plan's Risks section for the full reasoning.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_release_groups_genres_gin
  ON release_groups USING GIN (genres);
