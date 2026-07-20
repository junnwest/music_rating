import { supabase } from '../supabaseClient';

/**
 * The "Not interested" signal (table `not_interested`, migration 20260719000000).
 *
 * Two jobs: write the row when the user dismisses an album, and read the set back
 * so surfaces whose candidates *aren't* filtered in SQL (the Home explore feed,
 * which ranks `ratings` rows client-side) can drop them too. Quick Add's RPC
 * already excludes them server-side; the client filter there is belt-and-braces
 * for the window before the migration lands on an environment.
 *
 * Every call is best-effort: a missing table or an RLS refusal must never take a
 * feed down, so failures resolve to "nothing dismissed" rather than throwing.
 */

export async function fetchNotInterestedIds(userId: string | null): Promise<Set<string>> {
  if (!supabase || !userId) return new Set();
  const { data, error } = await supabase
    .from('not_interested')
    .select('release_group_id')
    .eq('user_id', userId);
  if (error) return new Set();
  return new Set(
    ((data as { release_group_id: string }[] | null) ?? []).map((r) => r.release_group_id),
  );
}

/** Idempotent — marking an already-dismissed album is a no-op, not a PK violation. */
export async function markNotInterested(
  userId: string | null,
  releaseGroupId: string,
): Promise<void> {
  if (!supabase || !userId) return;
  await supabase
    .from('not_interested')
    .upsert(
      { user_id: userId, release_group_id: releaseGroupId },
      { onConflict: 'user_id,release_group_id' },
    );
}

export async function unmarkNotInterested(
  userId: string | null,
  releaseGroupId: string,
): Promise<void> {
  if (!supabase || !userId) return;
  await supabase
    .from('not_interested')
    .delete()
    .eq('user_id', userId)
    .eq('release_group_id', releaseGroupId);
}
