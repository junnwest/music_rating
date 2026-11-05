import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { loadMapUserInput } from '../../../../../lib/tasteMap/load';
import { buildFeatureSpace } from '../../../../../lib/tasteMap/features';
import { decideMetric, decisionToResponse, decisionToRow, responseFromRow } from '../../../../../lib/tasteMap/metricStore';
import { LENS, loadStoredState, mapPositions } from '../../../../../lib/tasteMap/storedState';
import { isPlainObject, readJson, validatePositions } from '../../../../../lib/tasteMap/validatePhase4';
import type { NodeKey, Vec3 } from '../../../../../lib/tasteMap/types';
import { canSeeTasteMap, requiredRatedAlbums } from '../../../../../lib/tasteMap/access';

// POST /api/taste/map/metric (MetricFitBody) → MetricFitResponse.
// Fits the personal metric (TASTE_MAP_PLAN.md D6) on `positions` if sent, else on
// the stored layout with pins overlaid; pinned keys = stored pins, groups = stored
// members. Leave-one-pin-out against the DEFAULT metric decides what is stored:
// the learned weights only when they win with ≥ MIN_EVAL_PINS pins, otherwise the
// default weights (lib/tasteMap/metricStore.ts). Stored keyed by tag-dim id.
// GET /api/taste/map/metric → MetricFitResponse | { stored: null }.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;


export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-metric-get', 30, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { data, error } = await db
    .from('taste_map_metric')
    .select('block_w, dim_w, eval, n_triplets, fitted_at')
    .eq('user_id', userId)
    .eq('lens', LENS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'could not read metric' }, { status: 500 });
  if (!data) return NextResponse.json({ stored: null });
  return NextResponse.json(responseFromRow(data));
}

export async function POST(req: NextRequest) {
  // CPU-heavy (feature build + fit + eval): a tighter limit than the map GET.
  const limited = await rateLimit(req, 'taste-map-metric', 4, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const body = await readJson(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
  if (!isPlainObject(body.value)) return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  let sent: Record<NodeKey, Vec3> | null = null;
  if (body.value.positions !== undefined) {
    const p = validatePositions(body.value.positions);
    if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
    sent = p.value;
  }

  const [input, state] = await Promise.all([loadMapUserInput(db, userId), loadStoredState(db, userId)]);
  if (!canSeeTasteMap(input.username)) return NextResponse.json({ error: 'not available' }, { status: 403 });
  // Same gate as the map route (access.ts).
  const needed = requiredRatedAlbums(input.username);
  const rated = input.artists.reduce((s, a) => s + a.albums.filter((al) => al.rated).length, 0);
  if (rated < needed) return NextResponse.json({ error: 'not enough ratings', needed, have: rated }, { status: 422 });

  const positions = sent ?? mapPositions(state);
  if (!positions || !Object.keys(positions).length)
    return NextResponse.json({ error: 'no saved layout yet: open the map first' }, { status: 409 });

  const space = buildFeatureSpace(input, state.overrides);
  const decision = decideMetric({ space, positions, pinnedKeys: state.pins.keys(), groups: state.groups });
  const fittedAt = new Date().toISOString();

  const { error } = await db
    .from('taste_map_metric')
    .upsert({ user_id: userId, lens: LENS, ...decisionToRow(decision, space, fittedAt) }, { onConflict: 'user_id,lens' });
  if (error) return NextResponse.json({ error: 'could not save metric' }, { status: 500 });
  return NextResponse.json(decisionToResponse(decision, space, fittedAt));
}
