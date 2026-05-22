import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'check-username', 20, 60);
  if (limited) return limited;
  const username = req.nextUrl.searchParams.get('username')?.toLowerCase().trim();
  if (!username) return NextResponse.json({ available: false });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ available: false });

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  return NextResponse.json({ available: !data });
}
