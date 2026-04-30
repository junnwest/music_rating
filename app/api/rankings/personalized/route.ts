import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ myVotes: {}, friendVoteCounts: {} });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ myVotes: {}, friendVoteCounts: {} });

  const [{ data: myVoteRows }, { data: follows }] = await Promise.all([
    supabase.from('ranking_votes').select('category_id, release_id').eq('user_id', userId),
    supabase.from('follows').select('following_id').eq('follower_id', userId),
  ]);

  const myVotes: Record<string, string> = {};
  for (const v of myVoteRows ?? []) myVotes[v.category_id] = v.release_id;

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

  return NextResponse.json({ myVotes, friendVoteCounts });
}
