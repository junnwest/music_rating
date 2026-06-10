-- Add position to list_items for ordered playlists
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS position int;

-- Allow users to rename their own playlists
DROP POLICY IF EXISTS "lists_update" ON lists;
CREATE POLICY "lists_update" ON lists FOR UPDATE USING (auth.uid() = user_id);
