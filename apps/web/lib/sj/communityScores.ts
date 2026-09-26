import { supabase } from '../supabaseClient';

/**
 * Every score for a set of albums/songs, with no user ids attached
 * (get_album_community_scores / get_song_community_scores, migration
 * 20260926000000_private_accounts). Reading `ratings` directly only returns
 * rows the viewer may see, which would leave private accounts out of
 * community averages; these keep them in, anonymously.
 */
export async function albumCommunityScores(
  releaseGroupIds: string[],
): Promise<{ release_group_id: string; score: number | null }[]> {
  if (!supabase || releaseGroupIds.length === 0) return [];
  const { data } = await supabase.rpc('get_album_community_scores', {
    p_release_group_ids: releaseGroupIds,
  });
  return ((data as { release_group_id: string; score: number | string | null }[] | null) ?? []).map(
    (r) => ({ release_group_id: r.release_group_id, score: r.score == null ? null : Number(r.score) }),
  );
}

export async function songCommunityScores(
  recordingIds: string[],
): Promise<{ recording_id: string; score: number | null }[]> {
  if (!supabase || recordingIds.length === 0) return [];
  const { data } = await supabase.rpc('get_song_community_scores', { p_recording_ids: recordingIds });
  return ((data as { recording_id: string; score: number | string | null }[] | null) ?? []).map((r) => ({
    recording_id: r.recording_id,
    score: r.score == null ? null : Number(r.score),
  }));
}
