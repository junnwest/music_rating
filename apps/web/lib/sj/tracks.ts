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

/** Community stats per recording (`get_track_rating_stats`). Missing ids = no ratings. */
export async function loadTrackStats(
  recordingIds: string[],
): Promise<Record<string, TrackStats> | null> {
  if (!supabase) return null;
  if (recordingIds.length === 0) return {};
  const { data, error } = await supabase.rpc('get_track_rating_stats', {
    p_recording_ids: recordingIds,
  });
  if (error) {
    console.error('[tracks] stats failed:', error.message);
    return null;
  }
  const out: Record<string, TrackStats> = {};
  for (const r of (data as
    | { recording_id: string; rating_count: number; avg_score: number | null; dist: number[] | null }[]
    | null) ?? []) {
    out[r.recording_id] = {
      count: Number(r.rating_count),
      avg: r.avg_score,
      dist: r.dist ?? new Array(10).fill(0),
    };
  }
  return out;
}
