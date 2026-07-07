-- Give the phone-reuse silent-skip a paper trail.
--
-- Why: credit_referral_on_phone_verified() (20260706000006) deliberately never
-- raises when a phone is already claimed elsewhere -- it can't, since it fires
-- inside Supabase Auth's own phone_confirmed_at update, and an exception there
-- would break phone verification itself for the person verifying, not just
-- deny the referral credit (a legitimately-reused phone -- second account,
-- shared family phone -- should still let its owner verify; it just shouldn't
-- also earn a referral). That's still the right call. But it left zero audit
-- trail: if someone reports "my friend verified but I never got credit,"
-- there's nothing to point to. This adds one, without changing what actually
-- happens for the verifying user.

CREATE TABLE IF NOT EXISTS referral_credit_skipped (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Internal audit table only -- no policies granting client access at all,
-- same posture as verified_phones.
ALTER TABLE referral_credit_skipped ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION credit_referral_on_phone_verified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referral_id    uuid;
  v_existing_owner uuid;
BEGIN
  IF NEW.phone_confirmed_at IS NOT NULL
     AND OLD.phone_confirmed_at IS NULL
     AND NEW.phone IS NOT NULL THEN

    SELECT id INTO v_referral_id FROM referrals
    WHERE invited_user_id = NEW.id AND verified_at IS NULL;

    IF v_referral_id IS NOT NULL THEN
      SELECT user_id INTO v_existing_owner FROM verified_phones WHERE phone = NEW.phone;

      IF v_existing_owner IS NULL THEN
        INSERT INTO verified_phones (phone, user_id) VALUES (NEW.phone, NEW.id);
        UPDATE referrals SET verified_at = now() WHERE id = v_referral_id;
      ELSIF v_existing_owner = NEW.id THEN
        -- Already registered to this same user (re-verification edge case) -- credit anyway.
        UPDATE referrals SET verified_at = now() WHERE id = v_referral_id;
      ELSE
        -- Phone already claimed by a DIFFERENT account -- this is the anti-abuse
        -- gate doing its job. Log it instead of silently vanishing.
        INSERT INTO referral_credit_skipped (referral_id, reason)
        VALUES (v_referral_id, 'phone already verified on another account');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
