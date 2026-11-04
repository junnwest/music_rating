import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { LIMITS } from '../../../../../lib/tasteMap/apiTypes';
import { parseGroupCreate } from '../../../../../lib/tasteMap/groupsLogic';
import { readJson } from '../../../../../lib/tasteMap/validatePhase4';
import type { TasteMapGroup } from '../../../../../lib/tasteMap/types';

// POST /api/taste/map/groups — create a group (GroupCreateBody → { group }).
// The service-role client bypasses RLS: every query is scoped to the authed user.
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-groups', 60, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = parseGroupCreate(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { count, error: countErr } = await db
    .from('taste_map_groups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (countErr) return NextResponse.json({ error: 'could not read groups' }, { status: 500 });
  if ((count ?? 0) >= LIMITS.groups) return NextResponse.json({ error: `at most ${LIMITS.groups} groups` }, { status: 409 });

  const { data, error } = await db
    .from('taste_map_groups')
    .insert({ user_id: userId, name: parsed.value.name, color: parsed.value.color, seed_world: null })
    .select('id, name, color, seed_world')
    .single();
  if (error || !data) return NextResponse.json({ error: 'could not create group' }, { status: 500 });
  const group: TasteMapGroup = { id: data.id, name: data.name, color: data.color, seedWorld: data.seed_world };
  return NextResponse.json({ group });
}
