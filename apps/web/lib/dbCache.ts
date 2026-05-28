import { createServerClient } from './supabaseServer';
import type { SpotifyAlbumDetail, SpotifyArtist, SpotifyArtistDetail } from './spotify';
import type { AlbumRelease } from '../types';

function escapeIlike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => '\\' + m);
}

export function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function isItunesId(s: string): boolean {
  return /^\d+$/.test(s);
}

// Look up a release by UUID, Spotify ID, or iTunes collection ID string.
async function releaseByAnyId(
  supabase: ReturnType<typeof createServerClient>,
  id: string,
  select: string,
): Promise<{ data: any }> {
  const q = (supabase as any).from('releases').select(select);
  if (isUUID(id)) return q.eq('id', id).maybeSingle();
  if (isItunesId(id)) return q.eq('itunes_id', parseInt(id, 10)).maybeSingle();
  return q.eq('spotify_id', id).maybeSingle();
}

export async function saveBasicReleases(albums: AlbumRelease[]): Promise<void> {
  const supabase = createServerClient();
  if (!supabase || albums.length === 0) return;
  const rows = albums
    .filter(a => a.spotifyId)
    .map(a => ({
      spotify_id:        a.spotifyId,
      title:             a.title,
      artist:            a.artist,
      cover_url:         a.coverUrl,
      release_type:      a.releaseType,
      release_date:      a.date,
      canonical_source:  'spotify',
    }));
  if (rows.length === 0) return;
  await supabase.from('releases').upsert(rows, { onConflict: 'spotify_id', ignoreDuplicates: true });
}

export async function saveItunesReleases(albums: AlbumRelease[]): Promise<void> {
  const supabase = createServerClient();
  if (!supabase || albums.length === 0) return;
  const rows = albums
    .filter(a => a.itunesId != null)
    .map(a => ({
      itunes_id:         a.itunesId,
      title:             a.title,
      artist:            a.artist,
      cover_url:         a.coverUrl,
      release_type:      a.releaseType,
      release_date:      a.date,
      canonical_source:  'itunes',
    }));
  if (rows.length === 0) return;
  await supabase.from('releases').upsert(rows, { onConflict: 'itunes_id', ignoreDuplicates: true });
}

const ALBUM_TTL_DAYS = 30;
const ARTIST_TTL_DAYS = 7;

function isStale(cachedAt: string | null, ttlDays: number): boolean {
  if (!cachedAt) return true;
  return Date.now() - new Date(cachedAt).getTime() > ttlDays * 86400 * 1000;
}

// ── Album ─────────────────────────────────────────────────────────────────────

export async function getBasicRelease(id: string): Promise<SpotifyAlbumDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const { data } = await releaseByAnyId(
    supabase,
    id,
    'id, spotify_id, title, artist, artist_id, artists_json, release_date, release_type, label, total_tracks, tracklist, genres, cover_url, spotify_url',
  );

  if (!data) return null;

  return {
    id: data.id,
    spotifyId: data.spotify_id ?? null,
    title: data.title,
    artist: data.artist,
    artistId: data.artist_id ?? null,
    artists: data.artists_json ?? (data.artist_id ? [{ id: data.artist_id, name: data.artist }] : []),
    date: data.release_date ?? null,
    releaseType: data.release_type ?? 'Album',
    label: data.label ?? null,
    totalTracks: data.total_tracks ?? 0,
    tracks: data.tracklist ?? [],
    genres: data.genres ? data.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
    coverUrl: data.cover_url ?? null,
    spotifyUrl: data.spotify_url ?? null,
  };
}

export async function getCachedAlbum(id: string): Promise<SpotifyAlbumDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const { data } = await releaseByAnyId(
    supabase,
    id,
    'id, spotify_id, title, artist, artist_id, artists_json, release_date, release_type, label, total_tracks, tracklist, genres, cover_url, spotify_url, cached_at',
  );

  if (!data || !data.tracklist || isStale(data.cached_at, ALBUM_TTL_DAYS)) return null;

  return {
    id: data.id,
    spotifyId: data.spotify_id ?? null,
    title: data.title,
    artist: data.artist,
    artistId: data.artist_id ?? null,
    artists: data.artists_json ?? (data.artist_id ? [{ id: data.artist_id, name: data.artist }] : []),
    date: data.release_date ?? null,
    releaseType: data.release_type ?? 'Album',
    label: data.label ?? null,
    totalTracks: data.total_tracks ?? 0,
    tracks: data.tracklist ?? [],
    genres: data.genres ? data.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
    coverUrl: data.cover_url ?? null,
    spotifyUrl: data.spotify_url ?? null,
  };
}

export async function cacheAlbum(album: SpotifyAlbumDetail): Promise<string | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const spotifyId = album.spotifyId ?? album.id;
  const { data } = await supabase.from('releases').upsert(
    {
      spotify_id:      spotifyId,
      title:           album.title,
      artist:          album.artist,
      artist_id:       album.artistId,
      artists_json:    album.artists,
      release_date:    album.date,
      release_type:    album.releaseType,
      label:           album.label,
      total_tracks:    album.totalTracks,
      tracklist:       album.tracks,
      genres:          album.genres.join(','),
      cover_url:       album.coverUrl,
      spotify_url:     album.spotifyUrl,
      canonical_source: 'spotify',
      cached_at:       new Date().toISOString(),
    },
    { onConflict: 'spotify_id' }
  ).select('id').single();

  return data?.id ?? null;
}

