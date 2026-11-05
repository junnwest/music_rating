import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../../lib/authGuard';
import { rateLimit } from '../../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../../lib/cache';
import { canSeeTasteMap } from '../../../../../lib/tasteMap/access';
import { nearbyQueryHash, parseNearbyQuery, suggestNearby, type NearbyResponse } from '../../../../../lib/tasteMap/nearby';

// GET /api/taste/map/nearby?keys=<k1,k2,…>&w=<w1,w2,…> → NearbyResponse.
// The "What's here?" card: unrated catalog albums that would sit where the
// given map nodes are (the client sends the nodes around the clicked point with
// their kernel weights, lib/tasteMap/focus.ts hereQuery). Ranking in
// lib/tasteMap/nearby.ts. Read-only. ≤ NEARBY_MAX_KEYS keys; `w` optional
// (equal weights), else one finite weight ≥ 0 per key.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 600;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map-nearby', 30, 60);
  if (limited) return limited;
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canSeeTasteMap(userId)) return NextResponse.json({ error: 'not available' }, { status: 403 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const parsed = parseNearbyQuery(req.nextUrl.searchParams.get('keys'), req.nextUrl.searchParams.get('w'));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const hash = createHash('sha1').update(nearbyQueryHash(parsed.value)).digest('hex');
  const key = `tastemap:nearby:v1:${userId}:${hash}`;
  const hit = await cacheGet<NearbyResponse>(key);
  if (hit) return NextResponse.json(hit);

  let res: NearbyResponse;
  try {
    res = await suggestNearby(db, userId, parsed.value);
  } catch (e) {
    console.error('[taste/map/nearby]', e);
    return NextResponse.json({ error: 'could not load suggestions' }, { status: 500 });
  }
  await cacheSet(key, res, CACHE_TTL);
  return NextResponse.json(res);
}
