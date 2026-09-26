import { supabase } from '../supabaseClient';

/**
 * The one client module for "add to mix". Albums live in `mix_items`, songs in
 * `mix_song_items` (migration 20260722000000); every surface goes through these
 * helpers — or, for UI, through `MixTargetContext`, which wraps them with the
 * optimistic cache — instead of writing either table directly.
 *
 * Every helper returns `{ error }` (or `null` data on failure) rather than
 * throwing, so the optimistic callers can roll back.
 */

export type MixItemRef =
  | { kind: 'album'; releaseGroupId: string }
  | { kind: 'song'; recordingId: string; releaseGroupId: string };

/** Optional display context for a saved item (dock row, flying thumbnail). */
export interface MixItemMeta {
  coverUrl?: string | null;
  title?: string;
  subtitle?: string;
}

export interface MixSummary {
  id: string;
  name: string;
  is_public: boolean;
  is_default: boolean;
  created_at: string;
  itemCount: number;
  /** Up to 4 most-recent covers (albums and songs), newest first. */
  covers: string[];
}

/** Stable key for an item across both tables — `a:<rg>` / `s:<recording>`. */
export function itemKey(item: MixItemRef): string {
  return item.kind === 'album' ? `a:${item.releaseGroupId}` : `s:${item.recordingId}`;
}

type Err = { message: string } | null;

interface MixRowWithEmbeds {
  id: string;
  name: string;
  is_public: boolean;
  is_default: boolean;
  created_at: string;
  albums: { count: number }[] | null;
  songs: { count: number }[] | null;
  recent: { created_at: string; release_groups: { cover_url: string | null } | null }[] | null;
  recentSongs: { created_at: string; release_groups: { cover_url: string | null } | null }[] | null;
}

function toSummary(r: MixRowWithEmbeds): MixSummary {
  const recent = [...(r.recent ?? []), ...(r.recentSongs ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((x) => x.release_groups?.cover_url)
    .filter((u): u is string => !!u);
  return {
    id: r.id,
    name: r.name,
    is_public: r.is_public,
    is_default: r.is_default,
    created_at: r.created_at,
    itemCount: (r.albums?.[0]?.count ?? 0) + (r.songs?.[0]?.count ?? 0),
    covers: Array.from(new Set(recent)).slice(0, 4),
  };
}

const SUMMARY_COLS =
  'id, name, is_public, is_default, created_at, ' +
  'albums:mix_items(count), songs:mix_song_items(count), ' +
  'recent:mix_items(created_at, release_groups(cover_url)), ' +
  'recentSongs:mix_song_items(created_at, release_groups(cover_url))';

/** The signed-in user's mixes — Listen Later first, then oldest → newest. */
export async function listMyMixes(
  userId: string,
): Promise<{ data: MixSummary[] | null; error: Err }> {
  if (!supabase) return { data: null, error: { message: 'no client' } };
  const { data, error } = await supabase
    .from('mixes')
    .select(SUMMARY_COLS)
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .order('created_at', { referencedTable: 'recent', ascending: false })
    .limit(4, { referencedTable: 'recent' })
    .order('created_at', { referencedTable: 'recentSongs', ascending: false })
    .limit(4, { referencedTable: 'recentSongs' });
  if (error) return { data: null, error };
  return { data: ((data as unknown as MixRowWithEmbeds[]) ?? []).map(toSummary), error: null };
}

const PAGE = 1000;

/**
 * Every item key the user has saved, mapped to the mixes holding it. One
 * paged read per table, so a page full of bookmark buttons can resolve its
 * filled/empty state (D3) from memory instead of one query per cover.
 */
export async function loadMembershipIndex(
  mixIds: string[],
): Promise<{ data: Map<string, Set<string>> | null; error: Err }> {
  const index = new Map<string, Set<string>>();
  if (!supabase || mixIds.length === 0) return { data: index, error: null };
  const add = (key: string, mixId: string) => {
    const set = index.get(key) ?? new Set<string>();
    set.add(mixId);
    index.set(key, set);
  };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mix_items')
      .select('mix_id, release_group_id')
      .in('mix_id', mixIds)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    for (const r of (data as { mix_id: string; release_group_id: string }[]) ?? []) {
      add(`a:${r.release_group_id}`, r.mix_id);
    }
    if (!data || data.length < PAGE) break;
  }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mix_song_items')
      .select('mix_id, recording_id')
      .in('mix_id', mixIds)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    for (const r of (data as { mix_id: string; recording_id: string }[]) ?? []) {
      add(`s:${r.recording_id}`, r.mix_id);
    }
    if (!data || data.length < PAGE) break;
  }
  return { data: index, error: null };
}

/** Which of `mixIds` hold this item — a fresh read, for callers without the cache. */
export async function membershipFor(
  item: MixItemRef,
  mixIds: string[],
): Promise<{ data: string[] | null; error: Err }> {
  if (!supabase) return { data: null, error: { message: 'no client' } };
  if (mixIds.length === 0) return { data: [], error: null };
  const { data, error } =
    item.kind === 'album'
      ? await supabase
          .from('mix_items')
          .select('mix_id')
          .eq('release_group_id', item.releaseGroupId)
          .in('mix_id', mixIds)
      : await supabase
          .from('mix_song_items')
          .select('mix_id')
          .eq('recording_id', item.recordingId)
          .in('mix_id', mixIds);
  if (error) return { data: null, error };
  return { data: ((data as { mix_id: string }[]) ?? []).map((r) => r.mix_id), error: null };
}

export async function addToMix(mixId: string, item: MixItemRef): Promise<{ error: Err }> {
  if (!supabase) return { error: { message: 'no client' } };
  const { error } =
    item.kind === 'album'
      ? await supabase
          .from('mix_items')
          .upsert(
            { mix_id: mixId, release_group_id: item.releaseGroupId },
            { onConflict: 'mix_id,release_group_id', ignoreDuplicates: true },
          )
      : await supabase.from('mix_song_items').upsert(
          {
            mix_id: mixId,
            recording_id: item.recordingId,
            release_group_id: item.releaseGroupId,
          },
          { onConflict: 'mix_id,recording_id', ignoreDuplicates: true },
        );
  return { error };
}

export async function removeFromMix(mixId: string, item: MixItemRef): Promise<{ error: Err }> {
  if (!supabase) return { error: { message: 'no client' } };
  const { error } =
    item.kind === 'album'
      ? await supabase
          .from('mix_items')
          .delete()
          .eq('mix_id', mixId)
          .eq('release_group_id', item.releaseGroupId)
      : await supabase
          .from('mix_song_items')
          .delete()
          .eq('mix_id', mixId)
          .eq('recording_id', item.recordingId);
  return { error };
}

export async function createMix(
  userId: string,
  name: string,
  isPublic: boolean,
): Promise<{ data: MixSummary | null; error: Err }> {
  if (!supabase) return { data: null, error: { message: 'no client' } };
  const { data, error } = await supabase
    .from('mixes')
    .insert({ user_id: userId, name: name.trim(), is_public: isPublic, is_default: false })
    .select('id, name, is_public, is_default, created_at')
    .single();
  if (error || !data) return { data: null, error: error ?? { message: 'insert returned no row' } };
  const row = data as Omit<MixSummary, 'itemCount' | 'covers'>;
  return { data: { ...row, itemCount: 0, covers: [] }, error: null };
}
