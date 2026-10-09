import { supabase } from '../supabaseClient';

/** One track an album post's author rated on that album (canonical tracklist). */
export interface RatedTrack {
  recordingId: string;
  title: string;
  discNumber: number;
  position: number;
  score: number;
}

/**
 * The "Rated N tracks" data behind album posts (`get_post_rated_tracks`,
 * migration 20261006000000). Every card asks for its own (author, album) pair;
 * requests made in the same tick go out as ONE RPC, so a feed page costs one
 * round trip, and answers are cached for the session.
 */
const cache = new Map<string, Promise<RatedTrack[]>>();
let pending: { key: string; userId: string; rgId: string; resolve: (t: RatedTrack[]) => void }[] = [];
let scheduled = false;

const keyOf = (userId: string, rgId: string) => `${userId}:${rgId}`;

async function flush() {
  scheduled = false;
  const batch = pending;
  pending = [];
  const out = new Map<string, RatedTrack[]>();
  if (supabase) {
    const { data, error } = await supabase.rpc('get_post_rated_tracks', {
      p_user_ids: batch.map((b) => b.userId),
      p_release_group_ids: batch.map((b) => b.rgId),
    });
    if (error) console.error('[postRatedTracks] failed:', error.message);
    for (const r of (data as any[] | null) ?? []) {
      const k = keyOf(r.user_id, r.release_group_id);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push({
        recordingId: r.recording_id,
        title: r.title,
        discNumber: r.disc_number,
        position: r.track_position,
        score: Number(r.score),
      });
    }
    // A failed batch isn't cached as "none rated" -- the next mount retries.
    if (error) for (const b of batch) cache.delete(b.key);
  }
  for (const b of batch) b.resolve(out.get(b.key) ?? []);
}

export function loadPostRatedTracks(userId: string, releaseGroupId: string): Promise<RatedTrack[]> {
  const key = keyOf(userId, releaseGroupId);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Promise<RatedTrack[]>((resolve) => {
    pending.push({ key, userId, rgId: releaseGroupId, resolve });
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
  cache.set(key, p);
  return p;
}

/** Drop a user's cached answers -- after they rate or unrate a track. */
export function invalidatePostRatedTracks(userId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}
