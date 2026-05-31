import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'resolve-username', 10, 60);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const username = (body.username as string | undefined)?.trim().toLowerCase();
  if (!username) return NextResponse.json({ error: 'missing username' }, { status: 400 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'server error' }, { status: 500 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', username)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: { user }, error } = await supabase.auth.admin.getUserById(profile.id);
  if (error || !user?.email) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ email: user.email });
}
