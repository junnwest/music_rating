-- Store APNs device token per user for push notification delivery.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token text;
