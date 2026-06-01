-- Stores per-user Spotify OAuth tokens for playlist export.
-- Service role writes on callback; user reads their own row via RLS.
CREATE TABLE IF NOT EXISTS spotify_connections (
  user_id       uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  spotify_user_id text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  scope         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE spotify_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spotify_conn_select" ON spotify_connections;
CREATE POLICY "spotify_conn_select" ON spotify_connections
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_conn_insert" ON spotify_connections;
CREATE POLICY "spotify_conn_insert" ON spotify_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_conn_update" ON spotify_connections;
CREATE POLICY "spotify_conn_update" ON spotify_connections
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_conn_delete" ON spotify_connections;
CREATE POLICY "spotify_conn_delete" ON spotify_connections
  FOR DELETE USING (auth.uid() = user_id);
