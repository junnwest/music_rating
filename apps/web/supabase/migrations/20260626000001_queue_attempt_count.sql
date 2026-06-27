-- QC lane support: per-row retry counter on the ingestion queue so the QC lane can
-- auto-requeue transiently-failed artists a bounded number of times (self-healing)
-- without risking an infinite retry loop on a permanently-broken row.
--
-- Safe to run anytime (additive, defaulted). Apply via the Supabase SQL editor.

ALTER TABLE artist_ingestion_queue
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0;
