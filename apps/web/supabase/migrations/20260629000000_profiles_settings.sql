-- Add notification preferences and privacy settings to profiles (2026-06-29)
--
-- Notification prefs: per-type opt-out flags (default all on)
-- Privacy settings: visibility of profile, catalog, listen-later mix

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_likes              boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_replies            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_followers          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_rankings           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_capsule            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS profile_visibility        text    NOT NULL DEFAULT 'Public'
    CHECK (profile_visibility        IN ('Public', 'Followers only', 'Private')),
  ADD COLUMN IF NOT EXISTS catalog_visibility        text    NOT NULL DEFAULT 'Public'
    CHECK (catalog_visibility        IN ('Public', 'Followers only', 'Private')),
  ADD COLUMN IF NOT EXISTS listen_later_visibility   text    NOT NULL DEFAULT 'Public'
    CHECK (listen_later_visibility   IN ('Public', 'Followers only', 'Private'));
