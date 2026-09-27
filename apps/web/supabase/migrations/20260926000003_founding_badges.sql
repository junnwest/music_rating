-- ================================================================
-- Founding badges: the first 500 members, numbered 001–500
-- 2026-09-26
-- ================================================================
-- Claimed explicitly from the Quests tab once every personal quest
-- except the invite quests is done:
--   profile picture, bio, 25 ratings (albums + songs, = Taste unlock),
--   following at least one person, and a verified phone number.
-- The same rule applies to existing accounts -- nobody is numbered
-- automatically.
--
-- Numbers are handed out in claim order. One number per phone: the
-- claim stores a one-way hash of the verified phone, so deleting the
-- account and signing up again with the same phone can't claim a
-- second number. A deleted account's number is retired, never reused.
--
-- Replaces the rocket (is_beta_tester) as the visible badge;
-- is_beta_tester itself is untouched (it still drives the ad-free
-- perk). Separate from founding_members (20260902000000, the
-- invite-based system), which has no members and is left as is.
--
-- Run in the Supabase SQL editor.
-- ================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS founding_badges (
  number      int PRIMARY KEY CHECK (number BETWEEN 1 AND 500),
  -- SET NULL on account deletion: the number stays taken.
  profile_id  uuid UNIQUE REFERENCES profiles(id) ON DELETE SET NULL,
  phone_hash  text NOT NULL UNIQUE,
  claimed_at  timestamptz NOT NULL DEFAULT now()
);
-- No policies: phone_hash must never be readable (a hash of a phone
-- number is easy to brute-force). Numbers are public via
-- profiles.founding_number; counts via get_founding_status().
ALTER TABLE founding_badges ENABLE ROW LEVEL SECURITY;

-- Denormalized onto profiles so every screen that already selects
-- profile fields can show the badge without another query.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS founding_number int UNIQUE;

-- profiles is owner-updatable, so guard the column: only the claim
-- function may set it.
CREATE OR REPLACE FUNCTION _guard_founding_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.founding_number IS DISTINCT FROM OLD.founding_number
     AND COALESCE(current_setting('sj.founding_claim', true), '') <> 'on' THEN
    RAISE EXCEPTION 'founding_number can only be set by claim_founding_badge()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_founding_number ON profiles;
CREATE TRIGGER trg_guard_founding_number
  BEFORE UPDATE OF founding_number ON profiles
  FOR EACH ROW EXECUTE FUNCTION _guard_founding_number();

-- Returns the caller's number (existing or newly claimed). Errors:
--   not_authenticated, phone_not_verified, quests_incomplete,
--   phone_already_used, sold_out
CREATE OR REPLACE FUNCTION claim_founding_badge()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_phone   text;
  v_hash    text;
  v_profile profiles%ROWTYPE;
  v_ratings int;
  v_follows int;
  v_next    int;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_me;
  IF v_profile.founding_number IS NOT NULL THEN
    RETURN v_profile.founding_number;
  END IF;

  SELECT phone INTO v_phone FROM auth.users
  WHERE id = v_me AND phone_confirmed_at IS NOT NULL AND COALESCE(phone, '') <> '';
  IF v_phone IS NULL THEN RAISE EXCEPTION 'phone_not_verified'; END IF;

  SELECT (SELECT COUNT(*) FROM ratings WHERE user_id = v_me)
       + (SELECT COUNT(*) FROM track_ratings WHERE user_id = v_me)
    INTO v_ratings;
  SELECT COUNT(*) INTO v_follows FROM follows WHERE follower_id = v_me;

  IF COALESCE(v_profile.avatar_url, '') = ''
     OR COALESCE(btrim(v_profile.bio), '') = ''
     OR v_ratings < 25
     OR v_follows < 1
     OR v_profile.deactivated_at IS NOT NULL THEN
    RAISE EXCEPTION 'quests_incomplete';
  END IF;

  v_hash := encode(sha256(convert_to(regexp_replace(v_phone, '\D', '', 'g'), 'UTF8')), 'hex');

  -- Serialize claims so two people can't get the same next number.
  PERFORM pg_advisory_xact_lock(hashtext('founding_badges'));

  IF EXISTS (SELECT 1 FROM founding_badges WHERE phone_hash = v_hash) THEN
    RAISE EXCEPTION 'phone_already_used';
  END IF;

  SELECT COALESCE(MAX(number), 0) + 1 INTO v_next FROM founding_badges;
  IF v_next > 500 THEN RAISE EXCEPTION 'sold_out'; END IF;

  INSERT INTO founding_badges (number, profile_id, phone_hash) VALUES (v_next, v_me, v_hash);
  PERFORM set_config('sj.founding_claim', 'on', true);
  UPDATE profiles SET founding_number = v_next WHERE id = v_me;
  PERFORM set_config('sj.founding_claim', 'off', true);

  RETURN v_next;
END;
$$;
REVOKE EXECUTE ON FUNCTION claim_founding_badge() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_founding_badge() TO authenticated;

-- For the Quests card: how many are gone, and the caller's own number.
CREATE OR REPLACE FUNCTION get_founding_status()
RETURNS TABLE(claimed int, cap int, my_number int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT COUNT(*)::int FROM founding_badges),
         500,
         (SELECT founding_number FROM profiles WHERE id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION get_founding_status() TO anon, authenticated;

COMMIT;
