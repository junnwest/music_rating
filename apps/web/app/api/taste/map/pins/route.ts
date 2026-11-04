import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { readJsonBody, replacePins } from '../../../../../lib/tasteMap/store';
import { validatePinsBody } from '../../../../../lib/tasteMap/validate';
import type { OkResponse } from '../../../../../lib/tasteMap/apiTypes';

// PUT /api/taste/map/pins (TASTE_MAP_PLAN.md Phase 3): replaces the user's whole
// pin set (apiTypes.ts PinsPutBody). The client autosaves on a debounce. Pins are
// in the GET payload's input hash, so the next map load misses the cache.
// The service-role client bypasses RLS: every query is scoped to the authed user
// in lib/tasteMap/store.ts.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;

export async function PUT(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-pins', 60, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const pins = validatePinsBody(body.value);
  if (!pins.ok) return NextResponse.json({ error: pins.error }, { status: 400 });

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { error } = await replacePins(db, userId, pins.value);
  if (error) {
    console.error('[taste-map] pins save failed:', error.message);
    return NextResponse.json({ error: 'could not save pins' }, { status: 500 });
  }
  const res: OkResponse = { ok: true, count: pins.value.length };
  return NextResponse.json(res);
}
