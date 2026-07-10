import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// Albums-mode Charts bundle: unlock status + pulse + most-rated + trending.
// These four RPCs are identical for every visitor but were each running live
// under the anon role (3s statement-timeout budget) per page view — any DB
// hiccup blanked a section. One service-role pass, cached in Redis + at the
// CDN, gives every visitor after the first an instant, stable payload.
// (Same treatment /api/charts/silla already got.)
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 300; // charts move on rating cadence, not seconds

interface SummaryPayload {
  unlock: unknown | null;
  pulse: unknown | null;
  mostRated: unknown[];
  trending: unknown[];
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'charts-summary', 30, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=3600`,
  };

  const key = 'charts:summary:v1';
  const cached = await cacheGet<SummaryPayload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [unlockRes, pulseRes, mostRatedRes, trendingRes] = await Promise.all([
    supabase.rpc('get_rankings_unlock_status'),
    supabase.rpc('get_charts_pulse'),
    supabase.rpc('get_charts_most_rated', { p_limit: 20 }),
    supabase.rpc('get_charts_trending', { p_limit: 5 }),
  ]);

  // The unlock gauge gates the whole Charts layout — if that RPC failed,
  // return an error rather than caching a payload that would lock the page.
  if (unlockRes.error) {
    console.error('[charts/summary] unlock rpc error:', unlockRes.error.message);
    return NextResponse.json({ error: unlockRes.error.message }, { status: 503 });
  }
  for (const [name, res] of [
    ['pulse', pulseRes],
    ['most_rated', mostRatedRes],
    ['trending', trendingRes],
  ] as const) {
    if (res.error) console.error(`[charts/summary] ${name} rpc error:`, res.error.message);
  }

  const payload: SummaryPayload = {
    unlock: (unlockRes.data as unknown[] | null)?.[0] ?? null,
    pulse: (pulseRes.data as unknown[] | null)?.[0] ?? null,
    mostRated: (mostRatedRes.data as unknown[] | null) ?? [],
    trending: (trendingRes.data as unknown[] | null) ?? [],
  };
  // Only cache a fully-healthy payload — a section blanked by a transient RPC
  // error must not be pinned for the whole TTL.
  const anyFailed = pulseRes.error || mostRatedRes.error || trendingRes.error;
  if (!anyFailed) await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}
