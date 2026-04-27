import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function GET() {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ lists: [] });

  const { data } = await supabase
    .from('lists')
    .select('id, title, description, user_id, created_at, list_items(count)')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ lists: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const body = await req.json();
  const { title, description, userId, username } = body;

  if (!title?.trim() || !userId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('lists')
    .insert({ title: title.trim(), description: description?.trim() ?? null, user_id: userId, username })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}
