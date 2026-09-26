import { supabase } from '../supabaseClient';

export interface TrackEntry {
  recordingId: string;
  discNumber: number;
  position: number;
  title: string;
  durationMs: number | null;
  /** The recording's own credit (often "Artist feat. Guest"). */
  artists: string | null;
}

/**
 * The canonical edition's tracklist for an album, disc-then-position ordered.
 * `null` on a query failure; `[]` when there's no canonical edition or no tracks.
 * Shared by the album page, the song page and the Mix Dock.
 */
export async function loadAlbumTracks(releaseGroupId: string): Promise<TrackEntry[] | null> {
  if (!supabase) return null;
  const { data: canonical, error: cErr } = await supabase
    .from('releases')
    .select('id')
    .eq('release_group_id', releaseGroupId)
    .eq('is_canonical', true)
    .limit(1);
  if (cErr) {
    console.error('[tracks] canonical lookup failed:', cErr.message);
    return null;
  }
  const canonicalId = (canonical as { id: string }[] | null)?.[0]?.id;
  if (!canonicalId) return [];
  const { data: rows, error } = await supabase
    .from('release_tracks')
    .select('position, disc_number, recordings(id, title, duration_ms, artist_display)')
    .eq('release_id', canonicalId)
    // Positions restart on every disc, so disc_number has to lead the sort —
    // ordering by position alone interleaves disc 2 into disc 1 and renders
    // as duplicate track numbers.
    .order('disc_number')
    .order('position');
  if (error) {
    console.error('[tracks] tracklist failed:', error.message);
    return null;
  }
  return ((rows as any[] | null) ?? [])
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

/** m:ss (or h:mm:ss for runtimes of an hour or more). */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The user's own scores for a set of recordings. */
export async function loadMyTrackScores(
  userId: string,
  recordingIds: string[],
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  if (!supabase || recordingIds.length === 0) return map;
  const { data, error } = await supabase
    .from('track_ratings')
    .select('recording_id, score')
    .eq('user_id', userId)
    .in('recording_id', recordingIds);
  if (error) {
    console.error('[tracks] my track scores failed:', error.message);
    return map;
  }
  for (const r of (data as { recording_id: string; score: number | null }[] | null) ?? []) {
    if (r.score != null) map[r.recording_id] = r.score;
  }
  return map;
}

export interface TrackStats {
  count: number;
  avg: number | null;
  /** Ten 0.5-wide buckets (0.5 … 5.0). */
  dist: number[];
}

/**
 * Community stats per recording. Missing ids = no ratings.
 *
 * Built from `get_song_community_scores` (anonymous scores, migration
 * 20260926000000_private_accounts / 20260926000002_account_deactivation), not
 * `get_track_rating_stats`: that RPC is SECURITY INVOKER over `track_ratings`,
 * so RLS would drop private accounts from the numbers. Bucketing matches it.
 */
export async function loadTrackStats(
  recordingIds: string[],
): Promise<Record<string, TrackStats> | null> {
  if (!supabase) return null;
  if (recordingIds.length === 0) return {};
  const { data, error } = await supabase.rpc('get_song_community_scores', {
    p_recording_ids: recordingIds,
  });
  if (error) {
    console.error('[tracks] stats failed:', error.message);
    return null;
  }
  const acc: Record<string, { n: number; sum: number; dist: number[] }> = {};
  for (const r of (data as { recording_id: string; score: number | string | null }[] | null) ?? []) {
    if (r.score == null) continue;
    const score = Number(r.score);
    const a = (acc[r.recording_id] ??= { n: 0, sum: 0, dist: new Array(10).fill(0) });
    a.n += 1;
    a.sum += score;
    a.dist[Math.min(Math.max(Math.round(score * 2) - 1, 0), 9)] += 1;
  }
  const out: Record<string, TrackStats> = {};
  for (const [id, a] of Object.entries(acc)) {
    out[id] = { count: a.n, avg: a.sum / a.n, dist: a.dist };
  }
  return out;
}
