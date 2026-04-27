import { createServerClient } from './supabaseServer';
import type { SpotifyAlbumDetail, SpotifyArtistDetail } from './spotify';

const ALBUM_TTL_DAYS = 30;
const ARTIST_TTL_DAYS = 7;

function isStale(cachedAt: string | null, ttlDays: number): boolean {
  if (!cachedAt) return true;
  return Date.now() - new Date(cachedAt).getTime() > ttlDays * 86400 * 1000;
}

// ── Album ─────────────────────────────────────────────────────────────────────

export async function getCachedAlbum(id: string): Promise<SpotifyAlbumDetail | null> {
  const supabase = createServerClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from('releases')
    .select('id, title, artist, artist_id, release_date, release_type, label, total_tracks, tracklist, genres, cover_url, spotify_url, cached_at')
    .eq('id', id)
    .not('tracklist', 'is', null)
    .maybeSingle();

  if (!data || isStale(data.cached_at, ALBUM_TTL_DAYS)) return null;

  return {
    id: data.id,
    title: data.title,
    artist: data.artist,
    artistId: data.artist_id ?? null,
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
