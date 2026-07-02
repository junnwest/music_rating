/**
 * Deezer Search API client (open, no auth) for the MB-miss fallback (mb-deezer-fallback.ts).
 *
 * Why Deezer for the fallback: it exposes **ISRC** (per `/track/{id}`), so fallback recordings
 * can auto-link to MusicBrainz later if MB ever adds the artist — unlike iTunes (no ISRC).
 * And collaborators come back as text `contributors`, NOT separate entities, so ingesting an
 * artist can't spawn shadow artist rows (the job-C failure mode).
 *
 * Rate limit ~50 req / 5 s per IP → a polite ~200ms spacing keeps us well under.
 */

const BASE = 'https://api.deezer.com';
const DELAY_MS = 220;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function dz(path: string, attempt = 0): Promise<any> {
  await sleep(DELAY_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': 'sillajuku/1.0 ( admin@sillajuku.com )' } });
    if (res.status === 429) { // Deezer quota hit → brief backoff
      if (attempt < 3) { await sleep(2000 * (attempt + 1)); return dz(path, attempt + 1); }
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) { // Deezer returns 200 with an {error} body on quota/limit
      if (data.error.code === 4 && attempt < 3) { await sleep(2000 * (attempt + 1)); return dz(path, attempt + 1); }
      return null;
    }
    return data;
  } catch { return null; }
}

export interface DzArtist { id: number; name: string; nbFan: number; nbAlbum: number; picture: string | null }
export interface DzAlbum { id: number; title: string; recordType: string; releaseDate: string | null; cover: string | null; nbTracks: number }
export interface DzTrack { position: number; discNumber: number; title: string; durationMs: number | null; artists: string; isrc: string | null }
export interface DzAlbumDetail { title: string; recordType: string; releaseDate: string | null; cover: string | null; genre: string | null; label: string | null; tracks: DzTrack[] }

const enc = (s: string) => encodeURIComponent(s);

/** Artist candidates for a name, ordered by Deezer relevance (most fans ≈ most likely). */
export async function searchArtists(name: string, limit = 5): Promise<DzArtist[]> {
  const data = await dz(`/search/artist?q=${enc(name)}&limit=${limit}`);
  return (data?.data ?? []).map((a: any): DzArtist => ({
    id: a.id, name: a.name, nbFan: a.nb_fan ?? 0, nbAlbum: a.nb_album ?? 0, picture: a.picture_xl || a.picture_big || null,
  }));
}

export interface DzAlbumHit { id: number; title: string; cover: string | null; artist: string }
/** Album search by artist + title (for the cover backfill). cover is the largest available. */
export async function searchAlbums(artist: string, title: string, limit = 5): Promise<DzAlbumHit[]> {
  const data = await dz(`/search/album?q=${enc(`artist:"${artist}" album:"${title}"`)}&limit=${limit}`);
  return (data?.data ?? []).map((a: any): DzAlbumHit => ({
    id: a.id, title: a.title, cover: a.cover_xl || a.cover_big || a.cover_medium || null, artist: a.artist?.name ?? '',
  }));
}

/** The artist's own albums (Deezer's /artist/{id}/albums is already scoped to them). */
export async function artistAlbums(artistId: number, limit = 100): Promise<DzAlbum[]> {
  const data = await dz(`/artist/${artistId}/albums?limit=${limit}`);
  return (data?.data ?? []).map((x: any): DzAlbum => ({
    id: x.id, title: x.title, recordType: (x.record_type ?? 'album').toLowerCase(),
    releaseDate: x.release_date || null, cover: x.cover_xl || x.cover_big || null, nbTracks: x.nb_tracks ?? 0,
  }));
}

/**
 * Full album with tracks. ISRC lives only on /track/{id}, so when `withIsrc` we fetch it per
 * track (the cost of clean identity — kept bounded by the small fallback set). Embedded album
 * tracks have no isrc, so without `withIsrc` the tracks carry isrc=null.
 */
export async function albumWithTracks(albumId: number, withIsrc = true): Promise<DzAlbumDetail | null> {
  const a = await dz(`/album/${albumId}`);
  if (!a) return null;
  const raw: any[] = a.tracks?.data ?? [];
  const tracks: DzTrack[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    let isrc: string | null = null;
    if (withIsrc) { const full = await dz(`/track/${t.id}`); isrc = full?.isrc ?? null; }
    tracks.push({
      position: t.track_position ?? i + 1,
      discNumber: t.disk_number ?? 1,
      title: t.title,
      durationMs: t.duration ? t.duration * 1000 : null,
      artists: t.artist?.name ?? a.artist?.name ?? '',
      isrc,
    });
  }
  return {
    title: a.title,
    recordType: (a.record_type ?? 'album').toLowerCase(),
    releaseDate: a.release_date || null,
    cover: a.cover_xl || a.cover_big || null,
    genre: a.genres?.data?.[0]?.name ?? null,
    label: a.label ?? null,
    tracks,
  };
}
