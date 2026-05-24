-- Enforce ISO 639-1 format on native_language (e.g. 'ko', 'ja', 'zh') across all tables.
-- Prevents scripts from writing 'korean', 'KO', 'kor', etc.

ALTER TABLE releases
  ADD CONSTRAINT chk_releases_native_language
  CHECK (native_language IS NULL OR native_language ~ '^[a-z]{2}$');

ALTER TABLE artists
  ADD CONSTRAINT chk_artists_native_language
  CHECK (native_language IS NULL OR native_language ~ '^[a-z]{2}$');
