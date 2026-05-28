import type { AlbumRelease, ReleaseType } from '../types';
import type { SpotifyArtist } from './spotify';

const ITUNES_BASE = 'https://itunes.apple.com';

function itunesReleaseType(trackCount: number): ReleaseType {
  if (trackCount <= 3) return 'Single';
  if (trackCount <= 6) return 'EP';
  return 'Album';
}

function itunesArtwork(url: string | undefined): string | null {
  if (!url) return null;
  // iTunes returns 100x100 by default; bump to 600x600
  return url.replace('100x100bb', '600x600bb');
}

function mapItunesAlbum(item: any): AlbumRelease {
  return {
    id:          String(item.collectionId),
    itunesId:    item.collectionId as number,
    title:       item.collectionName ?? 'Unknown album',
    artist:      item.artistName ?? 'Unknown artist',
    date:        item.releaseDate ? item.releaseDate.slice(0, 10) : null,
    country:     null,
    releaseType: itunesReleaseType(item.trackCount ?? 0),
    coverUrl:    itunesArtwork(item.artworkUrl100),
  };
}

export async function searchItunesAlbums(query: string, limit = 10): Promise<AlbumRelease[]> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=album&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku/1.0' } });
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.wrapperType === 'collection')
    .map(mapItunesAlbum);
}

export async function searchItunesArtists(query: string, limit = 10): Promise<SpotifyArtist[]> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku/1.0' } });
  if (!res.ok) throw new Error(`iTunes artist search failed: ${res.status}`);
  const data = await res.json();
  return (data.results ?? [])
    .filter((r: any) => r.wrapperType === 'artist')
    .map((r: any): SpotifyArtist => ({
      id:         String(r.artistId),
      name:       r.artistName ?? 'Unknown artist',
      genres:     [],
      popularity: 0,
      coverUrl:   null,
    }));
}
