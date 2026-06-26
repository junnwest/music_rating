-- ================================================================
-- DB Renovation: artist identity, release groups, recordings
-- 2026-06-24
-- ================================================================
-- Run in the Supabase SQL editor (not via supabase db push).
-- Designed for pre-launch: catalog data is truncated and re-ingested.
-- Export any ratings you want to keep before running.
--
-- Sections:
--   §0  Drop stale views / functions / triggers
--   §1  Truncate all catalog data
--   §2  Evolve artists table (uuid PK, new columns)
--   §3  artist_aliases, artist_external_ids
--   §4  release_groups
--   §5  Alter releases → add release_group_id, is_canonical, region
--   §6  recordings
--   §7  release_tracks
--   §8  ratings / rating_history → release_group_id
--   §9  pairwise_comparisons → release_groups
--   §10 track_ratings → recording_id
--   §11 track_pairwise_comparisons → recordings
--   §12 User content tables → release_group_id
--   §13 Sustainability columns on artists
-- ================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- §0  Drop stale views and functions that reference the old schema
-- ─────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS recommendable_releases;

-- Charts RPCs (JOIN releases ON ratings.release_id)
DROP FUNCTION IF EXISTS get_charts_top_rated(int, text, int, int);
DROP FUNCTION IF EXISTS get_charts_most_rated(int, text, int, int);
DROP FUNCTION IF EXISTS get_charts_trending(int);
DROP FUNCTION IF EXISTS get_charts_trending_for_genres(text[], int);
DROP FUNCTION IF EXISTS get_user_top_genres(uuid, int);
DROP FUNCTION IF EXISTS get_charts_hidden_gems(int, text);
DROP FUNCTION IF EXISTS get_charts_controversial(int);

-- Taste + score RPCs (reference releases JOIN ratings.release_id)
DROP FUNCTION IF EXISTS get_user_genre_standings(uuid);
DROP FUNCTION IF EXISTS get_calibrated_bayesian_scores(uuid[]);

-- Song charts RPCs
DROP FUNCTION IF EXISTS get_charts_top_songs(int, text, int, int);
DROP FUNCTION IF EXISTS get_charts_trending_songs(int);

-- Rating history trigger (references ratings.release_id)
DROP TRIGGER  IF EXISTS ratings_history_trigger ON ratings;
DROP FUNCTION IF EXISTS record_rating_change();

-- Denormalized ratings_count maintainer (search/recs popularity signal,
-- migration 20260527000002). Declared "AFTER ... UPDATE OF release_id ON
-- ratings", which hard-binds it to ratings.release_id and blocks the §8
-- column drop. The counter must be rebuilt on release_groups during the
-- RPC/view rewrite; drop it here so the renovation can proceed. The
-- releases.ratings_count column itself is kept (search_releases() reads it).
DROP TRIGGER  IF EXISTS trg_release_ratings_count ON ratings;
DROP FUNCTION IF EXISTS _sync_release_ratings_count();

-- ─────────────────────────────────────────────────────────────────
-- §1  Truncate all catalog-dependent data
-- ─────────────────────────────────────────────────────────────────
-- Leaf tables first (tables with FKs into releases/artists).
-- CASCADE is required: several tables hold FKs into this set but are not
-- listed here, so a plain TRUNCATE would abort with "cannot truncate a
-- table referenced in a foreign key constraint". CASCADE additionally
-- truncates those dependents (all disposable pre-launch, not in backups):
--   rating_likes, rating_comments, notifications  → FK to ratings(id)
--   comment_likes                                 → FK to reviews(id)
--   list_item_tracks                              → FK to list_items(id)

TRUNCATE TABLE
  track_pairwise_comparisons,
  track_ratings,
  pairwise_comparisons,
  rating_history,
  ratings,
  tracks,
  mix_items,
  saved_releases,
  ranking_votes,
  curated_releases,
  pinned_albums,
  list_items,
  reviews,
  releases,
  artists,
  artist_ingestion_queue,
  search_misses
RESTART IDENTITY CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- §2  Evolve artists table
-- ─────────────────────────────────────────────────────────────────
-- Change PK from text (was Spotify ID) to uuid.
-- Safe: table is empty after §1 truncation — no rows to cast.
ALTER TABLE artists
  ALTER COLUMN id TYPE uuid USING gen_random_uuid(),
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS disambiguation   text,
  ADD COLUMN IF NOT EXISTS country          text,
  ADD COLUMN IF NOT EXISTS last_ingested_at timestamptz,
  ADD COLUMN IF NOT EXISTS ingest_priority  text NOT NULL DEFAULT 'known',
  ADD COLUMN IF NOT EXISTS created_at       timestamptz   DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz   DEFAULT now();

