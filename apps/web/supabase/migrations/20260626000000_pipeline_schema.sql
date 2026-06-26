-- ================================================================
-- Pipeline schema additions (MB-primary ingestion)
-- 2026-06-26  —  RENOVATION_PLAN.md §6
-- ================================================================
-- Run in the Supabase SQL editor (not supabase db push).
-- Prepares the renovated schema for the MB-primary collection pipeline:
--   - embeddings + native title + provenance on release_groups
--   - recording identity by MBID (ISRC demoted to a non-unique signal)
--   - per-artist ingest state machine + leasing for the orchestrator
--   - richer, NON-unique aliases (identity is the MBID, not the name)
--   - pipeline_lanes heartbeat table + lane indexes
-- Idempotent; safe to re-run.
-- ================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- §1  release_groups: embeddings, native title, provenance
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE release_groups
  ADD COLUMN IF NOT EXISTS embedding           vector(1024),  -- jina-embeddings-v3 (cosine)
  ADD COLUMN IF NOT EXISTS native_title        text,          -- ko/ja/zh title when present
  ADD COLUMN IF NOT EXISTS source              text,          -- 'musicbrainz' | 'itunes' | ...
  ADD COLUMN IF NOT EXISTS mb_release_group_id text;          -- MBID (identity; idempotent re-ingest)

ALTER TABLE release_groups DROP CONSTRAINT IF EXISTS release_groups_mb_rg_id_key;
ALTER TABLE release_groups ADD  CONSTRAINT release_groups_mb_rg_id_key UNIQUE (mb_release_group_id);

ALTER TABLE release_groups
  DROP CONSTRAINT IF EXISTS release_groups_source_check;
ALTER TABLE release_groups ADD CONSTRAINT release_groups_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'listenbrainz', 'manual'));

-- HNSW for semantic search (matches the old releases index; cosine = L2-normalized Jina output)
CREATE INDEX IF NOT EXISTS idx_release_groups_embedding_hnsw
  ON release_groups USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────────────────────────
-- §2  releases: provenance
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS source        text,
  ADD COLUMN IF NOT EXISTS mb_release_id text;               -- MBID of the edition (idempotent re-ingest)

ALTER TABLE releases DROP CONSTRAINT IF EXISTS releases_mb_release_id_key;
ALTER TABLE releases ADD  CONSTRAINT releases_mb_release_id_key UNIQUE (mb_release_id);

ALTER TABLE releases
  DROP CONSTRAINT IF EXISTS releases_source_check;
ALTER TABLE releases ADD CONSTRAINT releases_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'listenbrainz', 'manual'));

-- ─────────────────────────────────────────────────────────────────
-- §3  recordings: identity = MBID; ISRC demoted to a non-unique signal
-- ─────────────────────────────────────────────────────────────────
-- A recording can carry several ISRCs and ISRCs get reused across remasters,
-- so ISRC must NOT be the identity. Identity is the MusicBrainz recording MBID;
-- ISRC stays as a matching/lookup signal only.
ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS mb_recording_id text,
  ADD COLUMN IF NOT EXISTS source          text;

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_isrc_key;        -- drop UNIQUE(isrc)
ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_mb_recording_id_key;
ALTER TABLE recordings ADD  CONSTRAINT recordings_mb_recording_id_key UNIQUE (mb_recording_id);

ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_source_check;
ALTER TABLE recordings ADD CONSTRAINT recordings_source_check
  CHECK (source IS NULL OR source IN ('musicbrainz', 'itunes', 'listenbrainz', 'manual'));

CREATE INDEX IF NOT EXISTS idx_recordings_isrc ON recordings (isrc) WHERE isrc IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────
-- §4  artists: ingest state machine + leasing + provenance
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE artists
  ADD COLUMN IF NOT EXISTS ingest_state  text NOT NULL DEFAULT 'pending_resolve',
  ADD COLUMN IF NOT EXISTS source_status text,            -- 'mb_verified' | 'gapfill_unverified'
  ADD COLUMN IF NOT EXISTS claimed_at    timestamptz,     -- worker lease (NULL = unclaimed)
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;

ALTER TABLE artists DROP CONSTRAINT IF EXISTS artists_ingest_state_check;
ALTER TABLE artists ADD CONSTRAINT artists_ingest_state_check
  CHECK (ingest_state IN (
    'pending_resolve','resolved','discography_done','tracks_done',
    'enriched','qc_passed','needs_review','failed'
  ));

ALTER TABLE artists DROP CONSTRAINT IF EXISTS artists_source_status_check;
ALTER TABLE artists ADD CONSTRAINT artists_source_status_check
  CHECK (source_status IS NULL OR source_status IN ('mb_verified','gapfill_unverified'));

-- Lane work-queue indexes: "next N artists in state X not currently leased".
CREATE INDEX IF NOT EXISTS idx_artists_ingest_state
  ON artists (ingest_state, claimed_at NULLS FIRST);

-- ─────────────────────────────────────────────────────────────────
-- §5  artist_aliases: identity is the MBID, so aliases are NON-unique
-- ─────────────────────────────────────────────────────────────────
-- Drop the global UNIQUE(alias) (it blocked two same-name artists, e.g. the
-- Korean R&B "Crush" vs the US band "Crush"). Add normalization + locale metadata.
ALTER TABLE artist_aliases DROP CONSTRAINT IF EXISTS artist_aliases_alias_key;

ALTER TABLE artist_aliases
  ADD COLUMN IF NOT EXISTS alias_norm         text,
  ADD COLUMN IF NOT EXISTS script             text,        -- 'latin' | 'hangul' | 'kana' | 'han' ...
  ADD COLUMN IF NOT EXISTS primary_for_locale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source             text;

-- Prevent exact duplicate alias rows for the same artist (but allow same alias across artists).
DROP INDEX IF EXISTS idx_artist_aliases_artist_alias;
CREATE UNIQUE INDEX idx_artist_aliases_artist_alias
  ON artist_aliases (artist_id, alias);

CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias_norm ON artist_aliases (alias_norm);

-- ─────────────────────────────────────────────────────────────────
-- §6  pipeline_lanes: orchestrator heartbeat / monitoring
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_lanes (
  lane         text PRIMARY KEY,          -- 'discover' | 'resolve' | 'albums' | ...
  status       text,                      -- 'running' | 'idle' | 'paused' | 'error'
  last_active  timestamptz,
  current_item text,
  items_done   bigint NOT NULL DEFAULT 0,
  errors       bigint NOT NULL DEFAULT 0,
  last_error   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pipeline_lanes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pipeline_lanes_select ON pipeline_lanes;
CREATE POLICY pipeline_lanes_select ON pipeline_lanes FOR SELECT USING (true);
-- (writes are service-role only — RLS bypassed by the service key)

COMMIT;
