-- Enforce username format at the DB layer. Previously this was only
-- validated client-side in the onboarding flow -- web settings and the
-- iOS app had no length/charset check, so out-of-format usernames may
-- already exist. NOT VALID so existing rows aren't retroactively broken;
-- only new inserts/updates are checked from here on. Run
-- `ALTER TABLE profiles VALIDATE CONSTRAINT username_format;` separately
-- once any legacy violators are found (see backfill query below) and fixed.
ALTER TABLE profiles
  ADD CONSTRAINT username_format CHECK (
    username IS NULL OR username ~ '^[a-z0-9_]{3,20}$'
  ) NOT VALID;

-- To find existing violators:
-- SELECT id, username FROM profiles WHERE username IS NOT NULL AND username !~ '^[a-z0-9_]{3,20}$';
