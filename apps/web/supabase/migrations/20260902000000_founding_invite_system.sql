-- Founding invite system: sillajuku is now closed/invite-only. This migration
-- unifies team-issued + peer invites into one token table, replaces the old
-- unlimited/ungated referral_code quest mechanic with a gated peer-invite
-- allotment, and introduces the numbered founding badge (pending -> locked-in,
-- reclaimable on inactivity).
--
-- Supersedes / relates to:
--  - beta_redeem_tokens / redeem_beta_token() (20260828000001) -- team-issued
--    invites only. Superseded by invite_tokens below (source='team'); the old
--    table/function are left in place (harmless, unreferenced) rather than
--    dropped, since a few already-sent beta links may still be outstanding.
--  - referral_code / referrals / redeem_referral_code() (20260706000006) --
--    per direction from this session, retired as the invite mechanism. The
--    iOS "invite 5 friends -> custom icon" quest should be repointed to count
--    invite_tokens rows (source='peer', redeemed_by IS NOT NULL) created by
--    the user, rather than the referrals ledger. Not dropping those objects
--    here -- that's an iOS-side change with its own migration path -- but
--    redeem_referral_code() is no longer called by any new client code.
--  - is_beta_tester (20260828000000) -- kept as-is; still the flag the
--    ad-free perk checks. founding_members.status is the "badge" now, not
--    this flag.

-- ── Config (kept in the DB, not code, so ops can tune without a deploy) ────
CREATE TABLE IF NOT EXISTS founding_config (
  key   text PRIMARY KEY,
  value numeric NOT NULL
);
INSERT INTO founding_config (key, value) VALUES
  ('cap', 999),                       -- total numbered slots
  ('starting_peer_allotment', 2),     -- invites granted the moment a badge locks in
  ('ratings_per_earned_invite', 25),  -- +1 peer invite per N ratings after locking in
  ('activity_ratings_threshold', 10), -- ratings needed to lock in
  ('activity_days_threshold', 7),     -- AND at least this many distinct active days
  ('pending_grace_days', 45),         -- pending badge reclaimed if inactive this long
  ('invite_token_validity_days', 14)  -- both team + peer links expire after this
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION founding_config_int(p_key text)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT value::int FROM founding_config WHERE key = p_key;
$$;

