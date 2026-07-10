-- Verified badge (2026-07-08): a simple flag for known critics/artists/content creators,
-- granted manually (no self-serve application flow, no admin UI yet -- this app's scale doesn't
-- warrant either) via a direct UPDATE in the SQL editor:
--   UPDATE profiles SET is_verified = true WHERE username = '...';
-- Rendered as a plain checkmark.seal.fill (sjBlue) next to the @handle everywhere it appears --
-- see VerifiedBadgeView in Components/QuestBadge.swift.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