ALTER TABLE artists
  DROP CONSTRAINT IF EXISTS artists_ingest_priority_check;
ALTER TABLE artists ADD CONSTRAINT artists_ingest_priority_check
  CHECK (ingest_priority IN ('hot', 'active', 'known', 'dormant'));

ALTER TABLE artists DROP COLUMN IF EXISTS spotify_url;

-- ─────────────────────────────────────────────────────────────────
-- §3  Artist identity tables
-- ─────────────────────────────────────────────────────────────────

-- artist_aliases: N name variants → 1 artist.
-- UNIQUE(alias) is the core invariant: every string resolves to exactly
-- one artist entity. "드레스", "dress", "DRESS" are all separate aliases
-- pointing to the same row. Ingestion checks this table before creating
-- a new artist, preventing silent catalog splits.
CREATE TABLE IF NOT EXISTS artist_aliases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id  uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  alias      text NOT NULL,
  locale     text,               -- 'ko', 'en', 'ja', null when script-agnostic
  created_at timestamptz DEFAULT now(),
  UNIQUE (alias)
);
ALTER TABLE artist_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artist_aliases_select ON artist_aliases;
CREATE POLICY artist_aliases_select ON artist_aliases FOR SELECT USING (true);
DROP POLICY IF EXISTS artist_aliases_insert ON artist_aliases;
CREATE POLICY artist_aliases_insert ON artist_aliases FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS artist_aliases_update ON artist_aliases;
CREATE POLICY artist_aliases_update ON artist_aliases FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_artist_aliases_artist
  ON artist_aliases (artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias_trgm
  ON artist_aliases USING gin (alias gin_trgm_ops);


-- artist_external_ids: one row per (source, external_id) pair.
-- PRIMARY KEY (source, external_id) means each external ID maps to exactly
-- one artist. An artist CAN have multiple rows (e.g., two iTunes IDs for a
-- split catalog) — unlike the old itunes_artist_id UNIQUE column which
-- could only store one.
CREATE TABLE IF NOT EXISTS artist_external_ids (
  artist_id   uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  source      text NOT NULL,
  external_id text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (source, external_id),
  CONSTRAINT artist_external_ids_source_check
    CHECK (source IN ('itunes', 'spotify', 'musicbrainz', 'discogs'))
);
ALTER TABLE artist_external_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS artist_external_ids_select ON artist_external_ids;
CREATE POLICY artist_external_ids_select ON artist_external_ids FOR SELECT USING (true);
DROP POLICY IF EXISTS artist_external_ids_insert ON artist_external_ids;
CREATE POLICY artist_external_ids_insert ON artist_external_ids FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS artist_external_ids_update ON artist_external_ids;
CREATE POLICY artist_external_ids_update ON artist_external_ids FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_artist_external_ids_artist
  ON artist_external_ids (artist_id, source);

-- ─────────────────────────────────────────────────────────────────
-- §4  release_groups (the album/single/EP as a concept)
-- ─────────────────────────────────────────────────────────────────
-- Users interact with release_groups — they rate "Kid A", not
-- "Kid A (2021 Remaster)". Individual editions live in releases.
-- This table never changes when a new edition is ingested, so user
-- data (ratings, lists) stays stable forever.
CREATE TABLE IF NOT EXISTS release_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_artist_id  uuid REFERENCES artists(id),
  artist_display     text NOT NULL,   -- "Lady Gaga & Bradley Cooper"
  title              text NOT NULL,
  release_group_type text NOT NULL,
  first_release_date date,
  cover_url          text,
  genres             text[],
  created_at         timestamptz DEFAULT now(),
  CONSTRAINT release_groups_type_check
    CHECK (release_group_type IN (
      'album', 'ep', 'single', 'compilation', 'live', 'soundtrack', 'other'
    ))
);
ALTER TABLE release_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_groups_select ON release_groups;
CREATE POLICY release_groups_select ON release_groups FOR SELECT USING (true);
DROP POLICY IF EXISTS release_groups_insert ON release_groups;
CREATE POLICY release_groups_insert ON release_groups FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS release_groups_update ON release_groups;
CREATE POLICY release_groups_update ON release_groups FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_release_groups_artist
  ON release_groups (primary_artist_id);
