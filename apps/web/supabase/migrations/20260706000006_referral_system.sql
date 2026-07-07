-- Referral system: a referral code per user, a referrals ledger, and a
-- phone-verification anti-multi-accounting gate, for the new quest checklist's
-- "invite a friend" / "invite 5 friends -> custom app icon" items.
--
-- Design (locked with the user this session):
--   - Account creation + entering a valid code = "redeemed" (counts toward
--     nothing on its own).
--   - The referral only counts toward the 5-invite reward once the INVITED
--     user separately completes phone verification (Supabase's native
--     phone-change OTP flow -- verifyOtp(type: 'phone_change') on an already-
--     authenticated session, never a login credential).
--   - Verification credit is set ONLY by a trigger reacting to Supabase Auth's
--     own auth.users.phone_confirmed_at -- never by an app-writable column,
--     so it can't be faked client-side.
--   - One real phone number can ever verify one account, full stop -- kept in
--     its own narrow verified_phones table, never exposed to any client-
--     reachable query (not on profiles), so reusing a phone across many
--     accounts can't farm invite credit.

-- ── Referral code: DB-generated, assigned at profile creation ──────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  -- Excludes 0/O/1/I/L -- avoids characters easily confused when read aloud
  -- or hand-copied from a screenshot.
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code  text;
  i     int;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := generate_referral_code();
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE INSERT only -- an upsert's ON CONFLICT DO UPDATE path (how onboarding
-- writes profiles) never re-fires this, so an existing user's code never changes.
DROP TRIGGER IF EXISTS trg_set_referral_code ON profiles;
CREATE TRIGGER trg_set_referral_code
BEFORE INSERT ON profiles
FOR EACH ROW EXECUTE FUNCTION set_referral_code();

-- Backfill any existing profiles (this app is pre-launch, so this covers the
-- current real + bot population) that predate this migration.
UPDATE profiles SET referral_code = generate_referral_code() WHERE referral_code IS NULL;

-- ── Referrals ledger ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- UNIQUE is what actually prevents one invitee being claimed by two
  -- referrers -- enforced by the DB, not app logic.
  invited_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at     timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users view own referrals" ON referrals;
CREATE POLICY "users view own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id);
-- No client-facing INSERT policy -- rows are only created via
-- redeem_referral_code() below (SECURITY DEFINER).

-- ── Phone anti-reuse ledger (never client-readable) ────────────────────────

CREATE TABLE IF NOT EXISTS verified_phones (
  phone       text PRIMARY KEY,
  user_id     uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE verified_phones ENABLE ROW LEVEL SECURITY;
-- Deliberately zero policies granting anon/authenticated access -- only
-- SECURITY DEFINER functions (below) touch this table.

-- ── Redemption RPC (invited user calls this once, post-signup) ─────────────

CREATE OR REPLACE FUNCTION redeem_referral_code(p_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_referrer_id uuid;
BEGIN
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

-- ── Verification trigger: fires only on Supabase Auth's own OTP confirmation ─

CREATE OR REPLACE FUNCTION credit_referral_on_phone_verified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.phone_confirmed_at IS NOT NULL
     AND OLD.phone_confirmed_at IS NULL
     AND NEW.phone IS NOT NULL THEN

    INSERT INTO verified_phones (phone, user_id)
    VALUES (NEW.phone, NEW.id)
    ON CONFLICT (phone) DO NOTHING;

    -- Only credit if THIS user_id is the one that actually claimed the phone
    -- (i.e. the conflict above didn't lose to a different, earlier account).
    UPDATE referrals
    SET verified_at = now()
    WHERE invited_user_id = NEW.id
      AND verified_at IS NULL
      AND EXISTS (
        SELECT 1 FROM verified_phones vp
        WHERE vp.phone = NEW.phone AND vp.user_id = NEW.id
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_phone_verified ON auth.users;
CREATE TRIGGER on_phone_verified
AFTER UPDATE OF phone_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION credit_referral_on_phone_verified();
