import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../lib/authGuard';
import { rateLimit } from '../../../lib/rateLimit';

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'follow', 10, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (followerId === followingId) return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });

  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId || authedId !== followerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // A follow on a private account is turned into a follow_requests row by
  // a DB trigger (migration 20260926000000), so check which one happened.
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: followerId, following_id: followingId });

  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: follow } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  return NextResponse.json({ ok: true, state: follow ? 'following' : 'requested' });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const authedId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!authedId || authedId !== followerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Unfollow, or withdraw a pending request.
  await Promise.all([
    supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId),
    supabase.from('follow_requests').delete().eq('requester_id', followerId).eq('target_id', followingId),
  ]);

  return NextResponse.json({ ok: true });
}
