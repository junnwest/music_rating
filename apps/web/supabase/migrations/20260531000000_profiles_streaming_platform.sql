ALTER TABLE profiles
  ADD COLUMN preferred_streaming_platform text
  CHECK (preferred_streaming_platform IN ('spotify', 'youtube_music', 'tidal'));
