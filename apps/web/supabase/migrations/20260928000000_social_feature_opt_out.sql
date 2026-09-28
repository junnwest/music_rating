-- Opt-out for featuring a user's ratings/reviews (credited by @username) on
-- sillajuku's official social accounts (Instagram). Default true = opt-out
-- model, disclosed in the Privacy Policy §1/§2 and Terms §3 (2026-09-27).
-- Private accounts are never featured regardless of this flag.
--
-- Owners already update their own profiles row (notify_* etc.), and the
-- profiles guard triggers only block specific columns (badge_color,
-- founding_number, is_verified), so no policy or grant change is needed.
--
-- APPLY BEFORE deploying the iOS/web code that selects this column -- both
-- profile loads name it explicitly and would fail without it.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS allow_social_feature boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.allow_social_feature IS
  'false = never feature this user''s ratings/reviews on sillajuku''s social media accounts. Check before posting; private accounts are excluded regardless.';

COMMIT;
