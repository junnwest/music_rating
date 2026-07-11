import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// Songs-mode Charts bundle. The songs RPCs aggregate over ~2.3M recordings
// and have a documented history of 57014 timeouts under the anon role
// (2026-07-01 check log) — the exact case for the service-role + cache
// treatment. Separate from /api/charts/summary so the default Albums view
// never pays for them.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 600;

interface SongsPayload {
  topRated: unknown[];
  mostRated: unknown[];
  trending: unknown[];
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'charts-songs', 30, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=3600`,
  };

  const key = 'charts:songs:v1';
  const cached = await cacheGet<SongsPayload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [topRes, mostRes, trendingRes] = await Promise.all([
    supabase.rpc('get_charts_top_rated_songs', { p_limit: 20 }),
    supabase.rpc('get_charts_most_rated_songs', { p_limit: 20 }),
    supabase.rpc('get_charts_trending_songs', { p_limit: 10 }),
  ]);
  for (const [name, res] of [
    ['top_rated_songs', topRes],
    ['most_rated_songs', mostRes],
    ['trending_songs', trendingRes],
  ] as const) {
    if (res.error) console.error(`[charts/songs] ${name} rpc error:`, res.error.message);
  }

  const payload: SongsPayload = {
    topRated: (topRes.data as unknown[] | null) ?? [],
    mostRated: (mostRes.data as unknown[] | null) ?? [],
    trending: (trendingRes.data as unknown[] | null) ?? [],
  };
  // Don't cache a fully-empty payload caused by all three RPCs erroring —
  // that would pin blank song charts for 10 minutes.
  const allFailed = topRes.error && mostRes.error && trendingRes.error;
  if (!allFailed) await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}
