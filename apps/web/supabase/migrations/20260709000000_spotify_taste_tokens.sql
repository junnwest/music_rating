-- Spotify taste refresh token (2026-07-09): persists the OAuth refresh token captured at
-- login (scopes: user-top-read user-read-recently-played) so a server-side cron can pull
-- fresh top-artists/recently-played data without depending on the user reopening the app.
-- Deliberately a separate table from spotify_connections, which stores credentials for the
-- unrelated playlist-export feature under different scopes -- sharing one row between the
-- two would let one flow's token silently clobber the other's with the wrong scope.

CREATE TABLE IF NOT EXISTS spotify_taste_tokens (
  user_id       uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  refresh_token text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE spotify_taste_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spotify_taste_tokens_select" ON spotify_taste_tokens
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "spotify_taste_tokens_insert" ON spotify_taste_tokens
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "spotify_taste_tokens_update" ON spotify_taste_tokens
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "spotify_taste_tokens_delete" ON spotify_taste_tokens
  FOR DELETE USING ((select auth.uid()) = user_id);
