import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { buildTasteMapPayload } from '../../../../lib/tasteMap/payload';
import type { TasteMapPayload } from '../../../../lib/tasteMap/types';

// The 3D/2D taste map (TASTE_MAP_PLAN.md, Phase 2). One payload for web and iOS,
// built in lib/tasteMap/payload.ts (Node, Micro-instance rule). Cached per input
// hash, so a new rating, pin or era override re-solves and anything else is a
// cache hit; `?refresh=1` forces a re-solve.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CACHE_TTL = 600;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-map', 20, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = createServerClient();
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const result = await buildTasteMapPayload(db, userId, {
    persist: true,
    cached: refresh ? undefined : (hash) => cacheGet<TasteMapPayload>(cacheKey(userId, hash)),
  });
  if (result.kind === 'too-few') {
    return NextResponse.json({ error: 'not enough ratings', needed: result.needed, have: result.have }, { status: 422 });
  }
  if (!result.cached) await cacheSet(cacheKey(userId, result.inputHash), result.payload, CACHE_TTL);
  return NextResponse.json(result.payload);
}

function cacheKey(userId: string, inputHash: string): string {
  return `tastemap:v1:${userId}:${inputHash}`;
}
