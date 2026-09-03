-- SECURITY FIX, same day as 20260902000000: Postgres grants EXECUTE on a
-- newly created function to PUBLIC by default, and this project does not
-- revoke that automatically. The previous migration only ADDED grants for
-- the roles that were supposed to have access — it never REVOKEd the
-- default PUBLIC grant, so every SECURITY DEFINER function in it was
-- actually callable by anyone holding the public anon key, regardless of
-- the GRANT list. Confirmed live: an unauthenticated anon-key call to
-- generate_team_invites() successfully minted a real token
-- (MC6CXGJBGMVG, since revoked/deleted below) — a complete bypass of the
-- SEED_SECRET-gated admin route.
--
-- This locks every function down explicitly (REVOKE FROM PUBLIC, then
-- re-GRANT only the intended roles) and fixes a second issue found in the
-- same pass: peer_invite_status(p_profile_id) took an arbitrary profile id
-- with no check that the caller was actually that profile — anyone could
-- read anyone else's peer-invite allotment/usage. Restricted to self (or
-- service_role) now.
--
-- NOTE for whoever picks this up: generate_beta_tokens() in
-- 20260828000001_beta_redeem_tokens.sql has the exact same class of bug —
-- it was deliberately left ungranted on the assumption that "ungranted" ==
-- "SQL-editor only," which isn't true once PostgREST exposes it. Not fixed
-- here (out of scope for this migration, and that function is superseded
-- by generate_team_invites anyway) but flagged so it doesn't get missed.

REVOKE EXECUTE ON FUNCTION founding_config_int(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reclaim_expired_founding_numbers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reclaim_expired_founding_numbers() TO service_role;
REVOKE EXECUTE ON FUNCTION lock_in_eligible_founding_members() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_in_eligible_founding_members() TO service_role;
REVOKE EXECUTE ON FUNCTION redeem_invite_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_invite_token(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION generate_peer_invite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_peer_invite() TO authenticated;
REVOKE EXECUTE ON FUNCTION revoke_invite_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_invite_token(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION set_founding_team_tag_visibility(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_founding_team_tag_visibility(boolean) TO authenticated;

-- The critical one: no re-grant to authenticated/anon at all, service_role only.
REVOKE EXECUTE ON FUNCTION generate_team_invites(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_team_invites(int) TO service_role;

REVOKE EXECUTE ON FUNCTION list_invitees(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_invitees(uuid, int, int) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION count_invitees(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_invitees(uuid) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION invite_token_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_token_preview(text) TO authenticated, anon;
REVOKE EXECUTE ON FUNCTION founding_cohort_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION founding_cohort_summary() TO authenticated, anon;

-- peer_invite_status: restrict to self. Was `authenticated, anon` with no
-- identity check on p_profile_id -- fixed to require p_profile_id = auth.uid()
-- for anyone who isn't service_role, rather than trusting the argument.
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
  IF auth.uid() IS DISTINCT FROM p_profile_id THEN
    RETURN jsonb_build_object(
      'allotment', 0, 'used', 0, 'remaining', 0,
      'badgeLockedIn', false, 'progressRatings', 0, 'ratingsPerInvite', NULL, 'ratingsUntilNext', NULL
    );
  END IF;

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
REVOKE EXECUTE ON FUNCTION peer_invite_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peer_invite_status(uuid) TO authenticated, anon;

-- Clean up the token minted during the exploit confirmation above.
DELETE FROM invite_tokens WHERE token = 'MC6CXGJBGMVG';
