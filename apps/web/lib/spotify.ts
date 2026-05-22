import type { AlbumRelease, ReleaseType } from '../types';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

// Server-side in-memory token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

// In-memory cache — survives hot reloads, prevents rate limits in dev
const artistCache = new Map<string, { data: any; expiresAt: number }>();
const albumsCache = new Map<string, { data: AlbumRelease[]; expiresAt: number }>();
const recsCache = new Map<string, { data: AlbumRelease[]; expiresAt: number }>();
const artistIdCache = new Map<string, { id: string | null; expiresAt: number }>();
const TTL = 3600 * 1000;

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

async function spotifyFetch(path: string, revalidate?: number): Promise<any> {
  const token = await getToken();
  const url = path.startsWith('https://') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: revalidate !== undefined ? { revalidate } : undefined,
  });
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

export async function searchSpotifyAlbums(query: string, limit = 10): Promise<AlbumRelease[]> {
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}`
  );
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
  try {
    const album = await spotifyFetch(`/albums/${id}?market=KR`, 86400);

    // Spotify album genres are often empty — fall back to primary artist genres
    let genres: string[] = album.genres ?? [];
    if (genres.length === 0 && album.artists?.[0]?.id) {
      try {
        const artist = await spotifyFetch(`/artists/${album.artists[0].id}`, 86400);
        genres = artist.genres ?? [];
      } catch {}
    }

    const tracks = (album.tracks?.items ?? []).map((t: any) => ({
      position: t.track_number,
      title: t.name,
      durationMs: t.duration_ms ?? null,
      artists: t.artists?.map((a: any) => a.name).join(', ') ?? '',
    }));

    return {
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
  } catch {
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
  const hit = artistCache.get(id);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
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
    artistCache.set(id, { data: result, expiresAt: Date.now() + TTL });
    return result;
  } catch {
    return hit?.data ?? null;
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
  const hit = albumsCache.get(id);
  if (hit && Date.now() < hit.expiresAt) return { releases: hit.data, nextCursor: null };
  try {
    const result = await paginateArtistAlbums(`/artists/${id}/albums`);
    // Only cache when fully loaded (no cursor); partial pages stay uncached
    if (!result.nextCursor) {
      albumsCache.set(id, { data: result.releases, expiresAt: Date.now() + TTL });
    }
    return result;
  } catch (err) {
    console.error(`[Spotify] albums endpoint failed for ${id}:`, (err as Error).message);
    if (hit) return { releases: hit.data, nextCursor: null };
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
        albumsCache.set(id, { data: releases, expiresAt: Date.now() + TTL });
        return { releases, nextCursor: null };
      } catch (err2) {
        console.error(`[Spotify] fallback search also failed:`, (err2 as Error).message);
      }
    }
    return { releases: [], nextCursor: null };
  }
}

export async function fetchMoreArtistAlbums(cursor: string): Promise<ArtistAlbumsPage> {
  try {
    return await paginateArtistAlbums(cursor);
  } catch {
    return { releases: [], nextCursor: cursor };
  }
}

export async function resolveArtistId(name: string): Promise<string | null> {
  const key = name.toLowerCase();
  const hit = artistIdCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.id;
  try {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent(name)}&type=artist&limit=5`,
      3600
    );
    const items: any[] = data.artists?.items ?? [];
    const exact = items.find((a) => a.name.toLowerCase() === key);
    const match = exact ?? items.sort((a, b) => b.popularity - a.popularity)[0];
    const id = match?.id ?? null;
    artistIdCache.set(key, { id, expiresAt: Date.now() + TTL });
    return id;
  } catch {
    return null;
  }
}

export async function searchAlbumsByArtistId(artistId: string, _artistName: string): Promise<AlbumRelease[]> {
  try {
    const items: any[] = [];
    let url: string | null =
      `/artists/${artistId}/albums?include_groups=album,single,ep,compilation&limit=50&market=KR`;
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
  const hit = recsCache.get(query);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  try {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent(query)}&type=album&limit=10`,
      3600
    );
    const results = (data.albums?.items ?? [])
      .filter((a: any) => a.album_type !== 'compilation')
      .map(mapAlbum);
    recsCache.set(query, { data: results, expiresAt: Date.now() + TTL });
    return results;
  } catch (err) {
    // Return stale data rather than empty on any error (rate limit, etc.)
    if (hit) return hit.data;
    console.error(`[Spotify] query="${query}" failed:`, err);
    return [];
  }
}
