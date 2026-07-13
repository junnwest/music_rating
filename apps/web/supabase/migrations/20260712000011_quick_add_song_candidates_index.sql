-- get_quick_add_song_candidates (20260712000009) times out: recordings has no index
-- on artist_display (only on primary_artist_id), so `r.artist_display = ANY(p_artist_names)`
-- forces a full sequential scan of recordings (3.16M rows) before the release_tracks/releases/
-- release_groups join and DISTINCT ON sort even start. release_groups has an equivalent trigram
-- index (idx_release_groups_display_trgm) and is ~10x smaller, which is why the album-side
-- get_quick_add_candidates RPC never hit this.
--
-- CONCURRENTLY can't run inside a transaction block -- must be applied as its own statement,
-- same as idx_release_groups_genres_gin (20260712000001).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recordings_artist_display
  ON recordings (artist_display);
