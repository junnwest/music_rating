import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../../lib/authGuard';
import { rateLimit } from '../../../../../../lib/rateLimit';
import { parseGroupPatch } from '../../../../../../lib/tasteMap/groupsLogic';
import { isUuid, readJson } from '../../../../../../lib/tasteMap/validatePhase4';
import type { TasteMapGroup } from '../../../../../../lib/tasteMap/types';

// PATCH /api/taste/map/groups/[id] — rename / recolor (GroupPatchBody → { group }).
// DELETE /api/taste/map/groups/[id] — delete (members cascade) → { ok: true }.
// Another user's group id is a 404, never a write: the service-role client
// bypasses RLS, so ownership is checked here and every write is scoped by user_id.
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };
type Db = NonNullable<ReturnType<typeof createServerClient>>;

async function ownedGroup(db: Db, id: string, userId: string) {
  const { data, error } = await db.from('taste_map_groups').select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  return { found: !!data, error };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, 'taste-map-groups', 60, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'invalid group id' }, { status: 400 });

  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  const parsed = parseGroupPatch(body.value);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const owned = await ownedGroup(db, params.id, userId);
  if (owned.error) return NextResponse.json({ error: 'could not read group' }, { status: 500 });
  if (!owned.found) return NextResponse.json({ error: 'group not found' }, { status: 404 });

  const { data, error } = await db
    .from('taste_map_groups')
    .update(parsed.value)
    .eq('id', params.id)
    .eq('user_id', userId)
    .select('id, name, color, seed_world')
    .single();
  if (error || !data) return NextResponse.json({ error: 'could not update group' }, { status: 500 });
  const group: TasteMapGroup = { id: data.id, name: data.name, color: data.color, seedWorld: data.seed_world };
  return NextResponse.json({ group });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, 'taste-map-groups', 60, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!isUuid(params.id)) return NextResponse.json({ error: 'invalid group id' }, { status: 400 });

  const owned = await ownedGroup(db, params.id, userId);
  if (owned.error) return NextResponse.json({ error: 'could not read group' }, { status: 500 });
  if (!owned.found) return NextResponse.json({ error: 'group not found' }, { status: 404 });

  const { error } = await db.from('taste_map_groups').delete().eq('id', params.id).eq('user_id', userId);
  if (error) return NextResponse.json({ error: 'could not delete group' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
