-- Add avatar_url to profiles table for profile picture support
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
