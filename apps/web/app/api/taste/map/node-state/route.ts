import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { readJsonBody } from '../../../../../lib/tasteMap/store';
import { isNodeKey, isPlainObject } from '../../../../../lib/tasteMap/validatePhase4';
import { setNodeState } from '../../../../../lib/tasteMap/nodeState';
import { NODE_STATE_VALUES, type NodeStatePutResponse, type NodeStateValue } from '../../../../../lib/tasteMap/ghostApi';

// PUT /api/taste/map/node-state (ghostApi.ts NodeStatePutBody): the user's choice
// for a ghost node (thin.ts): 'placed' (dragged onto the map; the pin carries
// the position), 'hidden' ("leave it out"), 'included' ("include anyway"), or
// null to clear it. Stored per user in taste_map_node_state, which is in the
// map's input hash, so the next GET re-classifies. Service-role client: every
// query is scoped to the authed user (lib/tasteMap/nodeState.ts).
//   503 when the table is missing (migration 20261105000000 not applied).
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2_000;

export async function PUT(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-node-state', 60, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const v = body.value;
  if (!isPlainObject(v)) return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  if (!isNodeKey(v.key)) return NextResponse.json({ error: 'key is not a node key' }, { status: 400 });
  if (v.state !== null && !(NODE_STATE_VALUES as readonly unknown[]).includes(v.state))
    return NextResponse.json({ error: `state must be one of ${NODE_STATE_VALUES.join(', ')} or null` }, { status: 400 });
  const state = v.state as NodeStateValue | null;

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const res = await setNodeState(db, userId, v.key, state);
  if (!res.ok) {
    if (res.missing) return NextResponse.json({ error: 'ghost choices are not available yet' }, { status: 503 });
    console.error('[taste-map] node state save failed:', res.message);
    return NextResponse.json({ error: 'could not save' }, { status: 500 });
  }
  const out: NodeStatePutResponse = { ok: true, key: v.key, state };
  return NextResponse.json(out);
}
