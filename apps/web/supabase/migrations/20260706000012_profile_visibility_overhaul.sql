-- Redesigns profile privacy from 3 independent Public/Followers-only/Private
-- pickers (Profile, Catalog, Listen Later) to: a general Public/Private
-- toggle (profile_visibility) that three nullable per-subtab overrides
-- (catalog_visibility, library_visibility, stats_visibility) inherit from
-- when NULL. "Followers only" is folded into a redefined "Private" --
-- Private now directly means "followers only", not "nobody".
--
-- Safe to remap existing 'Followers only' rows straight to 'Private': an
-- audit this session found the baseline RLS on ratings/track_ratings/
-- profiles/mixes has always been fully open (`USING (true)` / public-mix-only
-- policies with no follow-awareness), so no visibility setting has ever
-- actually been enforced anywhere -- there is no real "true private"
-- guarantee being broken by this remap.
UPDATE profiles SET profile_visibility      = 'Private' WHERE profile_visibility      = 'Followers only';
UPDATE profiles SET catalog_visibility      = 'Private' WHERE catalog_visibility      = 'Followers only';
UPDATE profiles SET listen_later_visibility = 'Private' WHERE listen_later_visibility = 'Followers only';

ALTER TABLE profiles RENAME COLUMN listen_later_visibility TO library_visibility;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stats_visibility text;

-- General toggle: was already NOT NULL DEFAULT 'Public' (20260629000000);
-- only the allowed-values constraint changes here.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_profile_visibility_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_profile_visibility_check
  CHECK (profile_visibility IN ('Public', 'Private'));

-- Subtab overrides become nullable (NULL = inherit from profile_visibility).
-- Deliberately no default of 'Public' here -- new profiles start in "inherit"
-- state, matching the new Advanced-is-opt-in UX. Existing explicit values
-- (even ones that happen to equal the default) are left as explicit
-- overrides, not silently reset to NULL.
ALTER TABLE profiles ALTER COLUMN catalog_visibility DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN catalog_visibility DROP DEFAULT;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_catalog_visibility_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_catalog_visibility_check
  CHECK (catalog_visibility IS NULL OR catalog_visibility IN ('Public', 'Private'));

ALTER TABLE profiles ALTER COLUMN library_visibility DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN library_visibility DROP DEFAULT;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_listen_later_visibility_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_library_visibility_check
  CHECK (library_visibility IS NULL OR library_visibility IN ('Public', 'Private'));

ALTER TABLE profiles ADD CONSTRAINT profiles_stats_visibility_check
  CHECK (stats_visibility IS NULL OR stats_visibility IN ('Public', 'Private'));
