-- SECURITY FIX #2: the previous fix (20260902000001) revoked EXECUTE from
-- PUBLIC, which did nothing — confirmed via
--   SELECT has_function_privilege('anon', 'generate_team_invites(int)', 'EXECUTE');
-- returning true even after that migration ran. Root cause: this project has
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO
-- anon, authenticated` set at the project level (standard Supabase
-- bootstrapping) — every CREATE FUNCTION in this schema grants anon and
-- authenticated EXECUTE *directly*, independent of the PUBLIC grant. Revoking
-- from PUBLIC was a no-op; the real grant holders are anon/authenticated
-- themselves.
--
-- The only function where this was a genuine exploit (not just an unintended
-- grant with no real impact — see reasoning in 20260902000001's header) is
-- generate_team_invites: unlimited free founding-cohort invites, zero auth,
-- confirmed by actually minting a second token (JNXKFQYKP4HZ) after the
-- first "fix." That token is deleted below along with the first
-- (MC6CXGJBGMVG, in case the first migration's DELETE didn't commit either).

REVOKE EXECUTE ON FUNCTION generate_team_invites(int) FROM PUBLIC, anon, authenticated;
-- service_role grant re-asserted for clarity, not because it was in doubt.
GRANT EXECUTE ON FUNCTION generate_team_invites(int) TO service_role;

-- Defense in depth on the two cron-only maintenance functions -- calling
-- these isn't exploitable for real harm (idempotent, no sensitive data), but
-- they were never meant to be public and the same default-privileges gap
-- applies to them too.
REVOKE EXECUTE ON FUNCTION reclaim_expired_founding_numbers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION lock_in_eligible_founding_members() FROM PUBLIC, anon, authenticated;

DELETE FROM invite_tokens WHERE token IN ('MC6CXGJBGMVG', 'JNXKFQYKP4HZ');

-- Verify from the SQL editor after running this:
--   SELECT has_function_privilege('anon', 'generate_team_invites(int)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'generate_team_invites(int)', 'EXECUTE'),
--          has_function_privilege('service_role', 'generate_team_invites(int)', 'EXECUTE');
-- Expect false, false, true.
