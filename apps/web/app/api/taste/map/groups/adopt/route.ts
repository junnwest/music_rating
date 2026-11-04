import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../../lib/authGuard';
import { rateLimit } from '../../../../../../lib/rateLimit';
import { parseAdopt } from '../../../../../../lib/tasteMap/groupsLogic';
import { readJson } from '../../../../../../lib/tasteMap/validatePhase4';
import type { TasteMapGroup } from '../../../../../../lib/tasteMap/types';

// POST /api/taste/map/groups/adopt — materialize the seeded (world) groups
// (GroupsAdoptBody → { groups, idMap }). 409 when the user already has stored
// groups. Ids are generated here so idMap doesn't depend on insert order; if the
// members insert fails, the new groups are deleted again.
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
  const parsed = parseAdopt(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { count, error: countErr } = await db
    .from('taste_map_groups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (countErr) return NextResponse.json({ error: 'could not read groups' }, { status: 500 });
  if ((count ?? 0) > 0) return NextResponse.json({ error: 'groups already adopted' }, { status: 409 });

  const idMap: Record<string, string> = {};
  for (const g of parsed.value) idMap[g.id] = randomUUID();
  const { error: gErr } = await db
    .from('taste_map_groups')
    .insert(parsed.value.map((g) => ({ id: idMap[g.id], user_id: userId, name: g.name, color: g.color, seed_world: g.seedWorld })));
  if (gErr) return NextResponse.json({ error: 'could not create groups' }, { status: 500 });

  const memberRows = parsed.value.flatMap((g) =>
    g.members.map((m) => ({ group_id: idMap[g.id], node_key: m.key, weight: m.weight, manual: m.manual })),
  );
  if (memberRows.length) {
    const { error: mErr } = await db.from('taste_map_members').insert(memberRows);
    if (mErr) {
      await db.from('taste_map_groups').delete().eq('user_id', userId).in('id', Object.values(idMap));
      return NextResponse.json({ error: 'could not save group members' }, { status: 500 });
    }
  }
  const groups: TasteMapGroup[] = parsed.value.map((g) => ({ id: idMap[g.id], name: g.name, color: g.color, seedWorld: g.seedWorld }));
  return NextResponse.json({ groups, idMap });
}
