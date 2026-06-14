-- Extend the streaming platform CHECK constraint to include Apple Music.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_preferred_streaming_platform_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_preferred_streaming_platform_check
  CHECK (preferred_streaming_platform IN ('spotify', 'youtube_music', 'tidal', 'apple_music'));
