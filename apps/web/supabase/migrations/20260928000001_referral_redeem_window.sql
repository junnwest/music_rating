-- Invite codes can only be redeemed within 24 hours of signing up
-- (2026-09-27 user ask). The iOS "Have an invite code?" section hides itself
-- after that; this is the server-side backstop, so an old account can't
-- claim to have been invited by calling the RPC directly.
--
-- Same body as 20260706000006, plus the window check. Signup time is
-- auth.users.created_at (profiles.created_at can lag it during onboarding).
-- search_path pinned as in 20260706000008.

BEGIN;

CREATE OR REPLACE FUNCTION redeem_referral_code(p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer_id uuid;
  v_signed_up   timestamptz;
BEGIN
  SELECT created_at INTO v_signed_up FROM auth.users WHERE id = auth.uid();
  IF v_signed_up IS NULL OR v_signed_up < now() - interval '24 hours' THEN
    RETURN false;
  END IF;

  SELECT id INTO v_referrer_id FROM profiles WHERE referral_code = upper(trim(p_code));
  IF v_referrer_id IS NULL OR v_referrer_id = auth.uid() THEN
    RETURN false;
  END IF;

  INSERT INTO referrals (referrer_id, invited_user_id)
  VALUES (v_referrer_id, auth.uid())
  ON CONFLICT (invited_user_id) DO NOTHING;

  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION redeem_referral_code(text) TO authenticated;

COMMIT;
