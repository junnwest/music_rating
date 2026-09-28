import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';
import { isValidUsername } from '../../../lib/username';

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'check-username', 20, 60);
  if (limited) return limited;
  const username = req.nextUrl.searchParams.get('username')?.toLowerCase().trim();
  if (!username) return NextResponse.json({ available: false });
  if (!isValidUsername(username)) return NextResponse.json({ available: false, reason: 'invalid' });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ available: false });

  const { data: allowed, error: policyError } = await supabase.rpc('is_username_allowed', { candidate: username });
  if (policyError) return NextResponse.json({ available: false }, { status: 503 });
  if (!allowed) return NextResponse.json({ available: false, reason: 'blocked' });

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error) return NextResponse.json({ available: false }, { status: 503 });

  return NextResponse.json({ available: !data });
}
