-- Phase 3 (GENRE_TAXONOMY.md §4): make release_genres hold ONE ROW PER SOURCE.
--
-- The Phase-1 key (release_group_id, genre_id) allowed a genre only once per
-- release group, so two sources asserting the same genre collided: a second
-- source's upsert either clobbered the first's row or was dropped. That defeats
-- the merge's cross-source agreement boost and breaks "re-running one source
-- never clobbers another's rows" (§3.4).
--
-- New key: (release_group_id, genre_id, source). Every existing row is
-- source='legacy', so the old key's uniqueness implies the new one — no data
-- changes, no dedup needed. Nothing live reads release_genres yet (only the
-- backfill/merge scripts), so the brief rebuild lock is harmless.
--
-- `is_primary` semantics: per-source rows written from Phase 3 on carry
-- is_primary=false; the primary genre becomes a property of the MERGED set
-- (computed at display cutover). Legacy rows keep their Phase-1 flag.

ALTER TABLE release_genres DROP CONSTRAINT IF EXISTS release_genres_pkey;
ALTER TABLE release_genres ADD CONSTRAINT release_genres_pkey
  PRIMARY KEY (release_group_id, genre_id, source);
