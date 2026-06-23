-- Persistent cache for Spotify listening data.
-- Written by the iOS app on each successful Spotify fetch.
-- Survives token expiry, app reinstalls, and device switches.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS spotify_artists        jsonb,
  ADD COLUMN IF NOT EXISTS spotify_recently_played jsonb,
  ADD COLUMN IF NOT EXISTS spotify_data_updated_at timestamptz;
