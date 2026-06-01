-- Track sub-items stored under their parent album entry in a playlist.
-- list_items represents the album; list_item_tracks represents individual tracks
-- that the user explicitly added from the album's tracklist.
CREATE TABLE IF NOT EXISTS list_item_tracks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_item_id    UUID        NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
  track_title     TEXT        NOT NULL,
  track_position  INTEGER,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(list_item_id, track_position)
);

ALTER TABLE list_item_tracks ENABLE ROW LEVEL SECURITY;

-- Anyone can read (consistent with list_items read policy)
CREATE POLICY "list_item_tracks_select" ON list_item_tracks
  FOR SELECT USING (true);

-- Only the playlist owner can insert
CREATE POLICY "list_item_tracks_insert" ON list_item_tracks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM list_items li
      JOIN lists l ON l.id = li.list_id
      WHERE li.id = list_item_id AND l.user_id = auth.uid()
    )
  );

-- Only the playlist owner can delete
CREATE POLICY "list_item_tracks_delete" ON list_item_tracks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM list_items li
      JOIN lists l ON l.id = li.list_id
      WHERE li.id = list_item_id AND l.user_id = auth.uid()
    )
  );