CREATE INDEX IF NOT EXISTS idx_release_groups_date
  ON release_groups (first_release_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_release_groups_title_trgm
  ON release_groups USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_release_groups_display_trgm
  ON release_groups USING gin (artist_display gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────
-- §5  Alter releases → edition-level rows under a release_group
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_canonical      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region            text;

-- is_canonical = true marks which edition's tracklist the app shows.
-- Ingestion sets this: prefer the earliest release date; update if a
-- later ingest finds an earlier edition.
CREATE INDEX IF NOT EXISTS idx_releases_release_group
  ON releases (release_group_id);
CREATE INDEX IF NOT EXISTS idx_releases_canonical
  ON releases (release_group_id) WHERE is_canonical = true;

-- ─────────────────────────────────────────────────────────────────
-- §6  recordings (the audio entity — stable across all releases)
-- ─────────────────────────────────────────────────────────────────
-- A recording is the actual audio. It can appear in multiple releases:
-- the standalone single AND the album track are the same recording.
-- track_ratings keys on recording_id — so a song rating survives
-- remasters, deluxe editions, and bonus track insertions.
CREATE TABLE IF NOT EXISTS recordings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_artist_id uuid REFERENCES artists(id),
  artist_display    text NOT NULL,
  title             text NOT NULL,
  isrc              text UNIQUE,   -- ISO recording code, when available
  duration_ms       int,
  created_at        timestamptz DEFAULT now()
);
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recordings_select ON recordings;
CREATE POLICY recordings_select ON recordings FOR SELECT USING (true);
DROP POLICY IF EXISTS recordings_insert ON recordings;
CREATE POLICY recordings_insert ON recordings FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_recordings_artist
  ON recordings (primary_artist_id);
CREATE INDEX IF NOT EXISTS idx_recordings_title_trgm
  ON recordings USING gin (title gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────
-- §7  release_tracks (recording appears on a release at a position)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS release_tracks (
  release_id   uuid NOT NULL REFERENCES releases(id)   ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  position     int  NOT NULL,
  disc_number  int  NOT NULL DEFAULT 1,
  PRIMARY KEY (release_id, disc_number, position),
  UNIQUE (release_id, recording_id)  -- same recording appears once per release
);
ALTER TABLE release_tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_tracks_select ON release_tracks;
CREATE POLICY release_tracks_select ON release_tracks FOR SELECT USING (true);
DROP POLICY IF EXISTS release_tracks_insert ON release_tracks;
CREATE POLICY release_tracks_insert ON release_tracks FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_release_tracks_recording
  ON release_tracks (recording_id);

-- ─────────────────────────────────────────────────────────────────
-- §8  ratings / rating_history → release_group_id
-- ─────────────────────────────────────────────────────────────────

-- ratings.release_id was text (no FK), safe to drop.
ALTER TABLE ratings DROP COLUMN IF EXISTS release_id;
ALTER TABLE ratings
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;
ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_user_id_release_id_key;
ALTER TABLE ratings
  ADD CONSTRAINT ratings_user_id_release_group_id_key
  UNIQUE (user_id, release_group_id);

-- rating_history.release_id was also text (no FK).
ALTER TABLE rating_history DROP COLUMN IF EXISTS release_id;
ALTER TABLE rating_history
  ADD COLUMN release_group_id uuid;

-- Rebuild the rating-change trigger with the correct column name.
CREATE OR REPLACE FUNCTION record_rating_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.score IS DISTINCT FROM NEW.score THEN
    INSERT INTO rating_history (user_id, release_group_id, score)
    VALUES (NEW.user_id, NEW.release_group_id, NEW.score);
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ratings_history_trigger
BEFORE UPDATE ON ratings
FOR EACH ROW EXECUTE FUNCTION record_rating_change();

-- ─────────────────────────────────────────────────────────────────
-- §9  pairwise_comparisons → release_groups
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE pairwise_comparisons
  DROP COLUMN IF EXISTS winner_release_id,
  DROP COLUMN IF EXISTS loser_release_id;
ALTER TABLE pairwise_comparisons
  ADD COLUMN winner_id uuid REFERENCES release_groups(id) ON DELETE CASCADE,
  ADD COLUMN loser_id  uuid REFERENCES release_groups(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- §10  track_ratings → recording_id
-- ─────────────────────────────────────────────────────────────────
-- Old key was (release_id, track_position) — fragile: breaks when any
-- album gets a remaster that shifts track numbers.
-- New key is recording_id — stable forever.
ALTER TABLE track_ratings
  DROP COLUMN IF EXISTS release_id,
  DROP COLUMN IF EXISTS track_position,
  DROP COLUMN IF EXISTS track_title;
ALTER TABLE track_ratings
  ADD COLUMN recording_id uuid REFERENCES recordings(id) ON DELETE CASCADE;
ALTER TABLE track_ratings
  DROP CONSTRAINT IF EXISTS track_ratings_user_id_release_id_track_position_key;
ALTER TABLE track_ratings
  ADD CONSTRAINT track_ratings_user_id_recording_id_key
  UNIQUE (user_id, recording_id);

-- ─────────────────────────────────────────────────────────────────
-- §11  track_pairwise_comparisons → recordings
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE track_pairwise_comparisons
  DROP COLUMN IF EXISTS winner_release_id,
  DROP COLUMN IF EXISTS winner_position,
  DROP COLUMN IF EXISTS loser_release_id,
  DROP COLUMN IF EXISTS loser_position;
ALTER TABLE track_pairwise_comparisons
  ADD COLUMN winner_id uuid REFERENCES recordings(id) ON DELETE CASCADE,
  ADD COLUMN loser_id  uuid REFERENCES recordings(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────
-- §12  User content tables → release_group_id
-- ─────────────────────────────────────────────────────────────────

-- reviews (release_id was text, no FK)
ALTER TABLE reviews DROP COLUMN IF EXISTS release_id;
ALTER TABLE reviews
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;

-- list_items (release_id was text, no FK)
ALTER TABLE list_items DROP COLUMN IF EXISTS release_id;
ALTER TABLE list_items
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;
ALTER TABLE list_items DROP CONSTRAINT IF EXISTS list_items_list_id_release_id_key;
ALTER TABLE list_items
  ADD CONSTRAINT list_items_list_id_release_group_id_key
  UNIQUE (list_id, release_group_id);

-- mix_items (release_id was uuid FK → releases)
ALTER TABLE mix_items DROP COLUMN IF EXISTS release_id;
ALTER TABLE mix_items
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;
ALTER TABLE mix_items DROP CONSTRAINT IF EXISTS mix_items_mix_id_release_id_key;
ALTER TABLE mix_items
  ADD CONSTRAINT mix_items_mix_id_release_group_id_key
  UNIQUE (mix_id, release_group_id);

-- saved_releases (release_id was uuid FK → releases, part of PK)
ALTER TABLE saved_releases DROP CONSTRAINT IF EXISTS saved_releases_pkey;
ALTER TABLE saved_releases DROP COLUMN IF EXISTS release_id;
ALTER TABLE saved_releases
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;
ALTER TABLE saved_releases
  ADD PRIMARY KEY (user_id, release_group_id);

-- pinned_albums (release_id was text, no FK)
ALTER TABLE pinned_albums DROP COLUMN IF EXISTS release_id;
ALTER TABLE pinned_albums
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;
ALTER TABLE pinned_albums DROP CONSTRAINT IF EXISTS pinned_albums_user_id_release_id_key;
ALTER TABLE pinned_albums
  ADD CONSTRAINT pinned_albums_user_id_release_group_id_key
  UNIQUE (user_id, release_group_id);

-- ranking_votes (release_id was text, no FK)
ALTER TABLE ranking_votes DROP COLUMN IF EXISTS release_id;
ALTER TABLE ranking_votes
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id) ON DELETE CASCADE;

-- curated_releases (release_id was text, no FK)
ALTER TABLE curated_releases DROP COLUMN IF EXISTS release_id;
ALTER TABLE curated_releases
  ADD COLUMN release_group_id uuid REFERENCES release_groups(id);
ALTER TABLE curated_releases DROP CONSTRAINT IF EXISTS curated_releases_category_release_id_key;
ALTER TABLE curated_releases
  ADD CONSTRAINT curated_releases_category_release_group_id_key
  UNIQUE (category, release_group_id);

-- ─────────────────────────────────────────────────────────────────
-- §13  Sustainability: tiered re-ingestion scheduler columns
-- ─────────────────────────────────────────────────────────────────
-- next_check_at: the scheduler selects artists WHERE next_check_at <= now()
-- and re-fetches their iTunes catalog for new releases.
-- ingest_priority controls how often next_check_at is reset:
--   hot      → daily   (artists with recent user activity)
--   active   → weekly  (any artist with user ratings)
--   known    → monthly (in DB but no user ratings)
--   dormant  → quarterly (no release in 5+ years)
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_artists_next_check
  ON artists (next_check_at ASC NULLS LAST)
  WHERE next_check_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artists_priority
  ON artists (ingest_priority, next_check_at ASC NULLS LAST);

COMMIT;
