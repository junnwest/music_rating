import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { LENS } from '../../../../../lib/tasteMap/payload';
import { chunk, deleteUserRowsIn, IN_CHUNK, readJsonBody, replacePins, saveArrangedLayout } from '../../../../../lib/tasteMap/store';
import { planImport } from '../../../../../lib/tasteMap/exportImport';
import { validateExport } from '../../../../../lib/tasteMap/validate';
import type { ImportResponse } from '../../../../../lib/tasteMap/apiTypes';
import { canSeeTasteMap } from '../../../../../lib/tasteMap/access';

// POST /api/taste/map/import (TASTE_MAP_PLAN.md Phase 3): restores a
// TasteMapExport with REPLACE semantics: afterwards the user's pins, groups
// (+ members), era overrides and metric are exactly the file's, and the file's
// layout (if any) is saved as user-arranged (version 2). A file without a layout
// leaves the stored layout alone.
//
// The whole body is validated before the first write. PostgREST can't wrap these
// tables in one transaction, so writes go "add, then prune", ordered so that a
// failure part-way leaves a superset of the old and new data, never a loss:
//   1. insert the new groups (fresh uuids) and their members; on failure the new
//      groups are deleted again and nothing else has changed;
//   2. pins: delete the ones not in the file, upsert the file's;
//   3. eras: upsert the file's, then delete the others (artists no longer in
//      the catalog are skipped: the FK would reject the whole batch);
//   4. metric: upsert, or delete when the file has none;
//   5. layout: upsert as arranged, when the file has one;
//   6. delete the user's old groups (members cascade) — last, so until here
//      the old groups are still there.
// The error names the step that failed; re-running the import converges.
// Every write carries the authed user id (or a group id created here for them).
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 2_000_000;

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-import', 5, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const exp = validateExport(body.value, LENS);
  if (!exp.ok) return NextResponse.json({ error: exp.error }, { status: 400 });

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const now = new Date().toISOString();
  const plan = planImport(userId, exp.value, LENS, randomUUID, now);
  const failAt = (step: string, message: string) => {
    console.error(`[taste-map] import failed at ${step}:`, message);
    return NextResponse.json({ error: `import failed at ${step}; run it again to finish` }, { status: 500 });
  };

  // Read what will be pruned before anything is written.
  const [oldGroupsRes, oldErasRes] = await Promise.all([
    db.from('taste_map_groups').select('id').eq('user_id', userId),
    db.from('taste_map_eras').select('artist_id').eq('user_id', userId),
  ]);
  if (oldGroupsRes.error) return failAt('reading groups', oldGroupsRes.error.message);
  if (oldErasRes.error) return failAt('reading eras', oldErasRes.error.message);
  const newGroupIds = new Set(plan.groups.map((g) => g.id));
  const oldGroupIds = ((oldGroupsRes.data ?? []) as { id: string }[]).map((g) => g.id).filter((id) => !newGroupIds.has(id));

  // 1. groups + members
  if (plan.groups.length) {
    const { error } = await db.from('taste_map_groups').insert(plan.groups);
    if (error) return failAt('groups', error.message);
    for (const part of chunk(plan.members, 1000)) {
      const { error: mErr } = await db.from('taste_map_members').insert(part);
      if (mErr) {
        await deleteUserRowsIn(db, 'taste_map_groups', userId, 'id', plan.groups.map((g) => g.id));
        return failAt('group members', mErr.message);
      }
    }
  }

  // 2. pins
  const pinsRes = await replacePins(db, userId, exp.value.pins);
  if (pinsRes.error) return failAt('pins', pinsRes.error.message ?? '');

  // 3. eras
  const known = new Set<string>();
  for (const part of chunk(plan.eras.map((e) => e.artist_id), IN_CHUNK)) {
    const { data, error } = await db.from('artists').select('id').in('id', part);
    if (error) return failAt('eras', error.message);
    for (const r of (data ?? []) as { id: string }[]) known.add(r.id);
  }
  const eras = plan.eras.filter((e) => known.has(e.artist_id));
  if (eras.length) {
    const { error } = await db.from('taste_map_eras').upsert(eras, { onConflict: 'user_id,artist_id' });
    if (error) return failAt('eras', error.message);
  }
  const keepEras = new Set(eras.map((e) => e.artist_id));
  const staleEras = ((oldErasRes.data ?? []) as { artist_id: string }[]).map((e) => e.artist_id).filter((id) => !keepEras.has(id));
  const eraDelErr = await deleteUserRowsIn(db, 'taste_map_eras', userId, 'artist_id', staleEras);
  if (eraDelErr) return failAt('eras', eraDelErr.message ?? '');

  // 4. metric
  const metricRes = plan.metric
    ? await db.from('taste_map_metric').upsert(plan.metric, { onConflict: 'user_id,lens' })
    : await db.from('taste_map_metric').delete().eq('user_id', userId).eq('lens', LENS);
  if (metricRes.error) return failAt('metric', metricRes.error.message);

  // 5. layout
  if (plan.layout) {
    const error = await saveArrangedLayout(db, userId, LENS, plan.layout);
    if (error) return failAt('layout', error.message ?? '');
  }

  // 6. old groups
  const groupDelErr = await deleteUserRowsIn(db, 'taste_map_groups', userId, 'id', oldGroupIds);
  if (groupDelErr) return failAt('removing old groups', groupDelErr.message ?? '');

  const res: ImportResponse = {
    ok: true,
    counts: {
      pins: exp.value.pins.length,
      groups: plan.groups.length,
      members: plan.members.length,
      eras: eras.length,
      metric: plan.metric ? 1 : 0,
      layout: plan.layout ? 1 : 0,
    },
  };
  return NextResponse.json(res);
}
