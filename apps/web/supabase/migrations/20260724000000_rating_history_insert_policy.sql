-- Fix: re-rating an album fails with 403 / PostgREST 42501 (insufficient_privilege).
--
-- record_rating_change() is a BEFORE UPDATE trigger on `ratings` that runs as
-- SECURITY INVOKER and, on a score change, does `INSERT INTO rating_history`.
-- rating_history has RLS enabled (since 20260518000000_rating_history.sql) but
-- only a SELECT policy was ever created — no INSERT policy. With RLS on and no
-- INSERT policy, the authenticated role's insert is denied by default, the
-- trigger raises 42501, and the whole UPDATE is rejected. Result: every score
-- change has silently failed since 2026-05-18 (new ratings, which are pure
-- INSERTs into `ratings` and fire no BEFORE UPDATE trigger, were unaffected).
--
-- Mirror the `ratings` table's own insert policy: a user may write a history row
-- for themselves. The trigger always inserts NEW.user_id, and the ratings UPDATE
-- RLS already guarantees NEW.user_id = auth.uid(), so this passes for every
-- legitimate re-rate and blocks writing history under someone else's id.
-- Idempotent on purpose. Migrations in this project are applied by hand via the
-- Supabase SQL editor across two machines, so a re-run is normal rather than an
-- error case -- and a bare CREATE POLICY fails with 42710 the second time. The
-- DROP also makes this self-correcting: it replaces any same-named policy with
-- the definition below, so running it always leaves the intended rule in place.
DROP POLICY IF EXISTS "rating_history_insert" ON rating_history;

CREATE POLICY "rating_history_insert" ON rating_history
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
