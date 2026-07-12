-- Run this file SEPARATELY, same reason as before (CONCURRENTLY can't run inside a transaction
-- block). Apply 20260712000002 FIRST -- it creates _genres_text(), which this index expression
-- depends on. This is the index that actually makes 20260712000002's genre_matches CTE fast --
-- unlike the plain GIN array index from 20260712000001 (now dead weight for this feature
-- specifically; harmless to leave in place, just not what's doing the work).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rg_genres_text_trgm
  ON release_groups USING gin (_genres_text(genres) gin_trgm_ops);
