import type { AlbumRelease, ReleaseType } from '../types';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

// Server-side in-memory token cache
let cachedToken: { value: string; expiresAt: number } | null = null;

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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: revalidate !== undefined ? { revalidate } : undefined,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify ${res.status}: ${path} — ${body}`);
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
    `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}&market=KR`
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
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&market=KR`
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

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getSpotifyRecommendations(query: string, limit = 10): Promise<AlbumRelease[]> {
  try {
    const data = await spotifyFetch(
      `/search?q=${encodeURIComponent(query)}&type=album&limit=${limit}&market=KR`,
      3600
    );
    const results = (data.albums?.items ?? [])
      .filter((a: any) => a.album_type !== 'compilation')
      .map(mapAlbum);
    console.log(`[Spotify] query="${query}" → ${results.length} albums`);
    return results;
  } catch (err) {
    console.error(`[Spotify] query="${query}" failed:`, err);
    return [];
  }
}