export async function searchReleasesInDb(query: string, limit = 10): Promise<AlbumRelease[]> {
  return searchReleases(query, null, limit);
}

export async function searchArtistsInDb(query: string, limit = 10): Promise<SpotifyArtist[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const q = escapeIlike(query.trim());
  if (!q) return [];
  const pattern = `%${q}%`;
  const { data } = await supabase
    .from('artists')
    .select('id, name, genres, popularity, cover_url')
    .or(`name.ilike.${pattern},name_native.ilike.${pattern}`)
    .order('popularity', { ascending: false })
    .limit(limit);
  if (!data) return [];
  return data.map((a) => ({
    id: a.id,
    name: a.name,
    genres: a.genres ? a.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
    popularity: a.popularity ?? 0,
    coverUrl: a.cover_url ?? null,
  }));
}

export async function getArtistReleases(artistId: string, artistName?: string): Promise<AlbumRelease[]> {
  const supabase = createServerClient();
  if (!supabase) return [];

  let { data } = await supabase
    .from('releases')
    .select('id, title, artist, release_date, release_type, cover_url')
    .eq('artist_id', artistId)
    .not('release_type', 'ilike', 'single')
    .order('release_date', { ascending: false });

  // Fallback: search by artist name when ID is numeric (iTunes ID) or yielded no results
  if ((!data || data.length === 0) && artistName) {
    const { data: byName } = await supabase
      .from('releases')
      .select('id, title, artist, release_date, release_type, cover_url')
      .ilike('artist', artistName)
      .not('release_type', 'ilike', 'single')
      .order('release_date', { ascending: false });
    data = byName;
  }

  if (!data) return [];

  return data.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    date: r.release_date ?? null,
    country: null,
    releaseType: (r.release_type ?? 'Album') as AlbumRelease['releaseType'],
    coverUrl: r.cover_url ?? null,
  }));
}

// ── Search ────────────────────────────────────────────────────────────────────

// Embeds a search query using Jina v3 (retrieval.query task).
// Returns null if JINA_API_KEY is unset or the request fails — search degrades
// gracefully to pure lexical scoring in that case.
async function embedQuery(query: string): Promise<number[] | null> {
  const key = process.env.JINA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model:      'jina-embeddings-v3',
        task:       'retrieval.query',
        dimensions: 1024,
        input:      [query],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data as { index: number; embedding: number[] }[])?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// Hybrid search: lexical (trigram + full-text + popularity) combined with
// semantic cosine similarity when a Jina embedding is available.
// Falls back to pure lexical if JINA_API_KEY is unset or the API call fails.
export async function searchReleases(
  query: string,
  year: string | null,
  limit = 15,
): Promise<AlbumRelease[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const q = query.trim();
  if (!q) return [];
  try {
    const embedding = await embedQuery(q);
    const { data } = await (supabase as any).rpc('search_releases', {
      q,
      yr:              year ?? null,
      lim:             limit,
      query_embedding: embedding,
    });
    if (!data) return [];
    return (data as any[]).map((r) => ({
      id:          r.id,
      title:       r.title,
      artist:      r.artist,
      titleNative: r.title_native  ?? null,
      artistNative: r.artist_native ?? null,
      date:        r.release_date  ?? null,
      country:     null,
      releaseType: (r.release_type ?? 'Album') as AlbumRelease['releaseType'],
      coverUrl:    r.cover_url     ?? null,
    }));
  } catch {
    return [];
  }
}

// ── Artist ────────────────────────────────────────────────────────────────────

export async function getCachedArtist(id: string): Promise<SpotifyArtistDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  // Try by Spotify ID first; fall back to iTunes artist ID for numeric IDs
  const isNumeric = /^\d+$/.test(id);
  const query = isNumeric
    ? supabase.from('artists').select('*').eq('itunes_artist_id', parseInt(id, 10)).maybeSingle()
    : supabase.from('artists').select('*').eq('id', id).maybeSingle();
  const { data } = await query;

  if (!data || isStale(data.cached_at, ARTIST_TTL_DAYS)) return null;

  return {
    id: data.id,
    name: data.name,
    genres: data.genres ? data.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
    followers: data.followers ?? 0,
    popularity: data.popularity ?? 0,
    coverUrl: data.cover_url ?? null,
    spotifyUrl: data.spotify_url ?? null,
  };
}

export async function getArtistFromDb(id: string): Promise<SpotifyArtistDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const isNumeric = /^\d+$/.test(id);
  const query = isNumeric
    ? supabase.from('artists').select('*').eq('itunes_artist_id', parseInt(id, 10)).maybeSingle()
    : supabase.from('artists').select('*').eq('id', id).maybeSingle();
  const { data } = await query;

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    genres: data.genres ? data.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
    followers: data.followers ?? 0,
    popularity: data.popularity ?? 0,
    coverUrl: data.cover_url ?? null,
    spotifyUrl: data.spotify_url ?? null,
  };
}

export async function cacheArtist(artist: SpotifyArtistDetail): Promise<void> {
  const supabase = createServerClient();
  if (!supabase) return;

  await supabase.from('artists').upsert(
    {
      id: artist.id,
      name: artist.name,
      genres: artist.genres.join(','),
      followers: artist.followers,
      popularity: artist.popularity,
      cover_url: artist.coverUrl,
      spotify_url: artist.spotifyUrl,
      cached_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}
