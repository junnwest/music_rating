import { createServerClient } from './supabaseServer';
import type { SpotifyAlbumDetail, SpotifyArtist, SpotifyArtistDetail } from './spotify';
import type { AlbumRelease } from '../types';

function escapeIlike(s: string): string {
  return s.replace(/[\\%_,]/g, (m) => '\\' + m);
}

export async function saveBasicReleases(albums: AlbumRelease[]): Promise<void> {
  const supabase = createServerClient();
  if (!supabase || albums.length === 0) return;
  await supabase.from('releases').upsert(
    albums.map(a => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
      cover_url: a.coverUrl,
      release_type: a.releaseType,
      release_date: a.date,
    })),
    { onConflict: 'id', ignoreDuplicates: true }
  );
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

  const { data } = await supabase
    .from('releases')
    .select('id, title, artist, artist_id, artists_json, release_date, release_type, label, total_tracks, tracklist, genres, cover_url, spotify_url')
    .eq('id', id)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
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

  const { data } = await supabase
    .from('releases')
    .select('id, title, artist, artist_id, artists_json, release_date, release_type, label, total_tracks, tracklist, genres, cover_url, spotify_url, cached_at')
    .eq('id', id)
    .not('tracklist', 'is', null)
    .maybeSingle();

  if (!data || isStale(data.cached_at, ALBUM_TTL_DAYS)) return null;

  return {
    id: data.id,
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

export async function cacheAlbum(album: SpotifyAlbumDetail): Promise<void> {
  const supabase = createServerClient();
  if (!supabase) return;

  await supabase.from('releases').upsert(
    {
      id: album.id,
      title: album.title,
      artist: album.artist,
      artist_id: album.artistId,
      artists_json: album.artists,
      release_date: album.date,
      release_type: album.releaseType,
      label: album.label,
      total_tracks: album.totalTracks,
      tracklist: album.tracks,
      genres: album.genres.join(','),
      cover_url: album.coverUrl,
      spotify_url: album.spotifyUrl,
      cached_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

export async function searchReleasesInDb(query: string, limit = 10): Promise<AlbumRelease[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const q = escapeIlike(query.trim());
  if (!q) return [];
  const pattern = `%${q}%`;
  const { data } = await supabase
    .from('releases')
    .select('id, title, artist, title_native, artist_native, release_date, release_type, cover_url')
    .or(`title.ilike.${pattern},artist.ilike.${pattern},title_native.ilike.${pattern},artist_native.ilike.${pattern}`)
    .limit(limit);
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    titleNative: r.title_native ?? null,
    artistNative: r.artist_native ?? null,
    date: r.release_date ?? null,
    country: null,
    releaseType: (r.release_type ?? 'Album') as AlbumRelease['releaseType'],
    coverUrl: r.cover_url ?? null,
  }));
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
    .or(`name.ilike.${pattern},name_ko.ilike.${pattern}`)
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

export async function getArtistReleases(artistId: string): Promise<AlbumRelease[]> {
  const supabase = createServerClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from('releases')
    .select('id, title, artist, release_date, release_type, cover_url')
    .eq('artist_id', artistId)
    .order('release_date', { ascending: false });

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

export async function searchReleases(query: string, year: string | null): Promise<AlbumRelease[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  // Strip characters that break PostgREST's or() filter parser
  const safe = query.replace(/[%_,()]/g, ' ').trim();
  try {
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, title_native, artist_native, release_date, release_type, cover_url')
      .or(`title.ilike.%${safe}%,artist.ilike.%${safe}%,title_native.ilike.%${safe}%,artist_native.ilike.%${safe}%`)
      .not('release_type', 'ilike', 'single')
      .order('release_date', { ascending: false })
      .limit(15);
    if (!data) return [];
    const rows = year ? data.filter(r => (r.release_date ?? '').startsWith(year)) : data;
    return rows.slice(0, 10).map(r => ({
      id:          r.id,
      title:       r.title,
      artist:      r.artist,
      titleNative: r.title_native ?? null,
      artistNative: r.artist_native ?? null,
      date:        r.release_date ?? null,
      country:     null,
      releaseType: (r.release_type ?? 'Album') as AlbumRelease['releaseType'],
      coverUrl:    r.cover_url ?? null,
    }));
  } catch {
    return [];
  }
}

// ── Artist ────────────────────────────────────────────────────────────────────

export async function getCachedArtist(id: string): Promise<SpotifyArtistDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from('artists')
    .select('*')
    .eq('id', id)
    .maybeSingle();

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
