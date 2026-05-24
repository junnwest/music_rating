-- Catalog ingestion infrastructure:
-- 1. artist_ingestion_queue — tracks artists to be ingested via non-Spotify sources
-- 2. search_misses          — logs queries that returned too few DB results

CREATE TABLE IF NOT EXISTS artist_ingestion_queue (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  name_ko          text,
  source           text        NOT NULL,  -- 'wikipedia', 'lastfm_similar', 'manual'
  source_id        text,                  -- Wikipedia page title, Last.fm MBID, etc.
  itunes_artist_id bigint,
  status           text        NOT NULL DEFAULT 'pending',
  -- pending | processing | done | failed | skipped
  releases_added   int         NOT NULL DEFAULT 0,
  error            text,
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, source)
);

CREATE INDEX idx_artist_queue_pending
  ON artist_ingestion_queue (created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS search_misses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  query       text        NOT NULL,
  type        text        NOT NULL DEFAULT 'releases',  -- 'releases' | 'artists'
  db_count    int         NOT NULL DEFAULT 0,
  searched_at timestamptz NOT NULL DEFAULT now()
);

-- Used by the nightly miss-drain job to find high-frequency gaps
CREATE INDEX idx_search_misses_query ON search_misses (query, type);
CREATE INDEX idx_search_misses_time  ON search_misses (searched_at DESC);
