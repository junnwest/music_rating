-- ════════════════════════════════════════════════════════════════════
-- Multi-source catalog schema
--
-- Summary of changes:
--   • releases.id    text (Spotify ID) → uuid (internal)
--     releases.spotify_id              new column = old id value
--     + itunes_id, upc, release_mbid, cover_source, canonical_source,
--       release_group_id, title_ko, primary_artist_id
--
--   • artists.id     text (Spotify artist ID) → uuid (internal)
--     artists.spotify_artist_id        new column = old id value
--     + itunes_artist_id, artist_mbid, name_ko, aliases, cover_source
--
--   • User activity tables: release_id text → uuid FK → releases(id)
--     (ratings, reviews, list_items, pinned_albums, ranking_votes,
--      user_ranking_entries, curated_releases, ranking_seed_entries,
--      rating_history)
--
--   • New tables: release_groups, release_artists, release_isrcs
--
--   • rating_history.user_id gets FK → profiles(id) (was missing)
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. release_groups ────────────────────────────────────────────────
-- Groups regional variants and repackages of the same album together.
-- Nullable FK on releases — filled in opportunistically, not required.
CREATE TABLE release_groups (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  mbid  uuid UNIQUE  -- MusicBrainz release group MBID
);
ALTER TABLE release_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "release_groups_select" ON release_groups FOR SELECT USING (true);

-- ── 2. Extend artists: UUID PK + source ID columns ───────────────────

ALTER TABLE artists
  ADD COLUMN _new_id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN itunes_artist_id bigint,
  ADD COLUMN artist_mbid      uuid,
  ADD COLUMN name_ko          text,
  ADD COLUMN aliases          jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN cover_source     text;

-- Swap PK: rename old id → spotify_artist_id, promote _new_id → id
ALTER TABLE artists DROP CONSTRAINT artists_pkey;
ALTER TABLE artists RENAME COLUMN id TO spotify_artist_id;
ALTER TABLE artists RENAME COLUMN _new_id TO id;
ALTER TABLE artists ADD PRIMARY KEY (id);
ALTER TABLE artists ADD CONSTRAINT artists_spotify_artist_id_key  UNIQUE (spotify_artist_id);
ALTER TABLE artists ADD CONSTRAINT artists_itunes_artist_id_key   UNIQUE (itunes_artist_id);
ALTER TABLE artists ADD CONSTRAINT artists_artist_mbid_key        UNIQUE (artist_mbid);

-- ── 3. Extend releases: UUID PK + source ID columns ──────────────────

ALTER TABLE releases
  ADD COLUMN _new_id          uuid   NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN itunes_id        bigint,
  ADD COLUMN release_mbid     uuid,
  ADD COLUMN upc              text,
  ADD COLUMN cover_source     text,
  ADD COLUMN canonical_source text,
  ADD COLUMN title_ko         text,
  ADD COLUMN release_group_id uuid   REFERENCES release_groups(id),
  ADD COLUMN primary_artist_id uuid;  -- FK to artists added after PK swap

-- Populate primary_artist_id by joining the now-renamed spotify_artist_id
UPDATE releases r
  SET primary_artist_id = a.id
  FROM artists a
  WHERE a.spotify_artist_id = r.artist_id;

-- ── 4. Add UUID staging columns to all user activity tables ──────────

ALTER TABLE ratings              ADD COLUMN _rel_uuid uuid;
ALTER TABLE reviews              ADD COLUMN _rel_uuid uuid;
ALTER TABLE list_items           ADD COLUMN _rel_uuid uuid;
ALTER TABLE pinned_albums        ADD COLUMN _rel_uuid uuid;
ALTER TABLE ranking_votes        ADD COLUMN _rel_uuid uuid;
ALTER TABLE user_ranking_entries ADD COLUMN _rel_uuid uuid;
ALTER TABLE curated_releases     ADD COLUMN _rel_uuid uuid;
ALTER TABLE ranking_seed_entries ADD COLUMN _rel_uuid uuid;
ALTER TABLE rating_history       ADD COLUMN _rel_uuid uuid;

