// Server-side reads of public catalog data, so album/artist pages can send their real content in
// the first HTML instead of an empty shell (2026-11-12: crawlers saw "community avg 0 · 0 ratings"
// and a dash for the artist name, because everything loaded in the browser afterwards).
//
// Plain fetch() against PostgREST with the anon key rather than lib/supabaseClient: that client
// is the browser one (persisted session), and its requests don't go through Next's Data Cache.
// Every read here is cached for an hour, so crawler traffic costs one Supabase round-trip per
// page per hour, not one per visit (the Vercel CPU concern in app/robots.ts). The client page
// still refetches after hydration, so signed-in users see live numbers.
import type { ReleaseGroupCreditRPC } from '../db/types';
import type { SJRelease } from './data';
import type { TrackEntry, TrackStats } from './tracks';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REVALIDATE = 3600;

const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

async function rest<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, next: { revalidate: REVALIDATE } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The album page's release_groups row: same columns as its client query. */
export interface AlbumRow {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
  native_title: string | null;
  genres: string[] | null;
  title_language: string | null;
  artists: { name_native: string | null; country: string | null; native_language: string | null } | null;
}

export const ALBUM_ROW_SELECT =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, genres, title_language, artists!release_groups_primary_artist_id_fkey(name_native, country, native_language)';

export interface AlbumInitial {
  row: AlbumRow;
  credits: ReleaseGroupCreditRPC[];
  tracks: TrackEntry[];
  trackStats: Record<string, TrackStats>;
  /** Every community score (get_album_community_scores, private accounts included). */
  scores: number[];
}

export interface CommunityStats {
  count: number;
  avg: number | null;
  /** Population SD; null below 3 scores. */
  sd: number | null;
  /** Ten 0.5-wide buckets (0.5 … 5.0). */
  dist: number[];
}

/** One formula for the page, its server render and its JSON-LD, so they always agree. */
export function communityStats(scores: number[]): CommunityStats {
  const dist = new Array(10).fill(0) as number[];
  for (const s of scores) dist[Math.min(Math.max(Math.round(s * 2) - 1, 0), 9)] += 1;
  if (scores.length === 0) return { count: 0, avg: null, sd: null, dist };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd =
    scores.length >= 3
      ? Math.sqrt(scores.reduce((a, b) => a + (b - avg) * (b - avg), 0) / scores.length)
      : null;
  return { count: scores.length, avg, sd, dist };
}

export async function albumCommunityScoresServer(releaseGroupId: string): Promise<number[]> {
  const rows = await rpc<{ score: number | string | null }[]>('get_album_community_scores', {
    p_release_group_ids: [releaseGroupId],
  });
  return (rows ?? []).map((r) => (r.score == null ? null : Number(r.score))).filter((s): s is number => s != null);
}

async function albumTracksServer(releaseGroupId: string): Promise<TrackEntry[]> {
  const canonical = await rest<{ id: string }[]>(
    `releases?release_group_id=eq.${releaseGroupId}&is_canonical=eq.true&select=id&limit=1`,
  );
  const canonicalId = canonical?.[0]?.id;
  if (!canonicalId) return [];
  const rows = await rest<any[]>(
    `release_tracks?release_id=eq.${canonicalId}&select=position,disc_number,recordings(id,title,duration_ms,artist_display)&order=disc_number.asc,position.asc`,
  );
  return (rows ?? [])
    .filter((r) => r.recordings)
    .map((r) => ({
      recordingId: r.recordings.id,
      discNumber: r.disc_number ?? 1,
      position: r.position,
      title: r.recordings.title,
      durationMs: r.recordings.duration_ms,
      artists: r.recordings.artist_display,
    }));
}

/** Same bucketing as lib/sj/tracks.ts loadTrackStats. */
async function trackStatsServer(recordingIds: string[]): Promise<Record<string, TrackStats>> {
  if (recordingIds.length === 0) return {};
  const rows = await rpc<{ recording_id: string; score: number | string | null }[]>('get_song_community_scores', {
    p_recording_ids: recordingIds,
  });
  const acc: Record<string, { n: number; sum: number; dist: number[] }> = {};
  for (const r of rows ?? []) {
    if (r.score == null) continue;
    const score = Number(r.score);
    const a = (acc[r.recording_id] ??= { n: 0, sum: 0, dist: new Array(10).fill(0) });
    a.n += 1;
    a.sum += score;
    a.dist[Math.min(Math.max(Math.round(score * 2) - 1, 0), 9)] += 1;
  }
  const out: Record<string, TrackStats> = {};
  for (const [id, a] of Object.entries(acc)) out[id] = { count: a.n, avg: a.sum / a.n, dist: a.dist };
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything public the album page shows above the fold. null = not found (or a fetch failed). */
export async function loadAlbumInitial(releaseGroupId: string): Promise<AlbumInitial | null> {
  if (!UUID_RE.test(releaseGroupId)) return null;
  const [rows, credits, tracks, scores] = await Promise.all([
    rest<AlbumRow[]>(`release_groups?id=eq.${releaseGroupId}&select=${encodeURIComponent(ALBUM_ROW_SELECT)}`),
    rpc<ReleaseGroupCreditRPC[]>('get_release_group_credits', { p_release_group_id: releaseGroupId }),
    albumTracksServer(releaseGroupId),
    albumCommunityScoresServer(releaseGroupId),
  ]);
  const row = rows?.[0];
  if (!row) return null;
  const trackStats = await trackStatsServer(tracks.map((t) => t.recordingId));
  return { row, credits: credits ?? [], tracks, trackStats, scores };
}

export interface ArtistInitial {
  name: string;
  avatarUrl: string | null;
  /** get_artist_release_groups, as the page's own SJRelease rows. */
  releases: SJRelease[];
  /** Every community score across those releases (get_album_community_scores). */
  scores: { release_group_id: string; score: number | null }[];
}

/** The artist page's header, stats row and discography. uuid ids only; null = not found / failed. */
export async function loadArtistInitial(artistId: string): Promise<ArtistInitial | null> {
  if (!UUID_RE.test(artistId)) return null;
  const [artistRows, rgs] = await Promise.all([
    rest<{ name: string; cover_url: string | null }[]>(`artists?id=eq.${artistId}&select=name,cover_url&limit=1`),
    // lim 500: see the matching comment in the artist page's client query.
    rpc<any[]>('get_artist_release_groups', { p_artist_id: artistId, lim: 500 }),
  ]);
  const artist = artistRows?.[0];
  if (!artist || rgs == null) return null;
  const releases = rgs.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist_display,
    coverUrl: r.cover_url,
    releaseType: r.release_group_type,
    releaseDate: r.first_release_date,
    titleNative: r.native_title,
    artistNative: null,
  }));
  const ids = releases.map((r) => r.id);
  const scores =
    ids.length === 0
      ? []
      : ((await rpc<{ release_group_id: string; score: number | string | null }[]>('get_album_community_scores', {
          p_release_group_ids: ids,
        })) ?? []
        ).map((r) => ({ release_group_id: r.release_group_id, score: r.score == null ? null : Number(r.score) }));
  return { name: artist.name, avatarUrl: artist.cover_url, releases, scores };
}
