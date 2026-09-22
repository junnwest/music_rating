-- artist_ingestion_queue: let demand-driven work jump the bulk backlog.
--
-- THE PROBLEM. claimNext() is strict FIFO:
--   select ... where status='pending' order by created_at limit 1
-- and the table has no notion of priority. So a row queued because a REAL USER searched for an
-- artist we don't have sits behind every bulk row already in the queue. On 2026-09-22 a stub drain
-- put 34,960 rows in, which at MusicBrainz's 1 req/sec is ~39 hours -- meaning a user-driven miss
-- queued today would not be ingested until Wednesday.
--
-- Worse, pipeline.ts's tryMisses() only runs in the `if (!row)` idle branch, i.e. ONLY when the
-- queue is completely empty, so during that 39 hours search misses were not even being resolved.
-- That half is fixed in pipeline.ts (cadence-based, like FRESHNESS_EVERY); this migration fixes
-- the ordering half.
--
-- PRIORITY SCALE (higher wins, default 0 keeps every existing row exactly where it is):
--   200  listening data -- an artist in a user's connected Spotify/Apple Music library that we do
--        not hold. Strongest signal available: they demonstrably listen to it.
--   100  search miss -- a user searched and we returned nothing.
--     0  bulk backfill (credit stubs, discovery lanes, seeds).
--
-- The index matches claimNext's exact ordering so the hot query stays a single index scan rather
-- than a sort over tens of thousands of pending rows.

ALTER TABLE public.artist_ingestion_queue
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.artist_ingestion_queue.priority IS
  'Higher drains first. 200 = user listening data, 100 = user search miss, 0 = bulk backfill.';

DROP INDEX IF EXISTS idx_artist_queue_claim;
CREATE INDEX idx_artist_queue_claim
  ON public.artist_ingestion_queue (priority DESC, created_at ASC)
  WHERE status = 'pending';
