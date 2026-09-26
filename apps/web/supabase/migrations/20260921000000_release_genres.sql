-- Genre taxonomy rebuild, Phase 1 storage (GENRE_TAXONOMY.md §3.3).
--
-- Replaces the free-form `release_groups.genres text[]` (raw tags, no provenance,
-- last-writer-wins) with a normalized join table keyed on canonical taxonomy ids,
-- carrying source + confidence + is_primary. The old `text[]` is NOT touched by
-- this migration — it stays as the live display denormalization until Phase 2
-- repoints consumers, so this is strictly additive.
--
-- `genre_id` is a canonical slug from lib/genres/taxonomy.ts, resolved at write
-- time by lib/genres/resolver.ts. It is INTENTIONALLY not a foreign key: the
-- taxonomy is authored in code (the single source of truth) and validated by
-- scripts/validate-taxonomy.ts, not mirrored into a DB table. An unresolvable
-- source tag is never dropped — it lands in `genre_unmapped` for review.
--
-- APPLY MANUALLY (pipeline convention — do not auto-apply): run this against the
-- Supabase instance, then run `npm run taxonomy:backfill:dry` to preview and
-- `npm run taxonomy:backfill` to populate.

-- ── release_genres: the normalized, provenance-carrying genre assignments ─────
CREATE TABLE IF NOT EXISTS release_genres (
  release_group_id uuid    NOT NULL REFERENCES release_groups(id) ON DELETE CASCADE,
  genre_id         text    NOT NULL,          -- canonical taxonomy id (lib/genres/taxonomy.ts)
  source           text    NOT NULL,          -- where this assignment came from
  confidence       real,                      -- vote count / tag weight where the source has one; NULL otherwise
  is_primary       boolean NOT NULL DEFAULT false,  -- the taxonomy walk's primary genre for this release
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_group_id, genre_id),
  -- Fixed trust vocabulary. `legacy` = the provenance-less `release_groups.genres[]`
  -- denormalization the Phase-1 backfill maps in (its per-source origins were
  -- discarded long ago); the five real ingest sources arrive in Phase 3.
  CONSTRAINT release_genres_source_check
    CHECK (source IN ('musicbrainz', 'lastfm', 'itunes', 'deezer', 'manual', 'legacy'))
);

ALTER TABLE release_genres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_genres_select ON release_genres;
CREATE POLICY release_genres_select ON release_genres FOR SELECT USING (true);
DROP POLICY IF EXISTS release_genres_insert ON release_genres;
CREATE POLICY release_genres_insert ON release_genres FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS release_genres_update ON release_genres;
CREATE POLICY release_genres_update ON release_genres FOR UPDATE USING (true);
DROP POLICY IF EXISTS release_genres_delete ON release_genres;
CREATE POLICY release_genres_delete ON release_genres FOR DELETE USING (true);

-- "All release groups in genre X" (charts, category rows, discovery). The PK's
-- leading column is release_group_id, so genre_id needs its own index.
CREATE INDEX IF NOT EXISTS idx_release_genres_genre
  ON release_genres (genre_id);
-- "The primary genre of each release" — partial index keeps it small and hot.
CREATE INDEX IF NOT EXISTS idx_release_genres_primary
  ON release_genres (genre_id) WHERE is_primary;

-- ── genre_unmapped: staging for source tags the resolver can't place ─────────
-- Never silently drop a tag. Rows here are the review queue that grows the
-- taxonomy (add a node/alias in taxonomy.ts, re-run the backfill, the row clears).
CREATE TABLE IF NOT EXISTS genre_unmapped (
  release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE,
  title            text,          -- the release group's title, for at-a-glance review
  raw_tag          text NOT NULL, -- the unresolved source tag, verbatim
  source           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- One row per (release, tag, source) so the backfill is idempotent / re-runnable.
  CONSTRAINT genre_unmapped_uniq UNIQUE (release_group_id, raw_tag, source)
);

ALTER TABLE genre_unmapped ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS genre_unmapped_select ON genre_unmapped;
CREATE POLICY genre_unmapped_select ON genre_unmapped FOR SELECT USING (true);
DROP POLICY IF EXISTS genre_unmapped_insert ON genre_unmapped;
CREATE POLICY genre_unmapped_insert ON genre_unmapped FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS genre_unmapped_delete ON genre_unmapped;
CREATE POLICY genre_unmapped_delete ON genre_unmapped FOR DELETE USING (true);

-- The top-unmapped-tags report the backfill prints, as a query: which tags recur
-- most, so the highest-leverage taxonomy additions surface first.
CREATE INDEX IF NOT EXISTS idx_genre_unmapped_raw_tag
  ON genre_unmapped (raw_tag);
