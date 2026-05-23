import type { AlbumRelease, ReleaseType } from '../types';
import { cacheGet, cacheSet } from './cache';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

// Server-side in-memory token cache (short-lived, no value in persisting)
let cachedToken: { value: string; expiresAt: number } | null = null;

// Redis TTLs (seconds). Spotify data changes rarely, so we cache aggressively.
// The shared dev/prod Spotify quota makes minimizing API calls a hard requirement.
const TTL_ARTIST     = 30 * 86400; // 30 days — artist details (genres, popularity) shift slowly
const TTL_ALBUMS     =  7 * 86400; //  7 days — full discography list (new releases appear)
const TTL_RECS       =  7 * 86400; //  7 days — search-based recommendations
const TTL_ARTIST_ID  = 90 * 86400; // 90 days — name → ID lookup is effectively permanent
const TTL_ALBUM      = 30 * 86400; // 30 days — album detail rarely changes after release

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify credentials not set in environment');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

// Maximum seconds we'll wait on a Retry-After before giving up. Anything
// longer (account-wide cooldowns of minutes/hours) should fail fast so the
// caller can show an error instead of hanging the request indefinitely.
const MAX_RETRY_WAIT_SEC = 10;

// Shared circuit-breaker key in Redis. When Spotify returns 429, we set this
// key to the timestamp at which the rate limit expires. All other Spotify
// calls short-circuit while the key is live, so a single 429 doesn't cascade
// into N independent stalls (each waiting MAX_RETRY_WAIT_SEC then throwing).
const CIRCUIT_BREAKER_KEY = 'spotify:rate-limited-until';

export class SpotifyCircuitOpenError extends Error {
  constructor(public remainingSec: number) {
    super(`Spotify circuit breaker open: ${remainingSec}s remaining`);
  }
}

async function spotifyFetch(path: string, revalidate?: number): Promise<any> {
  // Circuit breaker: if a recent call hit 429, fail fast instead of pinging
  // Spotify (which would also 429 and add ~10s of wait per request).
  const blockedUntil = await cacheGet<number>(CIRCUIT_BREAKER_KEY);
  if (blockedUntil && Date.now() < blockedUntil) {
    throw new SpotifyCircuitOpenError(Math.ceil((blockedUntil - Date.now()) / 1000));
  }

  const token = await getToken();
  const url = path.startsWith('https://') ? path : `${API_BASE}${path}`;
  const options: RequestInit & { next?: { revalidate: number } } = {
    headers: { Authorization: `Bearer ${token}` },
  };
  if (revalidate !== undefined) options.next = { revalidate };

  let res = await fetch(url, options);

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10);
    // Open the circuit breaker for the full Retry-After window so concurrent
    // requests skip Spotify entirely. TTL on the Redis key matches so the
    // breaker auto-resets when Spotify is ready again.
    const until = Date.now() + retryAfter * 1000;
    cacheSet(CIRCUIT_BREAKER_KEY, until, Math.max(retryAfter, 1)).catch(() => {});

    if (retryAfter > MAX_RETRY_WAIT_SEC) {
      throw new Error(`Spotify 429: rate-limited for ${retryAfter}s — bailing fast (max wait ${MAX_RETRY_WAIT_SEC}s)`);
    }
    await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
    res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${await getToken()}` } });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify ${res.status}: ${url} — ${body}`);
  }
  return res.json();
}

const albumTypeMap: Record<string, ReleaseType> = {
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  compilation: 'Compilation',
};

