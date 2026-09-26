import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthedUserId } from './authGuard';

/**
 * Private-account filtering for API routes that read with the service role
 * (which bypasses the RLS gate added in migration 20260926000000).
 */

/**
 * Every private or deactivated account. For shared/cached output that no
 * single viewer owns. Two queries so a missing deactivated_at column
 * (migration 20260926000002 not applied) can't wipe out the private list.
 */
export async function privateUserIds(supabase: SupabaseClient): Promise<string[]> {
  const [priv, deact] = await Promise.all([
    supabase.from('profiles').select('id').eq('profile_visibility', 'Private'),
    supabase.from('profiles').select('id').not('deactivated_at', 'is', null),
  ]);
  const ids = new Set<string>();
  for (const r of (priv.data as { id: string }[] | null) ?? []) ids.add(r.id);
  for (const r of (deact.data as { id: string }[] | null) ?? []) ids.add(r.id);
  return Array.from(ids);
}

/**
 * Accounts this viewer may not see: deactivated ones, and private ones they
 * don't follow (never themselves). A null viewer (signed out, or unverified)
 * gets every private and deactivated account.
 */
export async function hiddenUserIds(
  supabase: SupabaseClient,
  viewerId: string | null,
): Promise<Set<string>> {
  if (!viewerId) return new Set(await privateUserIds(supabase));
  const { data } = await supabase.rpc('get_hidden_user_ids', { p_viewer: viewerId });
  return new Set(((data as string[] | null) ?? []).map(String));
}

/** PostgREST `not.in` list, e.g. query.not('user_id', 'in', inList(ids)). */
export function inList(ids: Iterable<string>): string {
  return `(${Array.from(ids).join(',')})`;
}

/**
 * For routes that return one user's own ratings for a `userId` param: true
 * only when the caller is signed in as that user.
 */
export async function isSelfRequest(authHeader: string | null, userId: string): Promise<boolean> {
  const authedId = await getAuthedUserId(authHeader);
  return !!authedId && authedId === userId;
}
