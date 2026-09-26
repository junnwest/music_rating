import { supabase } from '../supabaseClient';
import { displayName } from './display';
import type { MixItemRef } from './mixes';

/** One row of the mix — an album (`mix_items`) or a song (`mix_song_items`). */
export interface MixEntry {
  id: string;
  kind: 'album' | 'song';
  createdAt: string;
  releaseGroupId: string;
  recordingId: string | null;
  title: string;
  /** Artist for albums; "artist · album" for songs. */
  subtitle: string;
  coverUrl: string | null;
  releaseType: string | null;
}

export function mixEntryHref(e: Pick<MixEntry, 'kind' | 'releaseGroupId' | 'recordingId'>) {
  return e.kind === 'song'
    ? `/song/${e.recordingId}?rg=${e.releaseGroupId}`
    : `/album/${e.releaseGroupId}`;
}

export function mixEntryRef(e: MixEntry): MixItemRef {
  return e.kind === 'song'
    ? { kind: 'song', recordingId: e.recordingId!, releaseGroupId: e.releaseGroupId }
    : { kind: 'album', releaseGroupId: e.releaseGroupId };
}

const RG_EMBED =
  'release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))';

/**
 * Read a mix's albums and songs, newest first. Shared with the Mix Dock.
 * Returns `null` on a query failure (distinct from an empty mix).
 */
export async function loadMixEntries(mixId: string): Promise<MixEntry[] | null> {
  if (!supabase) return null;
  const [albums, songs] = await Promise.all([
    supabase
      .from('mix_items')
      .select(`id, created_at, ${RG_EMBED}`)
      .eq('mix_id', mixId)
      .order('created_at', { ascending: false }),
    supabase
      .from('mix_song_items')
      .select(`id, created_at, recording_id, recordings(title, artist_display), ${RG_EMBED}`)
      .eq('mix_id', mixId)
      .order('created_at', { ascending: false }),
  ]);
  if (albums.error || songs.error) {
    console.error('[mix] failed to load items:', (albums.error ?? songs.error)?.message);
    return null;
  }
  const out: MixEntry[] = [];
  let dangling = 0;
  for (const r of (albums.data as any[]) ?? []) {
    const rg = r.release_groups;
    if (!rg) {
      dangling++;
      continue;
    }
    out.push({
      id: r.id,
      kind: 'album',
      createdAt: r.created_at,
      releaseGroupId: rg.id,
      recordingId: null,
      title: displayName(rg.title, rg.native_title),
      subtitle: displayName(rg.artist_display, rg.artists?.name_native),
      coverUrl: rg.cover_url,
      releaseType: rg.release_group_type,
    });
  }
  for (const r of (songs.data as any[]) ?? []) {
    const rg = r.release_groups;
    if (!rg || !r.recordings) {
      dangling++;
      continue;
    }
    const artist = r.recordings.artist_display ?? displayName(rg.artist_display, rg.artists?.name_native);
    out.push({
      id: r.id,
      kind: 'song',
      createdAt: r.created_at,
      releaseGroupId: rg.id,
      recordingId: r.recording_id,
      title: r.recordings.title,
      subtitle: `${artist} · ${displayName(rg.title, rg.native_title)}`,
      coverUrl: rg.cover_url,
      releaseType: rg.release_group_type,
    });
  }
  // A dangling row can't be rendered, but silently dropping it looks
  // identical to an empty mix — say so in the console.
  if (dangling > 0) console.warn(`[mix] ${dangling} item(s) had no resolvable release`);
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

