import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { LENS } from '../../../../../lib/tasteMap/payload';
import { selectPins } from '../../../../../lib/tasteMap/store';
import { buildExport } from '../../../../../lib/tasteMap/exportImport';

// GET /api/taste/map/export (TASTE_MAP_PLAN.md Phase 3): the user's map inputs
// (pins, groups + members, era overrides, metric, stored layout) as a
// TasteMapExport JSON download, for backup and POST /api/taste/map/import.
// Read-only. Every query is scoped to the authed user.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-export', 10, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [pinsRes, groupsRes, erasRes, metricRes, layoutRes] = await Promise.all([
    selectPins(db, userId),
    db
      .from('taste_map_groups')
      .select('id, name, color, seed_world, created_at, taste_map_members(node_key, weight, manual)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    db.from('taste_map_eras').select('artist_id, split_rg_ids').eq('user_id', userId),
    db.from('taste_map_metric').select('block_w, dim_w').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
    db.from('taste_map_layouts').select('positions').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
  ]);
  const failed = [pinsRes.error, groupsRes.error, erasRes.error, metricRes.error, layoutRes.error].find(Boolean);
  if (failed) {
    console.error('[taste-map] export read failed:', failed.message);
    return NextResponse.json({ error: 'could not read the map' }, { status: 500 });
  }

  const now = new Date();
  const out = buildExport({
    lens: LENS,
    exportedAt: now.toISOString(),
    pins: pinsRes.data,
    groups: (groupsRes.data ?? []) as Parameters<typeof buildExport>[0]['groups'],
    eras: (erasRes.data ?? []) as Parameters<typeof buildExport>[0]['eras'],
    metric: metricRes.data ?? null,
    layout: (layoutRes.data?.positions ?? null) as Parameters<typeof buildExport>[0]['layout'],
  });
  return new NextResponse(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="taste-map-${now.toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
