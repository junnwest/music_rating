import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../lib/authGuard';

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 172800) return 'Yesterday';
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  return `${Math.floor(diff / 604800)} week${Math.floor(diff / 604800) > 1 ? 's' : ''} ago`;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) return NextResponse.json({ notifications: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ notifications: [] });

  const notifications: any[] = [];

  const [followerRes, followingRes, profileRes] = await Promise.all([
    supabase
      .from('follows')
      .select('follower_id, created_at')
      .eq('following_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId),
    supabase
      .from('profiles')
      .select('notifications_last_seen_at')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  const lastSeen: Date | null = profileRes.data?.notifications_last_seen_at
    ? new Date(profileRes.data.notifications_last_seen_at)
    : null;

  const isRead = (createdAt: string) => lastSeen !== null && new Date(createdAt) <= lastSeen;

  // New followers
  const followerRows = followerRes.data ?? [];
  if (followerRows.length > 0) {
    const followerIds = followerRows.map((r: any) => r.follower_id);
    const { data: followerProfiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', followerIds);

    const profileMap = new Map((followerProfiles ?? []).map((p: any) => [p.id, p]));

    for (const row of followerRows) {
      const profile = profileMap.get(row.follower_id);
      const name = profile?.display_name ?? profile?.username ?? 'Someone';
      const handle = profile?.username ? `@${profile.username}` : null;
      notifications.push({
        id: `follow-${row.follower_id}`,
        type: 'follow',
        title: `${name} followed you`,
        body: handle ? `${handle} started following your music taste.` : 'Someone started following you.',
        timeAgo: timeAgo(new Date(row.created_at)),
        read: isRead(row.created_at),
        link: profile?.username ? `/profile/${profile.username}` : undefined,
      });
    }
  }

  // Recent ratings by people I follow
  const followingIds = (followingRes.data ?? []).map((r: any) => r.following_id) as string[];
  if (followingIds.length > 0) {
    const { data: ratingRows } = await supabase
      .from('ratings')
      .select('id, user_id, release_id, score, created_at, releases(title, artist)')
      .in('user_id', followingIds)
      .order('created_at', { ascending: false })
      .limit(15);

    if (ratingRows && ratingRows.length > 0) {
      const userIds = [...new Set(ratingRows.map((r: any) => r.user_id))];
      const { data: ratingProfiles } = await supabase
        .from('profiles')
        .select('id, username, display_name')
        .in('id', userIds);

      const profileMap = new Map((ratingProfiles ?? []).map((p: any) => [p.id, p]));

      for (const row of ratingRows) {
        const profile = profileMap.get(row.user_id);
        const name = profile?.display_name ?? profile?.username ?? 'Someone';
        const release = row.releases as any;
        notifications.push({
          id: `rate-${row.id}`,
          type: 'rate',
          title: `${name} rated an album`,
          body: release ? `Gave ${release.title} ★${row.score}` : 'Rated a new album.',
          timeAgo: timeAgo(new Date(row.created_at)),
          read: isRead(row.created_at),
          link: `/album/${row.release_id}`,
        });
      }
    }
  }

  return NextResponse.json({ notifications });
}

// Called by the notifications page after rendering to stamp last-seen
export async function PATCH(req: NextRequest) {
  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ ok: false }, { status: 400 });

  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId || authedId !== userId) return NextResponse.json({ ok: false }, { status: 403 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 500 });

  await supabase
    .from('profiles')
    .update({ notifications_last_seen_at: new Date().toISOString() })
    .eq('id', userId);

  return NextResponse.json({ ok: true });
}
