-- Beta-tester redeem tokens: one-time links sent privately to influencer outreach
-- (see 20260828000000_beta_tester_badge.sql). Mirrors the existing referral-code
-- system's shape (20260706000006_referral_system.sql) closely on purpose --
-- same SECURITY DEFINER + search_path pinning, same "DB-side generator, no
-- app-writable grant column" posture -- just keyed by a standalone token
-- instead of a per-profile code, since these aren't reusable/shareable.

CREATE TABLE IF NOT EXISTS beta_redeem_tokens (
  token       text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  redeemed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  redeemed_at timestamptz
);

ALTER TABLE beta_redeem_tokens ENABLE ROW LEVEL SECURITY;
-- No policies -- no client (anon or authenticated) can read or write this
-- table directly. Only touched via generate_beta_tokens() (SQL-editor only,
-- ungranted) and redeem_beta_token() (SECURITY DEFINER) below.

-- Run manually from the SQL editor to mint a batch, e.g.:
--   SELECT generate_beta_tokens(5);
-- Each returned token becomes the tail of https://sillajuku.com/beta/<token>,
-- sent directly to one influencer.
CREATE OR REPLACE FUNCTION generate_beta_tokens(n int)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  -- Same confusable-character exclusion as generate_referral_code(), longer
  -- (12 chars) since these are only ever tapped from a link, never hand-typed,
  -- and are worth more (permanent ad-free + badge) than a referral code.
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  tok   text;
  j     int;
  k     int;
BEGIN
  FOR j IN 1..n LOOP
    LOOP
      tok := '';
      FOR k IN 1..12 LOOP
        tok := tok || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM beta_redeem_tokens WHERE token = tok);
    END LOOP;
    INSERT INTO beta_redeem_tokens (token) VALUES (tok);
    RETURN NEXT tok;
  END LOOP;
END;
$$;

-- Invited user's app calls this once, post-signup/sign-in (see
-- PendingBetaTokenStore.swift / BetaTokenClipboardHandoff.swift). Atomic:
-- the UPDATE ... WHERE redeemed_by IS NULL is what actually prevents a
-- double-redeem race, not the app-side "already consumed" bookkeeping.
CREATE OR REPLACE FUNCTION redeem_beta_token(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE beta_redeem_tokens
  SET redeemed_by = auth.uid(), redeemed_at = now()
  WHERE token = upper(trim(p_token))
    AND redeemed_by IS NULL;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE profiles SET is_beta_tester = true WHERE id = auth.uid();
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION redeem_beta_token(text) TO authenticated;
