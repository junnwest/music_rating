-- Add track_title and track_position to list_items so individual tracks
-- can be added to playlists with their own display title instead of the
-- parent album title.
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS track_title TEXT;
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS track_position INTEGER;
