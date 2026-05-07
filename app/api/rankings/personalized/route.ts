import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ myRankings: {}, friendVoteCounts: {} });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ myRankings: {}, friendVoteCounts: {} });

  const [{ data: myRankingRows }, { data: follows }] = await Promise.all([
    supabase.from('user_rankings').select('category_id').eq('user_id', userId),
    supabase.from('follows').select('following_id').eq('follower_id', userId),
  ]);

  const myRankings: Record<string, boolean> = {};
  for (const r of myRankingRows ?? []) myRankings[r.category_id] = true;

  const followedIds = (follows ?? []).map((f: any) => f.following_id);
  const friendVoteCounts: Record<string, number> = {};

  if (followedIds.length > 0) {
    const { data: friendVoteRows } = await supabase
      .from('ranking_votes')
      .select('category_id')
      .in('user_id', followedIds);

    for (const v of friendVoteRows ?? []) {
      friendVoteCounts[v.category_id] = (friendVoteCounts[v.category_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({ myRankings, friendVoteCounts });
}
