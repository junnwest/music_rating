import { supabase } from '../supabaseClient';

/** Upsert (or, with `null`, delete) the user's rating for one track. */
export async function saveTrackRating(
  userId: string,
  recordingId: string,
  score: number | null,
): Promise<{ error: { message: string } | null }> {
  if (!supabase) return { error: { message: 'no client' } };
  const { error } =
    score != null
      ? await supabase
          .from('track_ratings')
          .upsert(
            { user_id: userId, recording_id: recordingId, score },
            { onConflict: 'user_id,recording_id' },
          )
      : await supabase
          .from('track_ratings')
          .delete()
          .eq('user_id', userId)
          .eq('recording_id', recordingId);
  if (error) console.error('[trackRatings] save failed:', error.message);
  return { error };
}
