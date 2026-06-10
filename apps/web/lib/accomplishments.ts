import { createServerClient } from './supabaseServer';

const MILESTONE_BADGES: { id: string; threshold: number }[] = [
  { id: 'ratings_10',  threshold: 10 },
  { id: 'ratings_50',  threshold: 50 },
  { id: 'ratings_100', threshold: 100 },
  { id: 'ratings_500', threshold: 500 },
];

/**
 * Called after a rating is written. Checks milestone badges and awards any newly earned ones.
 * Returns newly awarded definition IDs (empty if none).
 */
export async function checkAndAwardRatingMilestones(userId: string): Promise<string[]> {
  const supabase = createServerClient();
  if (!supabase) return [];

  // Count the user's rated albums (score not null)
  const { count } = await supabase
    .from('ratings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('score', 'is', null);

  const totalRated = count ?? 0;

  // Fetch already-earned milestone badges
  const { data: earned } = await supabase
    .from('user_accomplishments')
    .select('definition_id')
    .eq('user_id', userId)
    .in('definition_id', MILESTONE_BADGES.map(b => b.id));

  const earnedSet = new Set((earned ?? []).map((r: any) => r.definition_id));

  const newlyEarned: string[] = [];
  for (const badge of MILESTONE_BADGES) {
    if (!earnedSet.has(badge.id) && totalRated >= badge.threshold) {
      const { error } = await supabase
        .from('user_accomplishments')
        .insert({ user_id: userId, definition_id: badge.id, notified: false })
        .select();
      if (!error) newlyEarned.push(badge.id);
    }
  }

  return newlyEarned;
}

/**
 * Called after a leaderboard is fully rated. Checks if user has rated every album in a category.
 */
export async function checkLeaderboardCompletion(userId: string, categoryId: string): Promise<boolean> {
  const supabase = createServerClient();
  if (!supabase) return false;

  const alreadyEarned = await supabase
    .from('user_accomplishments')
    .select('id')
    .eq('user_id', userId)
    .eq('definition_id', 'leaderboard_complete')
    .maybeSingle();
  if (alreadyEarned.data) return false;

  // Get all release IDs in this leaderboard's seed entries
  const { data: seedRows } = await supabase
    .from('ranking_seed_entries')
    .select('release_id')
    .eq('category_id', categoryId);

  const seedIds = (seedRows ?? []).map((r: any) => r.release_id as string);
  if (seedIds.length === 0) return false;

  const { count } = await supabase
    .from('ratings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('release_id', seedIds)
    .not('score', 'is', null);

  if ((count ?? 0) < seedIds.length) return false;

  const { error } = await supabase
    .from('user_accomplishments')
    .insert({ user_id: userId, definition_id: 'leaderboard_complete', notified: false });

  return !error;
}
