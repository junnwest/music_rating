import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId') ?? null;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ feed: [], isFiltered: false });

  // Determine which user IDs to include in the feed
  let filterIds: string[] | null = null;
  let isFiltered = false;

  if (userId) {
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    const followedIds = (follows ?? []).map((f: any) => f.following_id);
    filterIds = followedIds.length > 0 ? followedIds : [];
    isFiltered = true;
  }

  // Logged-in user follows nobody — return empty feed immediately
  if (isFiltered && filterIds!.length === 0) {
    return NextResponse.json({ feed: [], isFiltered: true });
  }

  // Fetch ratings and reviews
  const [{ data: ratings }, { data: reviews }] = await Promise.all([
    filterIds
      ? supabase
          .from('ratings')
          .select('user_id, release_id, score, created_at, releases(id, title, artist, cover_url)')
          .in('user_id', filterIds)
          .order('created_at', { ascending: false })
          .limit(40)
      : supabase
          .from('ratings')
          .select('user_id, release_id, score, created_at, releases(id, title, artist, cover_url)')
          .order('created_at', { ascending: false })
          .limit(40),
    filterIds
      ? supabase
          .from('reviews')
          .select('user_id, username, release_id, body, created_at')
          .in('user_id', filterIds)
          .order('created_at', { ascending: false })
          .limit(40)
      : supabase
          .from('reviews')
          .select('user_id, username, release_id, body, created_at')
          .order('created_at', { ascending: false })
          .limit(40),
  ]);

  // Build username map from profiles table
  const allUserIds = [...new Set([
    ...(ratings ?? []).map((r: any) => r.user_id),
    ...(reviews ?? []).map((r: any) => r.user_id),
  ])];
  let userMap = new Map<string, string>();
  if (allUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', allUserIds);
    userMap = new Map((profiles ?? []).map((p: any) => [p.id, p.username]));
  }

  // Resolve release info for reviews
  const reviewReleaseIds = [...new Set((reviews ?? []).map((r: any) => r.release_id))];
  const { data: reviewReleases } = reviewReleaseIds.length > 0
    ? await supabase.from('releases').select('id, title, artist, cover_url').in('id', reviewReleaseIds)
    : { data: [] };
  const releaseMap = new Map((reviewReleases ?? []).map((r: any) => [r.id, r]));

  const feed = [
    ...(ratings ?? []).map((r: any) => ({
      type: 'rating' as const,
      userId: r.user_id,
      username: userMap.get(r.user_id) ?? 'user',
      release: r.releases,
      score: r.score,
      body: undefined,
      date: r.created_at,
      releaseId: r.release_id,
    })),
    ...(reviews ?? []).map((r: any) => ({
      type: 'review' as const,
      userId: r.user_id,
      username: r.username ?? userMap.get(r.user_id) ?? 'user',
      release: releaseMap.get(r.release_id) ?? null,
      score: undefined,
      body: r.body,
      date: r.created_at,
      releaseId: r.release_id,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 50);

  return NextResponse.json({ feed, isFiltered });
}
