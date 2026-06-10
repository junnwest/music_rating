-- Renamed from 20260531000000_profiles_streaming_platform.sql to avoid timestamp
-- collision with 20260531000000_search_artist_crosslang.sql (Supabase records only
-- one migration per timestamp). IF NOT EXISTS makes this safe to re-run.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferred_streaming_platform text
    CHECK (preferred_streaming_platform IN ('spotify', 'youtube_music', 'tidal'));
