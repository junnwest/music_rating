import { createClient } from '@supabase/supabase-js';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { rateLimit } from '../../../../lib/rateLimit';
import type { NextRequest } from 'next/server';

/**
 * Public, unauthenticated site-wide stats — currently just the total ratings
 * count, for the live number on /about. Cached in Redis (when configured) so
 * an unauthenticated, cacheable count doesn't run against the DB on every
 * page load; no-ops to a null count if Redis/Supabase env vars are missing
 * rather than faking a number.
 */
const CACHE_KEY = 'stats:public:ratings_count';
const CACHE_TTL = 600; // 10 minutes — doesn't need to be real-time to read as "live"

export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, 'public-stats', 30, 60);
  if (limited) return limited;

  const cached = await cacheGet<number>(CACHE_KEY);
  if (cached != null) {
    return Response.json({ ratingsCount: cached });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ ratingsCount: null }, { status: 503 });
  }

  const db = createClient(url, key);
  const { count, error } = await db.from('ratings').select('*', { count: 'exact', head: true });
  if (error || count == null) {
    return Response.json({ ratingsCount: null }, { status: 502 });
  }

  await cacheSet(CACHE_KEY, count, CACHE_TTL);
  return Response.json({ ratingsCount: count });
}
