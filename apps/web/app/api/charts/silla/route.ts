import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// The Silla leaderboard RPC does live bayesian calibration over all ratings
// and runs ~7s — over the anon role's 3s statement timeout, so browser-side
// calls always died with 57014. This route runs it under the service role
// (8s budget) and caches the result, so after the first hit per filter combo
// everyone gets it instantly.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 900; // 15 min — silla scores move slowly

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'charts-silla', 30, 60);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const genre = sp.get('genre') || null;
  const country = sp.get('country') || null;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '10', 10) || 10, 1), 100);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);

  const cdnHeaders = {
    // Vercel edge caches this per-URL too, serving stale while revalidating —
    // most visitors never even reach Redis.
    'Cache-Control': `public, s-maxage=${TTL_SECONDS}, stale-while-revalidate=3600`,
  };

  const key = `charts:silla:${genre ?? '-'}:${country ?? '-'}:${limit}:${offset}`;
  const cached = await cacheGet<unknown[]>(key);
  if (cached) return NextResponse.json({ entries: cached }, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { data, error } = await supabase.rpc('get_silla_leaderboard', {
    p_genre: genre,
    p_country: country,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.error('[charts/silla] rpc error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const entries = data ?? [];
  await cacheSet(key, entries, TTL_SECONDS);
  return NextResponse.json({ entries }, { headers: cdnHeaders });
}
