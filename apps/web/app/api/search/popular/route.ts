import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';

// Cross-user "Popular Searches" chips for the search page's empty-query
// state. Mirrors /api/discovery's own shape (rate limit -> Redis cache ->
// recompute via RPC -> re-cache -> CDN headers) rather than inventing a new
// pattern for what's the same class of "global, cacheable, non-personalized
// aggregate" payload.
export const dynamic = 'force-dynamic';

const TTL_SECONDS = 600;
const POPULAR_SEARCH_DAYS = 7;
const POPULAR_SEARCH_LIMIT = 12;
// Below this, current real search-traffic volume (see get_popular_searches'
// own migration comment) may only produce a couple of sparse/stale-feeling
// entries -- hide the row entirely rather than show a half-empty one.
const MIN_TO_SHOW = 6;

interface Payload {
  queries: string[];
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'search-popular', 60, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  };

  const key = 'search:popular:v2'; // v2: artists/releases only (20260926000001)
  const cached = await cacheGet<Payload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { data, error } = await supabase.rpc('get_popular_searches', {
    lim: POPULAR_SEARCH_LIMIT,
    days: POPULAR_SEARCH_DAYS,
  });
  if (error) {
    console.error('[search/popular] rpc error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const rows = (data as { query: string; search_count: number }[] | null) ?? [];
  const payload: Payload = { queries: rows.length >= MIN_TO_SHOW ? rows.map((r) => r.query) : [] };

  await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}

// Query-log write side. Routed through the server (service role) rather than
// a raw client-side `supabase.from('search_query_log').insert(...)` —
// confirmed live that a logged-out (anon-role) client insert is rejected by
// RLS on this project (`new row violates row-level security policy`), and
// search_misses' own real write path (logSearchMiss, app/api/search/route.ts)
// already avoids this exact trap the same way, for what's structurally the
// same kind of write. Fire-and-forget from the client — failure here is
// harmless telemetry, same spirit as search_misses.
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'search-popular-log', 30, 60);
  if (limited) return limited;

  let body: { query?: unknown; platform?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 2 || query.length > 200) {
    return NextResponse.json({ error: 'invalid query' }, { status: 400 });
  }
  const platform = body.platform === 'ios' ? 'ios' : 'web';

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { error } = await supabase.from('search_query_log').insert({ query, platform });
  if (error) {
    console.error('[search/popular] log insert error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
