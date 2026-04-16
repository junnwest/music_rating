import type { AlbumRelease } from '../types';

const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2/release';

const releaseTypeMap: Record<string, AlbumRelease['releaseType']> = {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  live: 'Live',
  compilation: 'Compilation'
};

export async function fetchMusicBrainzReleases(query: string): Promise<AlbumRelease[]> {
  const url = `${MUSICBRAINZ_BASE}/?query=${encodeURIComponent(query)}&fmt=json&limit=10&inc=artist-credits+release-groups`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BsideApp/0.1 (music-rating app)'
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch MusicBrainz');
  }

  const data = await response.json();

  return (data.releases ?? []).map((item: any) => ({
    id: item.id,
    title: item.title,
    artist: item['artist-credit']?.map((artist: any) => artist.name).filter(Boolean).join(', ') ?? 'Unknown artist',
    date: item.date ?? null,
    country: item.country ?? null,
    releaseType: releaseTypeMap[item['release-group']?.['primary-type']?.toLowerCase()] ?? 'Album'
  }));
}
