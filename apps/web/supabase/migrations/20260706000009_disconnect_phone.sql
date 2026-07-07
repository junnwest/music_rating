-- Lets a user disconnect their own verified phone number (Settings ->
-- Connected Accounts). Nothing in supabase-js/supabase-swift can clear
-- auth.users.phone through the normal update path -- both the self-service
-- and admin UpdateUser handlers in gotrue treat an empty string identically
-- to "field not provided" (confirmed by reading internal/api/user.go and
-- internal/api/admin.go: both gate on `if params.Phone != ""`), so there is
-- no way to send "clear this" through the JSON API. A SECURITY DEFINER RPC
-- that writes auth.users directly is the only way, matching this
-- migration's own on_phone_verified trigger's proven ability to reach into
-- auth.users from a function.
--
-- Design (locked with the user this session):
--   - Disconnecting does NOT revoke any referral credit already earned by
--     the person who invited this user -- referrals.verified_at is a
--     permanent ledger entry, same as it already behaves today.
--   - The phone number itself IS freed for reuse -- its verified_phones row
--     (keyed by phone) is removed, so it can legitimately be verified again
--     on a different account afterward (e.g. a reassigned number, or the
--     same person's other account).
CREATE OR REPLACE FUNCTION disconnect_phone()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text;
BEGIN
  SELECT phone INTO v_phone FROM auth.users WHERE id = auth.uid();

  UPDATE auth.users SET phone = NULL, phone_confirmed_at = NULL WHERE id = auth.uid();

  IF v_phone IS NOT NULL THEN
    DELETE FROM verified_phones WHERE phone = v_phone AND user_id = auth.uid();
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION disconnect_phone() TO authenticated;
