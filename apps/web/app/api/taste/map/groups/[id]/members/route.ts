import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../../../lib/authGuard';
import { rateLimit } from '../../../../../../../lib/rateLimit';
import { membershipOverflows, overflowError, parseMembersPut, type MemberRow } from '../../../../../../../lib/tasteMap/groupsLogic';
import { isUuid, readJson } from '../../../../../../../lib/tasteMap/validatePhase4';

// PUT /api/taste/map/groups/[id]/members — replace that group's members
// (MembersPutBody → { ok: true, count }). 400 when any node's weights across ALL
// the user's groups, counting the new ones, would sum to > 1. Upsert-then-prune
// (not delete-then-insert), so a failed write never leaves the group empty.
export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = await rateLimit(req, 'taste-map-groups', 60, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'invalid group id' }, { status: 400 });

  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = parseMembersPut(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const members = parsed.value;

  // The user's groups with their members: the ownership check and the sum check in one read.
  const { data: groups, error: readErr } = await db
    .from('taste_map_groups')
    .select('id, taste_map_members(node_key, weight)')
    .eq('user_id', userId);
  if (readErr) return NextResponse.json({ error: 'could not read groups' }, { status: 500 });
  const mine = (groups ?? []) as { id: string; taste_map_members: { node_key: string; weight: number }[] | null }[];
  const target = mine.find((g) => g.id === params.id);
  if (!target) return NextResponse.json({ error: 'group not found' }, { status: 404 });

  const existing: MemberRow[] = mine.flatMap((g) =>
    (g.taste_map_members ?? []).map((m) => ({ groupId: g.id, key: m.node_key, weight: m.weight })),
  );
  const over = membershipOverflows(existing, params.id, members);
  if (over.length) return NextResponse.json({ error: overflowError(over) }, { status: 400 });

  if (members.length) {
    const { error } = await db.from('taste_map_members').upsert(
      members.map((m) => ({ group_id: params.id, node_key: m.key, weight: m.weight, manual: m.manual })),
      { onConflict: 'group_id,node_key' },
    );
    if (error) return NextResponse.json({ error: 'could not save members' }, { status: 500 });
  }
  const keep = new Set(members.map((m) => m.key));
  const stale = (target.taste_map_members ?? []).map((m) => m.node_key).filter((k) => !keep.has(k));
  if (stale.length) {
    const { error } = await db.from('taste_map_members').delete().eq('group_id', params.id).in('node_key', stale);
    if (error) return NextResponse.json({ error: 'could not remove old members' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: members.length });
}
