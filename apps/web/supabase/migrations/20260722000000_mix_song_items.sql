-- Songs can now be added to a Mix. Mirrors `mix_items`, but recordings don't
-- carry their own cover art and can (rarely) appear on more than one release,
-- so `release_group_id` pins down which album the song was saved from --
-- avoiding ambiguity and giving the item row a cover/title/artist to show,
-- the same context SongDetailView already requires alongside a TrackEntry.

CREATE TABLE IF NOT EXISTS mix_song_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mix_id           UUID        NOT NULL REFERENCES mixes(id)          ON DELETE CASCADE,
  recording_id     UUID        NOT NULL REFERENCES recordings(id)     ON DELETE CASCADE,
  release_group_id UUID        NOT NULL REFERENCES release_groups(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mix_id, recording_id)
);

CREATE INDEX IF NOT EXISTS idx_mix_song_items_mix_id       ON mix_song_items(mix_id);
CREATE INDEX IF NOT EXISTS idx_mix_song_items_recording_id ON mix_song_items(recording_id);

ALTER TABLE mix_song_items ENABLE ROW LEVEL SECURITY;

-- Same shape as mix_items' policies (20260620000001 + the 20260708000001 auth-initplan fix).
CREATE POLICY "users manage own mix song items"
  ON mix_song_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_song_items.mix_id
        AND mixes.user_id = (select auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_song_items.mix_id
        AND mixes.user_id = (select auth.uid())
    )
  );

CREATE POLICY "public mix song items are viewable"
  ON mix_song_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_song_items.mix_id
        AND mixes.is_public = true
    )
  );

-- get_profile_mixes: item_count must include song items now, or a mix holding
-- only songs (or a mix of both) would undercount on every surface that reads
-- this RPC (profile Mixes tab, mix share composer, etc).
DROP FUNCTION IF EXISTS get_profile_mixes(uuid);
CREATE FUNCTION get_profile_mixes(p_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, name text, description text, is_public boolean,
              is_default boolean, created_at timestamptz, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(pr.id, auth.uid(), COALESCE(pr.library_visibility, pr.profile_visibility))
  INTO v_allowed FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.id, m.user_id, m.name, m.description, m.is_public, m.is_default, m.created_at,
           COALESCE(mi.cnt, 0) + COALESCE(msi.cnt, 0) AS item_count
    FROM mixes m
    LEFT JOIN (
      SELECT mix_id, COUNT(*) AS cnt FROM mix_items GROUP BY mix_id
    ) mi ON mi.mix_id = m.id
    LEFT JOIN (
      SELECT mix_id, COUNT(*) AS cnt FROM mix_song_items GROUP BY mix_id
    ) msi ON msi.mix_id = m.id
    WHERE m.user_id = p_user_id AND m.is_public = true
    ORDER BY m.is_default DESC, m.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_mixes(uuid) TO anon, authenticated;
