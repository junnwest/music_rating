import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

const THRESHOLD = 1.5;
const MIN_COMMUNITY_RATINGS = 2;

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ contradictions: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ contradictions: [] });

  // Get the user's scored ratings
  const { data: myRatings } = await supabase
    .from('ratings')
    .select('release_id, score, releases(title, artist, cover_url)')
    .eq('user_id', userId)
    .not('score', 'is', null);

  if (!myRatings || myRatings.length === 0) return NextResponse.json({ contradictions: [] });

  const myReleaseIds = myRatings.map((r: any) => r.release_id);

  // Get all community ratings for those releases (excluding current user)
  const { data: communityRatings } = await supabase
    .from('ratings')
    .select('release_id, score')
    .in('release_id', myReleaseIds)
    .neq('user_id', userId)
    .not('score', 'is', null);

  if (!communityRatings || communityRatings.length === 0) {
    return NextResponse.json({ contradictions: [], noData: true });
  }

  // Compute community avg per release
  const communityMap = new Map<string, { sum: number; count: number }>();
  for (const r of communityRatings as any[]) {
    const entry = communityMap.get(r.release_id) ?? { sum: 0, count: 0 };
    entry.sum += r.score;
    entry.count += 1;
    communityMap.set(r.release_id, entry);
  }

  // Build contradictions
  const contradictions = (myRatings as any[])
    .map((r) => {
      const community = communityMap.get(r.release_id);
      if (!community || community.count < MIN_COMMUNITY_RATINGS) return null;
      const communityAvg = Math.round((community.sum / community.count) * 10) / 10;
      const diff = r.score - communityAvg;
      return {
        releaseId: r.release_id,
        title: r.releases?.title ?? '—',
        artist: r.releases?.artist ?? '',
        coverUrl: r.releases?.cover_url ?? null,
        myScore: r.score as number,
        communityAvg,
        diff,
        absDiff: Math.abs(diff),
        communityCount: community.count,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null && c.absDiff >= THRESHOLD)
    .sort((a, b) => b.absDiff - a.absDiff)
    .slice(0, 50);

  return NextResponse.json({ contradictions });
}
