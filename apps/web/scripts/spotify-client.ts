/**
 * Minimal Spotify Web API client for the recency lane (discover-spotify-recency.ts).
 *
 * Client-credentials only (no user auth) — same app credentials the production web
 * server uses for search fallback / cover backfill, so this MUST cooperate with the
 * shared rate-limit circuit in spotify-circuit.ts: a script burst here can trigger an
 * account-wide 429 that breaks production search for real users. Callers check
 * assertSpotifyCircuitClosed() before a scan and this module calls recordSpotify429()
 * whenever Spotify itself returns 429, on top of its own local backoff (mirrors
 * itunes-client.ts's ItunesBlockedError pattern for gapfill/recency shared state).
 *
 * Spotify's catalog isn't storefront-partitioned the way iTunes search is (no need to
 * rotate through country stores to find a release) -- one market is enough.
 */

import { recordSpotify429 } from './spotify-circuit';

const API_BASE = 'https://api.spotify.com/v1';
const MARKET = 'US'; // broad catalog coverage; client-credentials search needs *a* market

let token: string | null = null;
let tokenExpiry = 0;

async function getToken(): Promise<string | null> {
  if (token && Date.now() < tokenExpiry) return token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    token = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return token;
  } catch {
    return null;
  }
}

export class SpotifyBlockedError extends Error {
  constructor() { super('Spotify rate-limited this script (429)'); this.name = 'SpotifyBlockedError'; }
}

let consecutive429 = 0;
const ABORT_AFTER_429 = 3;
export function spotifyBlocked(): boolean { return consecutive429 >= ABORT_AFTER_429; }
export function resetSpotifyBlock(): void { consecutive429 = 0; }

// No fetch timeout here would mean a single stalled connection blocks this call
// forever — and unlike ingest/freshness, this lane has no watchdog to force a
// restart if that happens (found live: the pipeline's recency-spotify lane sat at
// "scanned 25" for 20+ minutes on its second batch with the process still alive,
// consistent with exactly this). 15s is generous for a JSON API response.
const REQUEST_TIMEOUT_MS = 15_000;

async function spotifyGet(path: string, source: string): Promise<any | null> {
  const t = await getToken();
  if (!t) return null;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null; // timeout or network error — treat like any other unresolved fetch
  }
  if (res.status === 429) {
    consecutive429++;
    const retryAfter = Number(res.headers.get('Retry-After') ?? '30');
    await recordSpotify429(retryAfter, source);
    if (consecutive429 >= ABORT_AFTER_429) throw new SpotifyBlockedError();
    return null;
  }
  consecutive429 = 0;
  if (!res.ok) return null;
  return res.json();
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: string; // 'album' | 'single' | 'compilation'
  release_date: string;
  release_date_precision: string; // 'year' | 'month' | 'day'
  total_tracks: number;
  images: { url: string; width: number }[];
  artists: { id: string; name: string }[];
  external_ids?: { upc?: string };
}

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Resolve an artist's Spotify id from a known (title, artist) pair we already have. */
export async function searchAlbum(title: string, artist: string): Promise<SpotifyAlbum | null> {
  const q = encodeURIComponent(`album:${title} artist:${artist}`);
  const data = await spotifyGet(`/search?q=${q}&type=album&limit=5&market=${MARKET}`, 'recency-search');
  const items: SpotifyAlbum[] = data?.albums?.items ?? [];
  const wt = norm(title), wa = norm(artist);
  return (
    items.find(a => norm(a.name) === wt && a.artists.some(x => norm(x.name) === wa)) ??
    items.find(a => norm(a.name).includes(wt) || wt.includes(norm(a.name))) ??
    items[0] ??
    null
  );
}

// Empirically, this app's credentials get HTTP 400 "Invalid limit" from this specific
// endpoint for any limit > 10 (Spotify's own docs claim up to 50 is fine — this may be
// a per-app/tier restriction, not documented behavior). Confirmed 10 works; pagination
// via `offset` still covers a full discography, just in more, smaller pages.
const ALBUMS_PAGE_LIMIT = 10;

/** An artist's full discography (albums + singles + compilations), paginated. */
export async function fetchDiscography(artistId: string): Promise<SpotifyAlbum[]> {
  const out: SpotifyAlbum[] = [];
  let offset = 0;
  for (;;) {
    const data = await spotifyGet(
      `/artists/${artistId}/albums?include_groups=album,single,compilation&limit=${ALBUMS_PAGE_LIMIT}&offset=${offset}&market=${MARKET}`,
      'recency-discography',
    );
    const items: SpotifyAlbum[] = data?.items ?? [];
    out.push(...items);
    if (!data?.next || items.length === 0) break;
    offset += ALBUMS_PAGE_LIMIT;
    if (offset > 500) break; // sane cap — no artist has 500+ Spotify releases in practice
  }
  // Dedupe by (normalized name, release_date) — Spotify lists region variants of the
  // same album as separate ids.
  const seen = new Set<string>();
  return out.filter(a => {
    const k = `${norm(a.name)}::${a.release_date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface SpotifyTrack {
  position: number;
  title: string;
  durationMs: number | null;
  artists: string;
}

export async function fetchAlbumTracks(albumId: string): Promise<SpotifyTrack[]> {
  const data = await spotifyGet(`/albums/${albumId}/tracks?limit=50&market=${MARKET}`, 'recency-tracks');
  const items: any[] = data?.items ?? [];
  return items.map((t, i) => ({
    position: t.track_number ?? i + 1,
    title: t.name,
    durationMs: t.duration_ms ?? null,
    artists: (t.artists ?? []).map((a: any) => a.name).join(', '),
  }));
}
