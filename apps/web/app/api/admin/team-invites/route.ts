import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

/**
 * Admin surface for team-issued invites — generate a batch, list outstanding
 * ones. Same gating posture as the rest of app/api/admin/* (x-seed-secret
 * header against SEED_SECRET); no separate admin-role system in this app.
 * Supersedes the old SQL-editor-only `generate_beta_tokens()` workflow with
 * a real (if minimal) UI — see app/admin/invites/page.tsx.
 */
function checkAuth(req: NextRequest): boolean {
  const secret = req.headers.get('x-seed-secret');
  return Boolean(process.env.SEED_SECRET) && secret === process.env.SEED_SECRET;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { data: tokens, error } = await supabase
    .from('invite_tokens')
    .select('token, created_at, expires_at, revoked_at, redeemed_by, redeemed_at')
    .eq('source', 'team')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const redeemedIds = [...new Set((tokens ?? []).map((t) => t.redeemed_by).filter(Boolean))] as string[];
  const { data: profiles } = redeemedIds.length > 0
    ? await supabase.from('profiles').select('id, username').in('id', redeemedIds)
    : { data: [] };
  const usernameById = new Map((profiles ?? []).map((p) => [p.id, p.username]));

  const rows = (tokens ?? []).map((t) => ({
    ...t,
    redeemedByUsername: t.redeemed_by ? usernameById.get(t.redeemed_by) ?? null : null,
  }));

  return NextResponse.json({ tokens: rows });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const n = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 50);

  const { data, error } = await supabase.rpc('generate_team_invites', { n });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tokens: data as string[] });
}
