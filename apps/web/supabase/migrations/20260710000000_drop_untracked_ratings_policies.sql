-- Consolidates `ratings` RLS by dropping 4 UNTRACKED policies that were
-- created directly via the SQL editor (they appear in NO migration file in
-- either migration directory -- confirmed via grep + a live pg_policies dump
-- 2026-07-10). Flagged by the Mac session in
-- 20260708000001_rls_auth_initplan_fix.sql's header note #5.
--
-- Live state before this migration -- `ratings` had 8 policies, 4 tracked +
-- 4 untracked duplicates. Verified pairwise from pg_policies that each
-- untracked policy is fully superseded by its tracked `ratings_*` counterpart,
-- so dropping them changes NObody's effective access:
--
--   DELETE  "Allow authenticated users to delete their ratings"
--             qual (auth.uid() = user_id)  ==  ratings_delete  (identical)
--   INSERT  "Allow authenticated users to insert their ratings"
--             with_check (auth.uid() = user_id)  ==  ratings_insert (identical)
--   SELECT  "Allow authenticated users to select their ratings"
--             qual (auth.uid() = user_id)  --  ratings_select is `true`
--             (public read). Permissive policies OR together, so the
--             own-rows-only clause is a strict subset of `true`; dropping it
--             leaves visibility unchanged (everyone can still read all
--             ratings, which the social feed relies on).
--   UPDATE  "Allow authenticated users to update their ratings"
--             qual + with_check (auth.uid() = user_id)  ==  ratings_update,
--             whose with_check is NULL and therefore inherited from its
--             identical USING clause by Postgres -- functionally the same.
--
-- Net effect: consolidates to the 4 tracked policies, removes the per-row
-- cost of evaluating the duplicates, and closes the auth-wrap InitPlan gap
-- for these 4 (the tracked ratings_insert/update/delete are wrapped in the
-- 20260708000001 migration; ratings_select is `true` and calls no auth fn).
--
-- NOTE (not fixed here -- out of scope, needs a decision): the SAME untracked
-- "Allow authenticated users to ..." pattern also exists on `releases`. Its
-- INSERT/SELECT untracked policies are likewise redundant subsets of
-- releases_insert/releases_select (both `true`), BUT
-- "Allow authenticated users to update releases" is the ONLY UPDATE policy on
-- that table (no tracked releases_update exists) -- dropping it would remove
-- authenticated UPDATE entirely. Consolidating `releases` requires first
-- creating a proper tracked releases_update, so it's left for a dedicated pass.

BEGIN;

DROP POLICY IF EXISTS "Allow authenticated users to delete their ratings" ON ratings;
DROP POLICY IF EXISTS "Allow authenticated users to insert their ratings" ON ratings;
DROP POLICY IF EXISTS "Allow authenticated users to select their ratings" ON ratings;
DROP POLICY IF EXISTS "Allow authenticated users to update their ratings" ON ratings;

COMMIT;
