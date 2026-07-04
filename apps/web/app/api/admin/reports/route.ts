import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

function checkAuth(req: NextRequest): boolean {
  const secret = req.headers.get('x-seed-secret');
  return Boolean(process.env.SEED_SECRET) && secret === process.env.SEED_SECRET;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const status = req.nextUrl.searchParams.get('status') ?? 'open';

  const { data: reports, error } = await supabase
    .from('reports')
    .select('id, reporter_id, reported_user_id, rating_id, reason, status, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set([
    ...(reports ?? []).map((r) => r.reporter_id),
    ...(reports ?? []).map((r) => r.reported_user_id),
  ])];

  const { data: profiles } = userIds.length > 0
    ? await supabase.from('profiles').select('id, username').in('id', userIds)
    : { data: [] };
  const userMap = new Map((profiles ?? []).map((p: any) => [p.id, p.username]));

  const { data: contactSubmissions } = await supabase
    .from('contact_submissions')
    .select('id, email, category, message, status, created_at')
    .eq('status', status === 'open' ? 'open' : status === 'dismissed' ? 'closed' : 'reviewed')
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({
    reports: (reports ?? []).map((r) => ({
      ...r,
      reporterUsername: userMap.get(r.reporter_id) ?? 'unknown',
      reportedUsername: userMap.get(r.reported_user_id) ?? 'unknown',
    })),
    contactSubmissions: contactSubmissions ?? [],
  });
}

export async function PATCH(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { table, id, status } = body ?? {};

  if (!['reports', 'contact_submissions'].includes(table)) {
    return NextResponse.json({ error: 'Invalid table.' }, { status: 400 });
  }
  const validStatuses = table === 'reports'
    ? ['open', 'reviewed', 'actioned', 'dismissed']
    : ['open', 'reviewed', 'closed'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { error } = await supabase.from(table).update({ status }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