-- Populate from the new UUID that each release was assigned
UPDATE ratings              t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE reviews              t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE list_items           t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE pinned_albums        t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE ranking_votes        t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE user_ranking_entries t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE curated_releases     t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE ranking_seed_entries t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;
UPDATE rating_history       t SET _rel_uuid = r._new_id FROM releases r WHERE r.id = t.release_id;

-- Delete orphaned rows (release_id pointed to a release not in our DB)
DELETE FROM ratings              WHERE _rel_uuid IS NULL;
DELETE FROM reviews              WHERE _rel_uuid IS NULL;
DELETE FROM list_items           WHERE _rel_uuid IS NULL;
DELETE FROM pinned_albums        WHERE _rel_uuid IS NULL;
DELETE FROM ranking_votes        WHERE _rel_uuid IS NULL;
DELETE FROM user_ranking_entries WHERE _rel_uuid IS NULL;
DELETE FROM curated_releases     WHERE _rel_uuid IS NULL;
DELETE FROM ranking_seed_entries WHERE _rel_uuid IS NULL;
DELETE FROM rating_history       WHERE _rel_uuid IS NULL;

-- ── 5. Swap releases PK ───────────────────────────────────────────────

-- Drop the only real FK pointing at releases.id (pinned_albums from prev migration)
ALTER TABLE pinned_albums DROP CONSTRAINT IF EXISTS pinned_albums_release_id_fkey;

ALTER TABLE releases DROP CONSTRAINT releases_pkey;
ALTER TABLE releases RENAME COLUMN id       TO spotify_id;  -- old Spotify ID
ALTER TABLE releases RENAME COLUMN _new_id  TO id;          -- internal UUID
ALTER TABLE releases ADD PRIMARY KEY (id);
ALTER TABLE releases ADD CONSTRAINT releases_spotify_id_key   UNIQUE (spotify_id);
ALTER TABLE releases ADD CONSTRAINT releases_itunes_id_key    UNIQUE (itunes_id);
ALTER TABLE releases ADD CONSTRAINT releases_release_mbid_key UNIQUE (release_mbid);
ALTER TABLE releases ADD CONSTRAINT releases_upc_key          UNIQUE (upc);

-- Now wire up the FK to artists (both PKs are stable UUIDs now)
ALTER TABLE releases
  ADD CONSTRAINT releases_primary_artist_id_fkey
  FOREIGN KEY (primary_artist_id) REFERENCES artists(id);

-- Drop the old Spotify artist ID text column (replaced by primary_artist_id uuid)
ALTER TABLE releases DROP COLUMN artist_id;

-- ── 6. Swap release_id columns in user activity tables ───────────────

-- ratings
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_user_id_release_id_key;
ALTER TABLE ratings DROP COLUMN release_id;
ALTER TABLE ratings RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE ratings ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE ratings ADD CONSTRAINT ratings_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE ratings ADD CONSTRAINT ratings_user_id_release_id_key UNIQUE (user_id, release_id);
CREATE INDEX idx_ratings_release_id ON ratings (release_id);

-- reviews
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_release_id_key;
ALTER TABLE reviews DROP COLUMN release_id;
ALTER TABLE reviews RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE reviews ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE reviews ADD CONSTRAINT reviews_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_user_id_release_id_key UNIQUE (user_id, release_id);
CREATE INDEX idx_reviews_release_id ON reviews (release_id);

-- list_items
ALTER TABLE list_items DROP CONSTRAINT IF EXISTS list_items_list_id_release_id_key;
ALTER TABLE list_items DROP COLUMN release_id;
ALTER TABLE list_items RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE list_items ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE list_items ADD CONSTRAINT list_items_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE list_items ADD CONSTRAINT list_items_list_id_release_id_key UNIQUE (list_id, release_id);

