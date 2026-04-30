import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (followerId === followingId) return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: followerId, following_id: followingId });

  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);

  return NextResponse.json({ ok: true });
}
