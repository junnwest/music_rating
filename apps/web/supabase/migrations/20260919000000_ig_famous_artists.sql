-- ================================================================
-- Instagram "out now" pipeline — famous-artist watchlist + detected releases
-- 2026-09-19
-- ================================================================
-- Run in the Supabase SQL editor (not supabase db push), per this project's
-- convention. Idempotent; safe to re-run.
--
-- Standalone tables for a NEW, separate pipeline (Instagram release-announcement
-- graphics for globally famous artists) — deliberately not touching artists /
-- release_groups / releases, which are the curated Korean-underground rating
-- catalog. See RENOVATION_PLAN-adjacent SESSIONS.md 2026-09-19 for context.
-- ================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- §1  ig_famous_artists: the watchlist (global, any market — NOT the rating catalog)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_famous_artists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  name_native text,
  mbid        text,              -- MusicBrainz artist MBID; NULL until resolve-famous-artists.ts confirms it
  country     text,
  genre       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ig_famous_artists DROP CONSTRAINT IF EXISTS ig_famous_artists_mbid_key;
ALTER TABLE ig_famous_artists ADD CONSTRAINT ig_famous_artists_mbid_key UNIQUE (mbid);

CREATE INDEX IF NOT EXISTS idx_ig_famous_artists_active
  ON ig_famous_artists (active) WHERE active;

ALTER TABLE ig_famous_artists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ig_famous_artists_select ON ig_famous_artists;
CREATE POLICY ig_famous_artists_select ON ig_famous_artists FOR SELECT USING (true);
-- (writes are service-role only — RLS bypassed by the service key)

-- ─────────────────────────────────────────────────────────────────
-- §2  ig_detected_releases: one row per (famous artist, MB release group) hit
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ig_detected_releases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  famous_artist_id   uuid NOT NULL REFERENCES ig_famous_artists(id) ON DELETE CASCADE,
  release_group_mbid text NOT NULL,      -- MB release-group MBID (dedupe key alongside artist)
  title              text NOT NULL,
  artist_credit      text NOT NULL,      -- MB's display credit string, e.g. "Lady Gaga & Bradley Cooper"
  primary_type       text,               -- 'Album' | 'EP' | 'Single' | ... (from MB)
  release_date       date,
  cover_url          text,
  poster_path        text,
  caption            text,
  status             text NOT NULL DEFAULT 'new',
  detected_at        timestamptz NOT NULL DEFAULT now(),
  rendered_at        timestamptz
);

ALTER TABLE ig_detected_releases DROP CONSTRAINT IF EXISTS ig_detected_releases_status_check;
ALTER TABLE ig_detected_releases ADD CONSTRAINT ig_detected_releases_status_check
  CHECK (status IN ('new', 'rendered', 'dismissed'));

-- The dedupe key: MB's date-window sweep re-sweeps an overlapping window every
-- run by design (see discover-mb-newreleases.ts's rationale), so without this
-- the same release would be inserted again on every cycle.
DROP INDEX IF EXISTS idx_ig_detected_releases_artist_mbid;
CREATE UNIQUE INDEX idx_ig_detected_releases_artist_mbid
  ON ig_detected_releases (famous_artist_id, release_group_mbid);

CREATE INDEX IF NOT EXISTS idx_ig_detected_releases_status
  ON ig_detected_releases (status);

ALTER TABLE ig_detected_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ig_detected_releases_select ON ig_detected_releases;
CREATE POLICY ig_detected_releases_select ON ig_detected_releases FOR SELECT USING (true);
-- (writes are service-role only — RLS bypassed by the service key)

COMMIT;
