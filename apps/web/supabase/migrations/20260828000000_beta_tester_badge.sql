-- Beta-tester badge (2026-08-28): a permanent flag for accounts recruited via private outreach
-- (Korean music-related influencers) ahead of the public beta. Same pattern as `is_verified` --
-- granted manually, no self-serve flow, no admin UI:
--   UPDATE profiles SET is_beta_tester = true WHERE username = '...';
-- Rendered as a rocket (sjAmber) next to the @handle, alongside the quest-completion flower and
-- verified seal -- see BetaBadgeView in Components/QuestBadge.swift.
--
-- This flag is also the intended anchor for the "permanent ad-free" perk promised to the same
-- accounts once ads exist: check is_beta_tester there rather than introducing a second flag.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_beta_tester boolean NOT NULL DEFAULT false;
