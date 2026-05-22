import type { AlbumRelease } from '../types';

const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2/release';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_HEADERS = { 'User-Agent': 'BsideApp/0.1 (music-rating app)' };

export interface ArtistResult {
  id: string;
  name: string;
  type: string | null;
  country: string | null;
  disambiguation: string | null;
}

export interface RecordingResult {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  firstReleaseTitle: string | null;
  firstReleaseId: string | null;
}

export async function fetchMusicBrainzArtists(query: string, limit = 10): Promise<ArtistResult[]> {
  const url = `${MB_BASE}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  const res = await fetch(url, { headers: MB_HEADERS });
  if (!res.ok) throw new Error('Failed to fetch artists');
  const data = await res.json();
  return (data.artists ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    type: a.type ?? null,
    country: a.country ?? null,
    disambiguation: a.disambiguation ?? null,
  }));
}

export async function fetchMusicBrainzRecordings(query: string, limit = 10): Promise<RecordingResult[]> {
  const url = `${MB_BASE}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}&inc=artist-credits+releases`;
  const res = await fetch(url, { headers: MB_HEADERS });
  if (!res.ok) throw new Error('Failed to fetch recordings');
  const data = await res.json();
  return (data.recordings ?? []).map((r: any) => {
    const firstRelease = r.releases?.[0] ?? null;
    return {
      id: r.id,
      title: r.title,
      artist: r['artist-credit']?.map((a: any) => a.name).filter(Boolean).join(', ') ?? 'Unknown artist',
      durationMs: r.length ?? null,
      firstReleaseTitle: firstRelease?.title ?? null,
      firstReleaseId: firstRelease?.id ?? null,
    };
  });
}

const releaseTypeMap: Record<string, AlbumRelease['releaseType']> = {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  live: 'Live',
  compilation: 'Compilation'
};

export async function fetchMusicBrainzReleases(query: string, limit = 10): Promise<AlbumRelease[]> {
  const url = `${MUSICBRAINZ_BASE}/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}&inc=artist-credits+release-groups`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BsideApp/0.1 (music-rating app)' }
  });

  if (!response.ok) throw new Error('Failed to fetch MusicBrainz');

  const data = await response.json();

  return (data.releases ?? []).map((item: any) => ({
    id: item.id,
    title: item.title,
    artist: item['artist-credit']?.map((a: any) => a.name).filter(Boolean).join(', ') ?? 'Unknown artist',
    date: item.date ?? null,
    country: item.country ?? null,
    releaseType: releaseTypeMap[item['release-group']?.['primary-type']?.toLowerCase()] ?? 'Album'
  }));
}

export interface ReleaseDetail {
  id: string;
  title: string;
  artist: string;
  date: string | null;
  country: string | null;
  releaseType: string;
  labels: { name: string; catalogNumber: string | null }[];
  formats: string[];
  trackCount: number;
  tracks: { position: number; title: string; durationMs: number | null }[];
  genres: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  annotation: string | null;
  coverUrl: string | null;
}

export async function fetchMusicBrainzRelease(mbid: string): Promise<ReleaseDetail | null> {
  const url = `${MUSICBRAINZ_BASE}/${mbid}?fmt=json&inc=artist-credits+labels+recordings+release-groups+genres+tags+annotation`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BsideApp/0.1 (music-rating app)' },
    next: { revalidate: 86400 }
  });

  if (!response.ok) return null;

  const d = await response.json();

  const allTracks: ReleaseDetail['tracks'] = [];
  const formats: string[] = [];

  for (const medium of d.media ?? []) {
    if (medium.format) formats.push(medium.format);
    for (const track of medium.tracks ?? []) {
      allTracks.push({
        position: track.position,
        title: track.title ?? track.recording?.title ?? 'Unknown',
        durationMs: track.length ?? track.recording?.length ?? null,
      });
    }
  }

  const labels = (d['label-info'] ?? []).map((li: any) => ({
    name: li.label?.name ?? 'Unknown label',
    catalogNumber: li['catalog-number'] ?? null,
  }));

  const genres = (d.genres ?? [])
    .sort((a: any, b: any) => b.count - a.count)
    .map((g: any) => ({ name: g.name, count: g.count }));

  const genreNames = new Set(genres.map((g: any) => g.name));

  const tags = (d.tags ?? [])
    .sort((a: any, b: any) => b.count - a.count)
    .filter((t: any) => !genreNames.has(t.name))
    .slice(0, 8)
    .map((t: any) => ({ name: t.name, count: t.count }));

  return {
    id: d.id,
    title: d.title,
    artist: d['artist-credit']?.map((a: any) => a.name).filter(Boolean).join(', ') ?? 'Unknown artist',
    date: d.date ?? null,
    country: d.country ?? null,
    releaseType: releaseTypeMap[d['release-group']?.['primary-type']?.toLowerCase()] ?? 'Album',
    labels,
    formats: [...new Set(formats)],
    trackCount: allTracks.length,
    tracks: allTracks,
    genres,
    tags,
    annotation: d.annotation ?? null,
    coverUrl: null, // populated by the page after fetching Cover Art Archive
  };
}
