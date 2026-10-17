import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../lib/authGuard';
import { rateLimit } from '../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { computeRecommendations } from '../../../lib/taste/recommendations';

// Personalized recommendations powering the Add page's discovery sections.
// The ranking lives in lib/taste/recommendations.ts (2026-10-17: rebuilt on the
// Taste tab's language-qualified worlds — see that file); this route only does
// auth, rate limiting and the per-user Redis cache.
//
// Response sections:
//   fromYourTaste  — newest albums by artists the user loves (exploit)
//   forYou         — new-to-you albums split across the user's liked taste
//                    worlds (adventurousness-mixed)
//   worlds[]       — one row per big taste world ("Because you love Korean
//                    Hip-Hop"), deduped against the rows above; `labelKo` too
//   blockedArtists — artists with any rating ≤ 1.5, for client-side filtering
//                    of the globally-cached rows (Popular/Trending)
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 120;

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'recs', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Pull-to-refresh: skip the cache and draw a different selection of strong fits.
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  // v5: 2026-10-17 ranking moved onto the taste map (worlds × language)
  const cacheKey = `recs:v5:${userId}`;
  if (!refresh) {
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  try {
    const { payload } = await computeRecommendations(supabase, userId, { vary: refresh });
    await cacheSet(cacheKey, payload, TTL_SECONDS);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[recs] failed:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
