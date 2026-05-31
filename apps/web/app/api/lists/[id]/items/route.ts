import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { rateLimit } from '../../../../../lib/rateLimit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = await rateLimit(req, 'list-items', 30, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const body = await req.json();
  const { releaseId, userId } = body;

  if (!releaseId || !userId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  // Verify the list belongs to this user
  const { data: list } = await supabase
    .from('lists')
    .select('user_id')
    .eq('id', params.id)
    .single();

  if (!list || list.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('list_items')
    .insert({ list_id: params.id, release_id: releaseId })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = await rateLimit(req, 'list-items', 30, 60);
  if (limited) return limited;

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const body = await req.json();
  const { releaseId, userId } = body;

  const { data: list } = await supabase
    .from('lists')
    .select('user_id')
    .eq('id', params.id)
    .single();

  if (!list || list.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase
    .from('list_items')
    .delete()
    .eq('list_id', params.id)
    .eq('release_id', releaseId);

  return NextResponse.json({ ok: true });
}
