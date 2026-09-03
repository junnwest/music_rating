/**
 * Reusable iTunes Search API client for the GAPFILL lane (mb-gapfill.ts).
 *
 * Distilled from backfill-tracklists.ts (region/store rotation + 403 handling) but with
 * one critical difference for use inside the long-running pipeline: the circuit breaker
 * is NON-FATAL. On a sustained IP-level block it THROWS `ItunesBlockedError` instead of
 * calling process.exit() — so the GAPFILL lane can back off for hours while INGEST /
 * EMBEDDINGS / DISCOVER keep running. (backfill-tracklists is a standalone script and is
 * intentionally left untouched.)
 */

import { releaseGroupKey } from './itunes-ingest-core';

const ITUNES_BASE = 'https://itunes.apple.com';
const ITUNES_DELAY = 800; // base; jitter added per request
const ABORT_AFTER_403 = 15;

export class ItunesBlockedError extends Error {
  constructor(n: number) { super(`iTunes IP-block: ${n} requests blocked in a row`); this.name = 'ItunesBlockedError'; }
}

// iTunes collection IDs are global, but song lookups need the album to exist in the
// queried store. Bias the most-likely stores by native language, then a LEAN fallback
// (a wide sweep trips the IP block — see backfill-tracklists.ts for the history).
const LANG_TO_STORES: Record<string, string[]> = {
  ko: ['KR'], ja: ['JP'], zh: ['TW', 'HK'], hi: ['IN'], th: ['TH'], vi: ['VN'], id: ['ID'],
};
const FALLBACK_STORES = ['GB', 'JP', 'KR', 'DE', 'BR'];
export function orderedStores(nativeLang: string | null): string[] {
  const front = nativeLang ? (LANG_TO_STORES[nativeLang] ?? []) : [];
  const seen = new Set<string>(['US']);
  const out: string[] = [];
  for (const s of [...front, ...FALLBACK_STORES]) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let consecutive403 = 0;
export function itunesBlocked(): boolean { return consecutive403 >= ABORT_AFTER_403; }
export function resetBlock(): void { consecutive403 = 0; }

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(ITUNES_DELAY + Math.floor(Math.random() * 500));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-gapfill/1.0' } });
    if (res.status === 429 || res.status === 403) {
      if (attempt < 3) { await sleep(Math.min(60_000, 10_000 * 2 ** attempt)); return itunesGet(url, attempt + 1); }
      consecutive403++;
      if (consecutive403 >= ABORT_AFTER_403) throw new ItunesBlockedError(consecutive403);
      return null;
    }
    if (!res.ok) return null;
    consecutive403 = 0; // a real response clears the block counter
    return await res.json();
  } catch (e) {
    if (e instanceof ItunesBlockedError) throw e;
    return null;
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[''`'"'""]/g, '').replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export interface ItunesAlbum {
  collectionId: number; collectionName: string; artistName: string; artistId: number;
  artworkUrl100?: string; primaryGenreName?: string; releaseDate?: string; trackCount?: number; country?: string;
}
export interface ItunesTrack { position: number; title: string; durationMs: number | null; artists: string }

// Match key: releaseGroupKey strips deluxe/remaster/etc., but iTunes K-pop names also
// carry release-TYPE suffixes the MB title doesn't ("MY WORLD - The 3rd Mini Album - EP",
// "Armageddon - The 1st Album", "LEMONADE - Single") — strip those too so they match.
function albumKey(title: string): string {
  const stripped = (title ?? '')
    .replace(/\s*[-–—]\s*the\s+\d+(st|nd|rd|th)\s+(full[- ]?length\s+|mini\s+|single\s+)?(album|ep|mixtape|lp)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(ep|single|lp|mixtape|mini album|album)\s*$/i, '');
  return releaseGroupKey(stripped);
}

// A GENERIC title (a short/common word — exactly the shape of many real album titles:
// "0%", "DRIP", "SIMPLE") can exact-match a totally unrelated artist's album of the same
// name. The old second-tier fallback matched on title ALONE with zero artist check, and
// that's exactly what happened live: $NOT (a real MB-verified rapper)'s seed title
// collided with an unrelated stock-instrumental-covers catalog's identically-titled
// album, and 28 of ITS releases got attached to OUR $NOT with no verification at all.
// Loose-but-nonzero artist check: same first token, or one name contains the other —
// still forgiving of romanization/format differences (the reason a loose tier exists at
// all) without accepting an artist match with NO resemblance whatsoever.
function artistLooseMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const fa = na.split(' ')[0], fb = nb.split(' ')[0];
  return !!fa && fa === fb;
}

function pickAlbum(results: any[], title: string, artist: string): ItunesAlbum | null {
  const nt = albumKey(title), na = norm(artist);
  const cols = results.filter(r => r.wrapperType === 'collection' || r.collectionId);
  const hit =
    cols.find(r => albumKey(r.collectionName ?? '') === nt && norm(r.artistName ?? '') === na) ??
    cols.find(r => albumKey(r.collectionName ?? '') === nt && artistLooseMatch(r.artistName ?? '', artist)) ??
    null;
  return hit ? (hit as ItunesAlbum) : null;
}

/** Find the best-matching album for (title, artist), trying US then the store rotation. */
export async function searchAlbum(title: string, artist: string, nativeLang: string | null): Promise<ItunesAlbum | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  for (const store of [null, ...orderedStores(nativeLang)]) {
    const c = store ? `&country=${store}` : '';
    const data = await itunesGet(`${ITUNES_BASE}/search?term=${term}&entity=album&limit=5${c}`);
    const hit = data && pickAlbum(data.results ?? [], title, artist);
    if (hit) return hit;
  }
  return null;
}

/** Resolve an artist by name → iTunes artistId (exact-name match preferred). */
export async function searchArtist(name: string): Promise<{ artistId: number; artistName: string } | null> {
  const data = await itunesGet(`${ITUNES_BASE}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`);
  const results: any[] = data?.results ?? [];
  const nn = norm(name);
  const best = results.find(r => r.wrapperType === 'artist' && norm(r.artistName ?? '') === nn)
    ?? results.find(r => r.wrapperType === 'artist');
  return best ? { artistId: best.artistId, artistName: best.artistName } : null;
}

const NOISE_RE = /\b(sped[- ]up|slowed|remix(?:es)?|instrumental|karaoke|off[- ]vocal|mr\.?|inst\.?)\b/i;
/** An artist's albums (filters obvious noise editions). */
export async function fetchDiscography(itunesArtistId: number): Promise<ItunesAlbum[]> {
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${itunesArtistId}&entity=album&limit=200`);
  return (data?.results ?? []).filter((r: any) =>
    r.wrapperType === 'collection' && r.collectionType === 'Album' &&
    !(NOISE_RE.test(r.collectionName ?? '') && (r.trackCount ?? 0) <= 3)) as ItunesAlbum[];
}

function mapTracks(results: any[]): ItunesTrack[] {
  const songs = results.filter(r => r.wrapperType === 'track' && r.kind === 'song' && r.trackName);
  if (!songs.length) return [];
  songs.sort((a, b) => ((a.discNumber ?? 1) - (b.discNumber ?? 1)) || ((a.trackNumber ?? 0) - (b.trackNumber ?? 0)));
  const multiDisc = new Set(songs.map(s => s.discNumber ?? 1)).size > 1;
  return songs.map((s, i) => ({
    position: multiDisc ? i + 1 : (s.trackNumber ?? i + 1),
    title: s.trackName, durationMs: s.trackTimeMillis ?? null, artists: s.artistName ?? '',
  }));
}

/** Tracklist for a collection, trying US then the store rotation (song lookups are store-scoped). */
export async function fetchAlbumTracks(collectionId: number, nativeLang: string | null): Promise<ItunesTrack[]> {
  for (const store of [null, ...orderedStores(nativeLang)]) {
    const c = store ? `&country=${store}` : '';
    const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=300${c}`);
    const tracks = data && mapTracks(data.results ?? []);
    if (tracks && tracks.length) return tracks;
  }
  return [];
}
