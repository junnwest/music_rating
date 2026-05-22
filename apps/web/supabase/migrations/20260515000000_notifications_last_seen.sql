ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notifications_last_seen_at timestamptz DEFAULT NULL;