-- pinned_albums
ALTER TABLE pinned_albums DROP CONSTRAINT IF EXISTS pinned_albums_user_id_release_id_key;
ALTER TABLE pinned_albums DROP COLUMN release_id;
ALTER TABLE pinned_albums RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE pinned_albums ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE pinned_albums ADD CONSTRAINT pinned_albums_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE pinned_albums ADD CONSTRAINT pinned_albums_user_id_release_id_key UNIQUE (user_id, release_id);

-- ranking_votes
ALTER TABLE ranking_votes DROP COLUMN release_id;
ALTER TABLE ranking_votes RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE ranking_votes ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE ranking_votes ADD CONSTRAINT ranking_votes_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;

-- user_ranking_entries
ALTER TABLE user_ranking_entries DROP CONSTRAINT IF EXISTS user_ranking_entries_ranking_id_release_id_key;
ALTER TABLE user_ranking_entries DROP COLUMN release_id;
ALTER TABLE user_ranking_entries RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE user_ranking_entries ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE user_ranking_entries ADD CONSTRAINT user_ranking_entries_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE user_ranking_entries ADD CONSTRAINT user_ranking_entries_ranking_id_release_id_key
  UNIQUE (ranking_id, release_id);
CREATE INDEX idx_user_ranking_entries_release_id ON user_ranking_entries (release_id);

-- curated_releases
ALTER TABLE curated_releases DROP CONSTRAINT IF EXISTS curated_releases_category_release_id_key;
ALTER TABLE curated_releases DROP COLUMN release_id;
ALTER TABLE curated_releases RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE curated_releases ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE curated_releases ADD CONSTRAINT curated_releases_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE curated_releases ADD CONSTRAINT curated_releases_category_release_id_key
  UNIQUE (category, release_id);

-- ranking_seed_entries
ALTER TABLE ranking_seed_entries DROP CONSTRAINT IF EXISTS ranking_seed_entries_category_id_release_id_key;
ALTER TABLE ranking_seed_entries DROP COLUMN release_id;
ALTER TABLE ranking_seed_entries RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE ranking_seed_entries ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE ranking_seed_entries ADD CONSTRAINT ranking_seed_entries_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE ranking_seed_entries ADD CONSTRAINT ranking_seed_entries_category_id_release_id_key
  UNIQUE (category_id, release_id);

-- rating_history: fix release_id + add missing user_id FK
ALTER TABLE rating_history DROP COLUMN release_id;
ALTER TABLE rating_history RENAME COLUMN _rel_uuid TO release_id;
ALTER TABLE rating_history ALTER COLUMN release_id SET NOT NULL;
ALTER TABLE rating_history ADD CONSTRAINT rating_history_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
ALTER TABLE rating_history ADD CONSTRAINT rating_history_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ── 7. New junction and lookup tables ────────────────────────────────

CREATE TABLE release_artists (
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artist_id  uuid NOT NULL REFERENCES artists(id)  ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'main',   -- 'main' | 'featured' | 'remix'
  position   int  NOT NULL DEFAULT 1,        -- display order (1 = primary)
  PRIMARY KEY (release_id, artist_id)
);
ALTER TABLE release_artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "release_artists_select" ON release_artists FOR SELECT USING (true);

CREATE TABLE release_isrcs (
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  isrc       text NOT NULL,
  PRIMARY KEY (release_id, isrc)
);
CREATE INDEX idx_release_isrcs_isrc ON release_isrcs (isrc);
ALTER TABLE release_isrcs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "release_isrcs_select" ON release_isrcs FOR SELECT USING (true);

-- ── 8. Seed release_artists from existing primary_artist_id data ─────

INSERT INTO release_artists (release_id, artist_id, role, position)
SELECT r.id, r.primary_artist_id, 'main', 1
FROM   releases r
WHERE  r.primary_artist_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 9. Update the recommendable_releases view ─────────────────────────
-- Column names unchanged; re-declare to pick up the schema refresh.
CREATE OR REPLACE VIEW recommendable_releases AS
  SELECT *
  FROM   releases
  WHERE  LOWER(release_type) IN ('album', 'ep')
    AND  cover_url IS NOT NULL;

COMMIT;
