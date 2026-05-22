import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlbumRelease } from '../types';

// Maps onboarding genre labels → DB genre keyword fragments (ilike matching)
export const GENRE_KEYWORD_MAP: Record<string, string[]> = {
  'K-Pop':         ['k-pop', 'idol pop'],
  'K-Indie':       ['k-indie'],
  'K-R&B':         ['k-r&b', 'neo-soul'],
  'K-Rap':         ['k-rap'],
  'Korean Ballad': ['ballad'],
  'Korean Folk':   ['folk', 'singer-songwriter'],
  'J-Pop':         ['j-pop'],
  'J-Rock':        ['j-rock'],
  'City Pop':      ['city pop'],
  'Indie Rock':    ['indie rock', 'garage rock'],
  'Alternative':   ['alternative rock', 'grunge', 'post-punk'],
  'Post-Rock':     ['post-rock'],
  'Shoegaze':      ['shoegaze', 'dream pop'],
  'Hip-Hop':       ['hip-hop', 'jazz rap'],
  'R&B & Soul':    ['r&b', 'soul', 'neo-soul', 'funk'],
  'Jazz':          ['jazz'],
  'Folk':          ['folk', 'folk rock', 'singer-songwriter'],
  'Electronic':    ['electronic', 'synth-pop', 'idm', 'trip-hop', 'ambient techno'],
  'Ambient':       ['ambient'],
  'Classical':     ['classical'],
  'Pop':           ['pop', 'art pop'],
};

export interface CanonSuggestion {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_type: string;
}

export function toAlbumRelease(s: CanonSuggestion): AlbumRelease {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    date: null,
    country: null,
    releaseType: (s.release_type as AlbumRelease['releaseType']) ?? 'Album',
    coverUrl: s.cover_url,
  };
}

/**
 * Returns prestige-ordered canonical albums for the given genre selections.
 *
 * Algorithm:
 *  1. Genre-matched prestige releases (prestige 1 first, then 2)
 *  2. Fill remainder with global prestige catalog if genre-match is thin
 *  3. Artist dedup: max 1 album per artist at prestige 1, max 2 at prestige 2+
 */
export async function getCanonSuggestions(
  supabase: SupabaseClient,
  selectedGenres: string[],
  limit: number,
  excludeIds: string[] = [],
): Promise<CanonSuggestion[]> {
  const keywords = [
    ...new Set(selectedGenres.flatMap(g => GENRE_KEYWORD_MAP[g] ?? [g.toLowerCase()])),
  ];

  let rows: any[] = [];

  if (keywords.length > 0) {
    const orClause = keywords.map(k => `genres.ilike.%${k}%`).join(',');
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, prestige')
      .or(orClause)
      .not('cover_url', 'is', null)
      .not('prestige', 'is', null)
      .not('release_type', 'ilike', 'single')
      .order('prestige', { ascending: true })
      .limit(limit * 4);
    rows = data ?? [];
  }

  // Fill with global prestige catalog when genre-match is sparse
  if (rows.length < limit * 2) {
    const seen = new Set(rows.map((r: any) => r.id));
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, prestige')
      .not('cover_url', 'is', null)
      .not('prestige', 'is', null)
      .not('release_type', 'ilike', 'single')
      .order('prestige', { ascending: true })
      .limit(limit * 3);
    for (const r of data ?? []) {
      if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
    }
  }

  if (excludeIds.length > 0) {
    const ex = new Set(excludeIds);
    rows = rows.filter((r: any) => !ex.has(r.id));
  }

  // Artist dedup
  const artistCount = new Map<string, number>();
  const result: any[] = [];
  for (const r of rows) {
    const key = (r.artist ?? '').toLowerCase().split(',')[0].trim();
    const count = artistCount.get(key) ?? 0;
    const max = r.prestige === 1 ? 1 : 2;
    if (count < max) {
      result.push(r);
      artistCount.set(key, count + 1);
    }
    if (result.length >= limit) break;
  }

  return result.map((r: any) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    cover_url: r.cover_url,
    release_type: r.release_type ?? 'Album',
  }));
}
