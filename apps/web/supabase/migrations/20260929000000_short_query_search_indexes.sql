-- Short-query search, part 1: indexes (2026-09-29).
--
-- 1- and 2-character searches ("독", "밤", "사랑", "iu") time out: every
-- search path is `LIKE '%q%'` / word_similarity, and the trigram indexes need
-- 3+ characters to be usable, so a short query seq-scans ~670k release_groups
-- (and ~2.3M+ recordings for songs) and hits the statement timeout. Confirmed
-- live: search_release_groups('독' | '사랑' | 'iu' | 'ab') all error 57014.
--
-- These btree indexes (text_pattern_ops = byte-order, so prefix ranges work
-- regardless of the database collation) serve exact and prefix matches for
-- the short-query path in 20260929000001.
--
-- CONCURRENTLY can't run inside a transaction block: run EACH statement
-- below on its own in the SQL editor (not the whole file at once), same as
-- 20260712000011. The recordings one scans every row once to build -- expect
-- a few minutes; the pipeline can keep running (CONCURRENTLY doesn't lock
-- writes). If one fails partway, DROP INDEX CONCURRENTLY it and re-run.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rg_title_norm_prefix
  ON release_groups (normalize_text(title) text_pattern_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_title_norm_prefix
  ON recordings (normalize_text(title) text_pattern_ops);
