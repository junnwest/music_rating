-- reconcile_prestige_scores() is a small (~2k-row) indexed UPDATE, but it kept failing with
-- 57014 "canceling statement due to statement timeout": the default role statement_timeout is
-- low, and the UPDATE briefly waits on row locks held by the live ingest pipeline (that wait
-- counts against the timeout). Give the function its own generous timeout so it waits out the
-- contention and completes. Un-contended it still finishes in a second or two.
ALTER FUNCTION reconcile_prestige_scores() SET statement_timeout = '300s';