function mapAlbum(a: any): AlbumRelease {
  let releaseType: ReleaseType = albumTypeMap[a.album_type] ?? 'Album';
  if (releaseType === 'Single' && (a.total_tracks ?? 0) >= 4) releaseType = 'EP';
  return {
    id: a.id,
    title: a.name,
    artist: a.artists?.map((ar: any) => ar.name).join(', ') ?? 'Unknown artist',
    date: a.release_date ?? null,
    country: null,
    releaseType,
    coverUrl: a.images?.[0]?.url ?? null,
  };
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchSpotifyAlbums(query: string, limit = 10, market?: string): Promise<AlbumRelease[]> {
  const qs = market
    ? `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}&market=${market}`
    : `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}`;
  const data = await spotifyFetch(qs);
  return (data.albums?.items ?? [])
    .filter((a: any) => a.album_type !== 'compilation')
    .map(mapAlbum);
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  coverUrl: string | null;
}

export async function searchSpotifyArtists(query: string, limit = 10): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=artist&limit=${limit}`
  );
  return (data.artists?.items ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    popularity: a.popularity ?? 0,
    coverUrl: a.images?.[0]?.url ?? null,
  }));
}

export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  albumTitle: string | null;
  albumId: string | null;
  coverUrl: string | null;
}

export async function searchSpotifyTracks(query: string, limit = 10): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  );
  return (data.tracks?.items ?? []).map((t: any) => ({
    id: t.id,
    title: t.name,
    artist: t.artists?.map((a: any) => a.name).join(', ') ?? 'Unknown artist',
    durationMs: t.duration_ms ?? null,
    albumTitle: t.album?.name ?? null,
    albumId: t.album?.id ?? null,
    coverUrl: t.album?.images?.[0]?.url ?? null,
  }));
}

// ── Album detail ──────────────────────────────────────────────────────────────

export interface SpotifyAlbumDetail {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  artists: { id: string; name: string }[];
  date: string | null;
  releaseType: string;
  label: string | null;
  totalTracks: number;
  tracks: { position: number; title: string; durationMs: number | null; artists: string }[];
  genres: string[];
  coverUrl: string | null;
  spotifyUrl: string | null;
}

export async function getSpotifyAlbum(id: string): Promise<SpotifyAlbumDetail | null> {
  const cacheKey = `spotify:album:${id}`;
  const cached = await cacheGet<SpotifyAlbumDetail>(cacheKey);
  if (cached) return cached;
  try {
    const album = await spotifyFetch(`/albums/${id}`);

    // Spotify album genres are often empty — fall back to primary artist genres
    let genres: string[] = album.genres ?? [];
    if (genres.length === 0 && album.artists?.[0]?.id) {
      try {
        const artist = await spotifyFetch(`/artists/${album.artists[0].id}`, 86400);
        genres = artist.genres ?? [];
      } catch (err) {
        console.error('[spotify] artist genre fetch failed:', err);
      }
    }

    const tracks = (album.tracks?.items ?? []).map((t: any) => ({
      position: t.track_number,
      title: t.name,
      durationMs: t.duration_ms ?? null,
      artists: t.artists?.map((a: any) => a.name).join(', ') ?? '',
    }));

    const result: SpotifyAlbumDetail = {
      id: album.id,
      title: album.name,
      artist: album.artists?.map((a: any) => a.name).join(', ') ?? 'Unknown artist',
      artistId: album.artists?.[0]?.id ?? null,
      artists: (album.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
      date: album.release_date ?? null,
      releaseType: albumTypeMap[album.album_type] === 'Single' && (album.total_tracks ?? 0) >= 4
        ? 'EP'
        : albumTypeMap[album.album_type] ?? 'Album',
      label: album.label ?? null,
      totalTracks: album.total_tracks ?? tracks.length,
      tracks,
      genres,
      coverUrl: album.images?.[0]?.url ?? null,
      spotifyUrl: album.external_urls?.spotify ?? null,
    };
    await cacheSet(cacheKey, result, TTL_ALBUM);
    return result;
  } catch (err) {
    console.error('[spotify] getSpotifyAlbum failed for', id, ':', err);
    return null;
  }
}

// ── Artist detail ─────────────────────────────────────────────────────────────

export interface SpotifyArtistDetail {
  id: string;
  name: string;
  genres: string[];
  followers: number;
  popularity: number;
  coverUrl: string | null;
  spotifyUrl: string | null;
}

export async function getSpotifyArtist(id: string): Promise<SpotifyArtistDetail | null> {
  const cacheKey = `spotify:artist:${id}`;
  const cached = await cacheGet<SpotifyArtistDetail>(cacheKey);
  if (cached) return cached;
  try {
    const a = await spotifyFetch(`/artists/${id}`, 86400);
    const result = {
      id: a.id,
      name: a.name,
      genres: a.genres ?? [],
      followers: a.followers?.total ?? 0,
      popularity: a.popularity ?? 0,
      coverUrl: a.images?.[0]?.url ?? null,
      spotifyUrl: a.external_urls?.spotify ?? null,
    };
    await cacheSet(cacheKey, result, TTL_ARTIST);
    return result;
  } catch {
    return null;
  }
}

export interface ArtistAlbumsPage {
  releases: AlbumRelease[];
  nextCursor: string | null;
}

async function paginateArtistAlbums(startUrl: string, pages = 4): Promise<ArtistAlbumsPage> {
  const items: any[] = [];
  let nextUrl: string | null = startUrl;
  let page = 0;
  while (nextUrl && page < pages) {
    const data = await spotifyFetch(nextUrl, 3600);
    items.push(...(data.items ?? []));
    nextUrl = data.next ?? null;
    page++;
  }
  return {
    releases: items.filter((a: any) => a.album_group !== 'appears_on').map(mapAlbum),
    nextCursor: nextUrl,
  };
}

export async function getSpotifyArtistAlbums(id: string, artistName?: string): Promise<ArtistAlbumsPage> {
  const cacheKey = `spotify:artist-albums:${id}`;
  const cached = await cacheGet<AlbumRelease[]>(cacheKey);
  if (cached) return { releases: cached, nextCursor: null };
  try {
    const result = await paginateArtistAlbums(`/artists/${id}/albums`);
    // Only cache when fully loaded (no cursor); partial pages stay uncached
    if (!result.nextCursor) {
      await cacheSet(cacheKey, result.releases, TTL_ALBUMS);
    }
    return result;
  } catch (err) {
    console.error(`[Spotify] albums endpoint failed for ${id}:`, (err as Error).message);
    // Fallback: search by artist name
    if (artistName) {
      try {
        const allItems: any[] = [];
        for (let offset = 0; offset < 30; offset += 10) {
          const data = await spotifyFetch(
            `/search?q=artist:${encodeURIComponent(artistName)}&type=album&limit=10&offset=${offset}`,
            3600
          );
          const page = data.albums?.items ?? [];
          allItems.push(...page);
          if (page.length < 10) break; // no more results
        }
        const releases = allItems
          .filter((a: any) => a.artists?.some((ar: any) => ar.id === id))
          .map(mapAlbum);
        console.log(`[Spotify] fallback search for "${artistName}" → ${releases.length} releases`);
        await cacheSet(cacheKey, releases, TTL_ALBUMS);
        return { releases, nextCursor: null };
      } catch (err2) {
        console.error(`[Spotify] fallback search also failed:`, (err2 as Error).message);
      }
    }
    return { releases: [], nextCursor: null };
  }
}

export async function fetchMoreArtistAlbums(cursor: string): Promise<ArtistAlbumsPage> {
  // Cursor URLs are stable for a given (artist, offset, limit) tuple, so the
  // same cursor always returns the same page — safe to cache aggressively.
  const cacheKey = `spotify:artist-albums-page:${cursor}`;
  const cached = await cacheGet<ArtistAlbumsPage>(cacheKey);
  if (cached) return cached;
  try {
    const result = await paginateArtistAlbums(cursor);
    await cacheSet(cacheKey, result, TTL_ALBUMS);
    return result;
  } catch {
    return { releases: [], nextCursor: cursor };
  }
}

export async function resolveArtistId(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  const cacheKey = `spotify:artist-id:${key}`;
  const cached = await cacheGet<{ id: string | null }>(cacheKey);
  if (cached) return cached.id;
  try {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent(name)}&type=artist&limit=5`,
      3600
    );
    const items: any[] = data.artists?.items ?? [];
    const exact = items.find((a) => a.name.toLowerCase() === key);
    const match = exact ?? items.sort((a, b) => b.popularity - a.popularity)[0];
    const id = match?.id ?? null;
    await cacheSet(cacheKey, { id }, TTL_ARTIST_ID);
    return id;
  } catch {
    return null;
  }
}

