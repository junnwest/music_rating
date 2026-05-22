-- Query performance indexes
-- (Many tables already have btree indexes from UNIQUE/PK constraints;
--  these add coverage for the non-leading-key columns that appear in filters.)

-- ratings: queries by release_id (user_id is already the leading UNIQUE key)
CREATE INDEX IF NOT EXISTS idx_ratings_release_id ON ratings (release_id);

-- reviews: queries by release_id (user_id is already the leading UNIQUE key)
CREATE INDEX IF NOT EXISTS idx_reviews_release_id ON reviews (release_id);

-- follows: queries by following_id (follower_id is already the leading PK key)
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (following_id);

-- user_rankings: queries by category_id (user_id is already the leading UNIQUE key)
CREATE INDEX IF NOT EXISTS idx_user_rankings_category_id ON user_rankings (category_id);

-- user_ranking_entries: queries by release_id (ranking_id is already the leading UNIQUE key)
CREATE INDEX IF NOT EXISTS idx_user_ranking_entries_release_id ON user_ranking_entries (release_id);

-- releases: GIN index for full-text search on title + artist
CREATE INDEX IF NOT EXISTS idx_releases_fts ON releases USING GIN (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(artist, ''))
);
