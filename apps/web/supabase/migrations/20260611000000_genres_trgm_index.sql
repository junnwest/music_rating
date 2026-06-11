-- GIN trigram index on releases.genres so that ILIKE '%genre%' queries in
-- RecommendationGrid use index scans instead of full sequential scans.
-- Without this, each category query scans the entire releases table.
SET maintenance_work_mem = '64MB';
CREATE INDEX IF NOT EXISTS idx_releases_genres_trgm
  ON releases USING GIN (genres gin_trgm_ops);