-- ── Invite tokens: unified team + peer ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS invite_tokens (
  token        text PRIMARY KEY,
  source       text NOT NULL CHECK (source IN ('team', 'peer')),
  -- NULL for team-issued (no upstream member in the lineage chain) --
  -- REQUIRED for peer (enforced below).
  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  redeemed_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  redeemed_at  timestamptz,
  CONSTRAINT peer_requires_creator CHECK (source = 'team' OR created_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_created_by ON invite_tokens(created_by) WHERE source = 'peer';
CREATE INDEX IF NOT EXISTS idx_invite_tokens_redeemed_by ON invite_tokens(redeemed_by) WHERE redeemed_by IS NOT NULL;

ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members view own sent invites" ON invite_tokens;
CREATE POLICY "members view own sent invites" ON invite_tokens
  FOR SELECT USING (auth.uid() = created_by);
-- No client-facing INSERT/UPDATE/DELETE policy -- rows are only ever
-- written via the SECURITY DEFINER RPCs below (same posture as
-- beta_redeem_tokens / referrals before it).

-- ── Founding members: the numbered badge ────────────────────────────────────
CREATE TABLE IF NOT EXISTS founding_members (
  profile_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  number        int UNIQUE NOT NULL CHECK (number >= 1),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'locked_in')),
  -- NULL = team-issued (no upstream member).
  invited_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invite_source text NOT NULL CHECK (invite_source IN ('team', 'peer')),
  -- Team-issued members can opt to hide the "invited by sillajuku" mark on
  -- their own profile (see design notes) -- default visible.
  show_team_tag boolean NOT NULL DEFAULT true,
  reserved_at   timestamptz NOT NULL DEFAULT now(),
  locked_in_at  timestamptz,
  -- Pending only -- NULL once locked in. A background job (or a lazy check
  -- at redemption time) deletes rows past this, freeing the number.
  expires_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_founding_members_invited_by ON founding_members(invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_founding_members_pending_expiry ON founding_members(expires_at) WHERE status = 'pending';

ALTER TABLE founding_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "founding badges are publicly readable" ON founding_members;
CREATE POLICY "founding badges are publicly readable" ON founding_members
  FOR SELECT USING (true); -- same posture as is_verified/is_beta_tester -- public status signal
-- No client-facing INSERT/UPDATE/DELETE -- only the RPCs below.

-- ── Reclaim: delete pending rows past their grace period ────────────────────
-- Run lazily at the top of redeem_invite_token() (so the pool is always
-- accurate for a new redemption) and also exposed standalone for the cron
-- job (app/api/cron/reclaim-founding-numbers), so numbers free up promptly
-- even between redemptions.
CREATE OR REPLACE FUNCTION reclaim_expired_founding_numbers()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM founding_members WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION reclaim_expired_founding_numbers() TO service_role;

-- ── Lock-in: promote pending -> locked_in once the activity bar is cleared ──
CREATE OR REPLACE FUNCTION lock_in_eligible_founding_members()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ratings_threshold int; v_days_threshold int; v_count int;
BEGIN
  v_ratings_threshold := founding_config_int('activity_ratings_threshold');
  v_days_threshold    := founding_config_int('activity_days_threshold');

  WITH eligible AS (
    SELECT fm.profile_id
    FROM founding_members fm
    WHERE fm.status = 'pending'
      AND (SELECT count(*) FROM ratings r WHERE r.user_id = fm.profile_id) >= v_ratings_threshold
      AND (SELECT count(DISTINCT date_trunc('day', r.created_at))
           FROM ratings r WHERE r.user_id = fm.profile_id) >= v_days_threshold
  )
  UPDATE founding_members fm2
  SET status = 'locked_in', locked_in_at = now(), expires_at = NULL
  FROM eligible WHERE fm2.profile_id = eligible.profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION lock_in_eligible_founding_members() TO service_role;

-- ── Redeem: the one path a new account uses, team or peer ───────────────────
CREATE OR REPLACE FUNCTION redeem_invite_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row      invite_tokens;
  v_cap      int;
  v_pool     int;
  v_number   int;
  v_grace    int;
BEGIN
  IF EXISTS (SELECT 1 FROM founding_members WHERE profile_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_a_member');
  END IF;

  PERFORM reclaim_expired_founding_numbers();

  SELECT * INTO v_row FROM invite_tokens
    WHERE token = upper(trim(p_token))
      AND redeemed_by IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  v_cap  := founding_config_int('cap');
  -- Pool occupancy = every reserved number, pending or locked -- a pending
  -- redemption already holds a real number out of the 1..cap range, so it
  -- has to count toward the same ceiling. In steady state this converges to
  -- "cap reached once ~cap members have genuinely come through" (pending
  -- is capped at pending_grace_days, so it never balloons the count by much).
  SELECT count(*) INTO v_pool FROM founding_members;
  IF v_pool >= v_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cap_reached');
  END IF;

  UPDATE invite_tokens SET redeemed_by = auth.uid(), redeemed_at = now()
  WHERE token = v_row.token AND redeemed_by IS NULL;
  IF NOT FOUND THEN
    -- Lost a race to another redeemer of the same token.
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  SELECT MIN(n) INTO v_number FROM generate_series(1, v_cap) n
    WHERE NOT EXISTS (SELECT 1 FROM founding_members WHERE number = n);
  v_grace := founding_config_int('pending_grace_days');

  INSERT INTO founding_members (profile_id, number, invited_by, invite_source, expires_at)
  VALUES (auth.uid(), v_number, v_row.created_by, v_row.source, now() + (v_grace || ' days')::interval);

  RETURN jsonb_build_object('ok', true, 'number', v_number, 'source', v_row.source);
END;
$$;
GRANT EXECUTE ON FUNCTION redeem_invite_token(text) TO authenticated;

-- ── Peer invite status: allotment / used / progress toward the next one ─────
CREATE OR REPLACE FUNCTION peer_invite_status(p_profile_id uuid DEFAULT auth.uid())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fm             founding_members;
  v_starting       int;
  v_per_earn       int;
  v_ratings_since  int;
  v_earned         int;
  v_allotment      int;
  v_used           int;
BEGIN
  SELECT * INTO v_fm FROM founding_members WHERE profile_id = p_profile_id;
  IF v_fm IS NULL OR v_fm.status <> 'locked_in' THEN
    RETURN jsonb_build_object(
      'allotment', 0, 'used', 0, 'remaining', 0,
      'badgeLockedIn', false, 'progressRatings', 0, 'ratingsPerInvite', NULL, 'ratingsUntilNext', NULL
    );
  END IF;

  v_starting := founding_config_int('starting_peer_allotment');
  v_per_earn := founding_config_int('ratings_per_earned_invite');

  SELECT count(*) INTO v_ratings_since FROM ratings
    WHERE user_id = p_profile_id AND created_at >= v_fm.locked_in_at;
  v_earned    := floor(v_ratings_since::numeric / v_per_earn);
  v_allotment := v_starting + v_earned;

  -- "Used" = permanently spent (redeemed) or still live (pending, unexpired,
  -- unrevoked). An expired or revoked-but-unredeemed token must NOT count
  -- here -- that's exactly the "slot returns to the allotment" behavior.
  SELECT count(*) INTO v_used FROM invite_tokens
    WHERE created_by = p_profile_id AND source = 'peer'
      AND (redeemed_by IS NOT NULL OR (revoked_at IS NULL AND expires_at > now()));

  RETURN jsonb_build_object(
    'allotment', v_allotment,
    'used', v_used,
    'remaining', GREATEST(v_allotment - v_used, 0),
    'badgeLockedIn', true,
    'progressRatings', v_ratings_since % v_per_earn,
    'ratingsPerInvite', v_per_earn,
    'ratingsUntilNext', v_per_earn - (v_ratings_since % v_per_earn)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION peer_invite_status(uuid) TO authenticated, anon;

-- ── Generate a peer invite (member-callable, allotment-gated) ───────────────
CREATE OR REPLACE FUNCTION generate_peer_invite()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status  jsonb;
  v_token   text;
  v_validity int;
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L -- unambiguous when read aloud
  k int;
BEGIN
  v_status := peer_invite_status(auth.uid());
  IF NOT (v_status->>'badgeLockedIn')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'badge_not_locked_in');
  END IF;
  IF (v_status->>'remaining')::int <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_allotment');
  END IF;

  v_validity := founding_config_int('invite_token_validity_days');

  LOOP
    v_token := '';
    FOR k IN 1..12 LOOP
      v_token := v_token || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM invite_tokens WHERE token = v_token);
  END LOOP;

  INSERT INTO invite_tokens (token, source, created_by, expires_at)
  VALUES (v_token, 'peer', auth.uid(), now() + (v_validity || ' days')::interval);

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'expiresInDays', v_validity);
END;
$$;
GRANT EXECUTE ON FUNCTION generate_peer_invite() TO authenticated;

-- ── Revoke a sent-but-unredeemed peer invite ─────────────────────────────────
CREATE OR REPLACE FUNCTION revoke_invite_token(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE invite_tokens SET revoked_at = now()
  WHERE token = upper(trim(p_token))
    AND created_by = auth.uid()
    AND redeemed_by IS NULL
    AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION revoke_invite_token(text) TO authenticated;

-- ── Toggle the "invited by sillajuku" tag (team-issued members only) ────────
CREATE OR REPLACE FUNCTION set_founding_team_tag_visibility(p_visible boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE founding_members SET show_team_tag = p_visible
  WHERE profile_id = auth.uid() AND invite_source = 'team';
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION set_founding_team_tag_visibility(boolean) TO authenticated;

-- ── Team-issued invite generation (admin only) ───────────────────────────────
-- Not granted to authenticated/anon -- called only from a service-role admin
-- API route (see app/api/admin/team-invites), same posture as the old
-- generate_beta_tokens() it supersedes.
CREATE OR REPLACE FUNCTION generate_team_invites(n int)
RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  tok text; j int; k int; v_validity int;
BEGIN
  v_validity := founding_config_int('invite_token_validity_days');
  FOR j IN 1..n LOOP
    LOOP
      tok := '';
      FOR k IN 1..12 LOOP
        tok := tok || substr(chars, 1 + floor(random() * length(chars))::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM invite_tokens WHERE token = tok);
    END LOOP;
    INSERT INTO invite_tokens (token, source, expires_at)
    VALUES (tok, 'team', now() + (v_validity || ' days')::interval);
    RETURN NEXT tok;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_team_invites(int) TO service_role;

-- ── Lineage read helpers ─────────────────────────────────────────────────────
-- Who a given member invited (peer invites only, redeemed ones only) --
-- newest first, for the profile page's "invited N people" expand-on-demand.
CREATE OR REPLACE FUNCTION list_invitees(p_profile_id uuid, p_limit int DEFAULT 3, p_offset int DEFAULT 0)
RETURNS TABLE(profile_id uuid, username text, display_name text, avatar_url text, number int, status text, redeemed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.username, p.display_name, p.avatar_url, fm.number, fm.status, it.redeemed_at
  FROM invite_tokens it
  JOIN profiles p ON p.id = it.redeemed_by
  LEFT JOIN founding_members fm ON fm.profile_id = p.id
  WHERE it.created_by = p_profile_id AND it.source = 'peer' AND it.redeemed_by IS NOT NULL
  ORDER BY it.redeemed_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION list_invitees(uuid, int, int) TO authenticated, anon;

CREATE OR REPLACE FUNCTION count_invitees(p_profile_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM invite_tokens
  WHERE created_by = p_profile_id AND source = 'peer' AND redeemed_by IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION count_invitees(uuid) TO authenticated, anon;

-- Pre-auth token preview: the /beta/<token> landing page needs to show who
-- invited this person and whether the link is even still good BEFORE they
-- sign in (invite_tokens itself is RLS-locked to the creator, so this is the
-- only way an anonymous visitor can see anything about their own token).
CREATE OR REPLACE FUNCTION invite_token_preview(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    invite_tokens;
  v_cap    int;
  v_pool   int;
  v_inviter profiles;
BEGIN
  SELECT * INTO v_row FROM invite_tokens WHERE token = upper(trim(p_token));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_row.redeemed_by IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_redeemed');
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  v_cap := founding_config_int('cap');
  SELECT count(*) INTO v_pool FROM founding_members;
  IF v_pool >= v_cap THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'cap_reached', 'source', v_row.source);
  END IF;

  IF v_row.created_by IS NOT NULL THEN
    SELECT * INTO v_inviter FROM profiles WHERE id = v_row.created_by;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'source', v_row.source,
    'inviterUsername', v_inviter.username,
    'inviterDisplayName', v_inviter.display_name,
    'inviterAvatarUrl', v_inviter.avatar_url
  );
END;
$$;
GRANT EXECUTE ON FUNCTION invite_token_preview(text) TO authenticated, anon;

-- Public founding-cohort summary (for the live "XXX of 999" counter and the
-- cap-reached check on the client, so it doesn't need a raw table read).
CREATE OR REPLACE FUNCTION founding_cohort_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cap', founding_config_int('cap'),
    'lockedIn', (SELECT count(*) FROM founding_members WHERE status = 'locked_in'),
    'pending', (SELECT count(*) FROM founding_members WHERE status = 'pending'),
    'reserved', (SELECT count(*) FROM founding_members)
  );
$$;
GRANT EXECUTE ON FUNCTION founding_cohort_summary() TO authenticated, anon;
