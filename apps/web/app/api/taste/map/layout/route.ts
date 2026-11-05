import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { LENS } from '../../../../../lib/tasteMap/payload';
import { readJsonBody, saveArrangedLayout } from '../../../../../lib/tasteMap/store';
import { validateLayoutBody } from '../../../../../lib/tasteMap/validate';
import type { OkResponse } from '../../../../../lib/tasteMap/apiTypes';
import { canSeeTasteMap } from '../../../../../lib/tasteMap/access';

// PUT /api/taste/map/layout (TASTE_MAP_PLAN.md Phase 3): saves client-arranged
// positions (apiTypes.ts LayoutPutBody) as the user's layout for the 'sound'
// lens, marked user-arranged (version = 2, see lib/tasteMap/payload.ts). Later
// loads keep these positions and only place new nodes. The saved version +
// solved_at are in the GET payload's input hash, so this invalidates the cache.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;

export async function PUT(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-layout', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const positions = validateLayoutBody(body.value);
  if (!positions.ok) return NextResponse.json({ error: positions.error }, { status: 400 });
  // An empty arranged layout would leave nothing to anchor new nodes to.
  if (!Object.keys(positions.value).length) return NextResponse.json({ error: 'positions is empty' }, { status: 400 });

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const error = await saveArrangedLayout(db, userId, LENS, positions.value);
  if (error) {
    console.error('[taste-map] layout save failed:', error.message);
    return NextResponse.json({ error: 'could not save layout' }, { status: 500 });
  }
  const res: OkResponse = { ok: true, count: Object.keys(positions.value).length };
  return NextResponse.json(res);
}
