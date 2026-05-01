-- Add onboarding fields to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS preferred_genres text;

-- Relax the NOT NULL on username to allow staged saves during onboarding
-- (username will be set on step 1 completion)
ALTER TABLE profiles ALTER COLUMN username DROP NOT NULL;
