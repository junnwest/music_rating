-- Consolidates `releases` RLS by dropping 3 UNTRACKED policies created via the SQL
-- editor (in no migration — same class as the ratings cleanup in 20260710000000,
-- flagged 🟡 in 20260708000001's header). Verified against pg_policies 2026-07-10.
--
-- Live state before this migration — `releases` had 5 policies, 2 tracked + 3
-- untracked:
--   SELECT  releases_select                              qual: true      (tracked)
--   SELECT  "Allow authenticated users to read releases"  qual: auth.role()='authenticated'
--   INSERT  releases_insert                              with_check: true (tracked)
--   INSERT  "Allow authenticated users to insert releases" with_check: auth.role()='authenticated'
--   UPDATE  "Allow authenticated users to update releases" (auth.role()='authenticated') — the ONLY update policy
--
-- Why dropping all 3 untracked is safe (no behavior change, and more secure):
--   * SELECT / INSERT untracked are strict SUBSETS of the tracked releases_select /
--     releases_insert (both `true`). Permissive policies OR together, so removing an
--     `authenticated`-only clause under an existing `true` clause changes nobody's access.
--   * UPDATE: `releases` is catalog metadata. Every app write path is service-role
--     (lib/supabaseServer.createServerClient uses SUPABASE_SERVICE_ROLE_KEY, which
--     BYPASSES RLS — confirmed for the rankings/vote/seed-votes upsert routes), and
--     iOS is read-only on `releases` (grepped: no update/upsert/insert/delete).
--     So NO authenticated (RLS-subject) path ever updates `releases`. Dropping the
--     lone authenticated UPDATE policy therefore breaks nothing and correctly makes
--     catalog rows non-writable by ordinary users (service-role still writes freely).
--
-- Net: removes the per-row cost of the duplicate SELECT/INSERT policies, removes the
-- unwrapped auth.role() InitPlan tax these 3 carried (they were the only bare-auth
-- policies left in `public` after 20260708000001), and tightens UPDATE to
-- service-role-only. `releases` ends with exactly releases_select + releases_insert.

BEGIN;

DROP POLICY IF EXISTS "Allow authenticated users to read releases"   ON releases;
DROP POLICY IF EXISTS "Allow authenticated users to insert releases" ON releases;
DROP POLICY IF EXISTS "Allow authenticated users to update releases" ON releases;

COMMIT;
