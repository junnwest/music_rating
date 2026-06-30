-- Search-miss auto-recovery: the pipeline's idle ingest time resolves logged search misses to
-- MBIDs and queues them (self-healing catalog). queued_at marks a miss as processed (even if it
-- resolved ambiguously / not at all) so it's tried once, not on every idle cycle.
ALTER TABLE search_misses ADD COLUMN IF NOT EXISTS queued_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_search_misses_unqueued
  ON search_misses (searched_at) WHERE queued_at IS NULL;