export async function searchAlbumsByArtistId(artistId: string, _artistName: string): Promise<AlbumRelease[]> {
  try {
    const items: any[] = [];
    let url: string | null =
      `/artists/${artistId}/albums?include_groups=album,ep,compilation&limit=50&market=KR`;
    while (url) {
      const data = await spotifyFetch(url, 3600);
      items.push(...(data.items ?? []));
      url = data.next ?? null;
      if (items.length >= 100) break;
    }
    return items.filter((a: any) => a.album_group !== 'appears_on').map(mapAlbum);
  } catch {
    return [];
  }
}

export async function searchAlbumsByArtistName(artistName: string): Promise<AlbumRelease[]> {
  try {
    const allItems: any[] = [];
    for (let offset = 0; offset < 50; offset += 10) {
      const data = await spotifyFetch(
        `/search?q=artist:${encodeURIComponent(artistName)}&type=album&limit=10&offset=${offset}`,
        3600
      );
      const page = data.albums?.items ?? [];
      allItems.push(...page);
      if (page.length < 10) break;
    }
    return allItems.map(mapAlbum);
  } catch {
    return [];
  }
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getSpotifyRecommendations(query: string): Promise<AlbumRelease[]> {
  const cacheKey = `spotify:recs:${query}`;
  const cached = await cacheGet<AlbumRelease[]>(cacheKey);
  if (cached) return cached;
  try {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent(query)}&type=album&limit=10`,
      3600
    );
    const results = (data.albums?.items ?? [])
      .filter((a: any) => a.album_type !== 'compilation' && a.album_type !== 'single')
      .map(mapAlbum);
    await cacheSet(cacheKey, results, TTL_RECS);
    return results;
  } catch (err) {
    console.error(`[Spotify] query="${query}" failed:`, err);
    return [];
  }
}
