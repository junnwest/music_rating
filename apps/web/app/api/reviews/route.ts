import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const releaseId = req.nextUrl.searchParams.get('releaseId');
  const viewerId = req.nextUrl.searchParams.get('viewerId') ?? null;
  if (!releaseId) return NextResponse.json({ reviews: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ reviews: [] });

  const { data: rows } = await supabase
    .from('reviews')
    .select('id, user_id, body, created_at, visibility')
    .eq('release_id', releaseId)
    .order('created_at', { ascending: false });

  if (!rows?.length) return NextResponse.json({ reviews: [] });

  // Always resolve username from profiles (not the stored snapshot)
  const allAuthorIds = [...new Set(rows.map(r => r.user_id))];
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', allAuthorIds);
  const usernameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.username as string]));

  // Resolve which 'friends' authors the viewer follows
  let followedSet = new Set<string>();
  if (viewerId) {
    const friendAuthorIds = [...new Set(
      rows.filter(r => r.visibility === 'friends' && r.user_id !== viewerId).map(r => r.user_id)
    )];
    if (friendAuthorIds.length > 0) {
      const { data: follows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId)
        .in('following_id', friendAuthorIds);
      followedSet = new Set((follows ?? []).map(f => f.following_id));
    }
  }

  const visible = rows.filter(r => {
    if (r.visibility === 'public') return true;
    if (r.visibility === 'private') return viewerId === r.user_id;
    if (r.visibility === 'friends') return viewerId === r.user_id || followedSet.has(r.user_id);
    return true;
  });

  if (!visible.length) return NextResponse.json({ reviews: [] });

  const commentIds = visible.map(r => r.id);
  const authorIds = [...new Set(visible.map(r => r.user_id))];

  const [{ data: ratings }, { data: likes }, { data: viewerLikedRows }] = await Promise.all([
    authorIds.length > 0
      ? supabase.from('ratings').select('user_id, score').eq('release_id', releaseId).in('user_id', authorIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('comment_likes').select('comment_id').in('comment_id', commentIds),
    viewerId
      ? supabase.from('comment_likes').select('comment_id').eq('user_id', viewerId).in('comment_id', commentIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const scoreMap = new Map((ratings ?? []).map((r: any) => [r.user_id, r.score]));
  const likeCount = new Map<string, number>();
  for (const l of likes ?? []) likeCount.set(l.comment_id, (likeCount.get(l.comment_id) ?? 0) + 1);
  const viewerLiked = new Set((viewerLikedRows ?? []).map((l: any) => l.comment_id));

  const result = visible.map(r => ({
    ...r,
    username: usernameMap.get(r.user_id) ?? null,
    score: scoreMap.get(r.user_id) ?? null,
    likeCount: likeCount.get(r.id) ?? 0,
    liked: viewerLiked.has(r.id),
  }));

  return NextResponse.json({ reviews: result });
}
