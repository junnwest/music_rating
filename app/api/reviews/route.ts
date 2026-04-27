import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const releaseId = req.nextUrl.searchParams.get('releaseId');
  if (!releaseId) return NextResponse.json({ reviews: [] });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ reviews: [] });

  const { data } = await supabase
    .from('reviews')
    .select('id, user_id, username, body, created_at')
    .eq('release_id', releaseId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ reviews: data ?? [] });
}
