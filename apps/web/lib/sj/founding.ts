import { supabase } from '../supabaseClient';

/**
 * Client helpers for the founding invite system
 * (supabase/migrations/20260902000000_founding_invite_system.sql). All
 * writes go through SECURITY DEFINER RPCs — nothing here trusts client
 * input beyond what those functions already validate server-side.
 */

export type InviteSource = 'team' | 'peer';
export type FoundingStatus = 'pending' | 'locked_in';

export interface PeerInviteStatus {
  allotment: number;
  used: number;
  remaining: number;
  badgeLockedIn: boolean;
  progressRatings: number;
  ratingsPerInvite: number | null;
  ratingsUntilNext: number | null;
}

export interface InviteTokenPreview {
  valid: boolean;
  reason?: 'not_found' | 'already_redeemed' | 'revoked' | 'expired' | 'cap_reached';
  source?: InviteSource;
  inviterUsername?: string | null;
  inviterDisplayName?: string | null;
  inviterAvatarUrl?: string | null;
}

export interface RedeemResult {
  ok: boolean;
  reason?: 'already_a_member' | 'invalid_or_expired' | 'cap_reached' | 'badge_not_locked_in' | 'no_allotment';
  number?: number;
  source?: InviteSource;
}

export interface Invitee {
  profile_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  number: number | null;
  status: FoundingStatus | null;
  redeemed_at: string;
}

export interface FoundingCohortSummary {
  cap: number;
  lockedIn: number;
  pending: number;
  reserved: number;
}

/** Sent invite row — direct table read (RLS: only your own). */
export interface SentInvite {
  token: string;
  source: InviteSource;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  redeemed_by: string | null;
  redeemed_at: string | null;
}

export async function getInviteTokenPreview(token: string): Promise<InviteTokenPreview> {
  if (!supabase) return { valid: false, reason: 'not_found' };
  const { data, error } = await supabase.rpc('invite_token_preview', { p_token: token });
  if (error || !data) return { valid: false, reason: 'not_found' };
  return data as InviteTokenPreview;
}

export async function redeemInviteToken(token: string): Promise<RedeemResult> {
  if (!supabase) return { ok: false, reason: 'invalid_or_expired' };
  const { data, error } = await supabase.rpc('redeem_invite_token', { p_token: token });
  if (error || !data) return { ok: false, reason: 'invalid_or_expired' };
  return data as RedeemResult;
}

export async function getPeerInviteStatus(profileId?: string): Promise<PeerInviteStatus> {
  const fallback: PeerInviteStatus = {
    allotment: 0,
    used: 0,
    remaining: 0,
    badgeLockedIn: false,
    progressRatings: 0,
    ratingsPerInvite: null,
    ratingsUntilNext: null,
  };
  if (!supabase) return fallback;
  const { data, error } = await supabase.rpc('peer_invite_status', { p_profile_id: profileId });
  if (error || !data) return fallback;
  return data as PeerInviteStatus;
}

export async function generatePeerInvite(): Promise<{ ok: boolean; token?: string; reason?: string }> {
  if (!supabase) return { ok: false, reason: 'not_configured' };
  const { data, error } = await supabase.rpc('generate_peer_invite');
  if (error || !data) return { ok: false, reason: 'not_configured' };
  return data as { ok: boolean; token?: string; reason?: string };
}

export async function revokeInviteToken(token: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('revoke_invite_token', { p_token: token });
  return !error && data === true;
}

export async function setTeamTagVisibility(visible: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('set_founding_team_tag_visibility', { p_visible: visible });
  return !error && data === true;
}

export async function listMySentInvites(): Promise<SentInvite[]> {
  if (!supabase) return [];
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data, error } = await supabase
    .from('invite_tokens')
    .select('token, source, created_at, expires_at, revoked_at, redeemed_by, redeemed_at')
    .eq('created_by', userData.user.id)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as SentInvite[];
}

export async function listInvitees(profileId: string, limit = 3, offset = 0): Promise<Invitee[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_invitees', {
    p_profile_id: profileId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return [];
  return data as Invitee[];
}

export async function countInvitees(profileId: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('count_invitees', { p_profile_id: profileId });
  if (error || typeof data !== 'number') return 0;
  return data;
}

export async function getFoundingCohortSummary(): Promise<FoundingCohortSummary | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('founding_cohort_summary');
  if (error || !data) return null;
  return data as FoundingCohortSummary;
}

export interface FoundingMember {
  profile_id: string;
  number: number;
  status: FoundingStatus;
  invited_by: string | null;
  invite_source: InviteSource;
  show_team_tag: boolean;
  reserved_at: string;
  locked_in_at: string | null;
}

/** A profile's own badge row, plus (if peer-invited) the inviter's basic info. */
export async function getFoundingMember(
  profileId: string,
): Promise<{ member: FoundingMember; inviter: { username: string | null; display_name: string | null; avatar_url: string | null } | null } | null> {
  if (!supabase) return null;
  const { data: member, error } = await supabase
    .from('founding_members')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error || !member) return null;
  let inviter = null;
  if (member.invited_by) {
    const { data } = await supabase
      .from('profiles')
      .select('username, display_name, avatar_url')
      .eq('id', member.invited_by)
      .maybeSingle();
    inviter = data ?? null;
  }
  return { member: member as FoundingMember, inviter };
}
