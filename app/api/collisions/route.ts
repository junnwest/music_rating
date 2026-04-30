import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

const THRESHOLD = 1.5;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ collisions: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ collisions: [] });

  // Get all followed user IDs
  const { data: follows } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);

  const followedIds = (follows ?? []).map((f: any) => f.following_id);
  if (followedIds.length === 0) return NextResponse.json({ collisions: [], noFollows: true });

  // Get current user's scored ratings
  const { data: myRatings } = await supabase
    .from('ratings')
    .select('release_id, score')
    .eq('user_id', userId)
    .not('score', 'is', null);

  if (!myRatings || myRatings.length === 0) return NextResponse.json({ collisions: [] });

  const myScoreMap = new Map<string, number>(myRatings.map((r: any) => [r.release_id, r.score]));
  const myReleaseIds = [...myScoreMap.keys()];

  // Get followed users' ratings on the same releases
  const { data: friendRatings } = await supabase
    .from('ratings')
    .select('user_id, release_id, score, releases(title, artist, cover_url)')
    .in('user_id', followedIds)
    .in('release_id', myReleaseIds)
    .not('score', 'is', null);

  if (!friendRatings || friendRatings.length === 0) return NextResponse.json({ collisions: [] });

  // Build username map
  let userMap = new Map<string, string>();
  try {
    const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    userMap = new Map(users.map((u) => [u.id, u.email?.split('@')[0] ?? 'user']));
  } catch {}

  // Compute collisions
  const collisions = (friendRatings as any[])
    .map((r) => {
      const myScore = myScoreMap.get(r.release_id)!;
      const friendScore = r.score as number;
      const diff = Math.abs(myScore - friendScore);
      return {
        releaseId: r.release_id,
        title: r.releases?.title ?? '—',
        artist: r.releases?.artist ?? '',
        coverUrl: r.releases?.cover_url ?? null,
        myScore,
        friendScore,
        friendUsername: userMap.get(r.user_id) ?? 'user',
        diff,
      };
    })
    .filter((c) => c.diff >= THRESHOLD)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 50);

  return NextResponse.json({ collisions });
}
