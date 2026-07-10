import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { FEED_SELECT } from '../../../lib/sj/data';

// The Home explore pool is identical for every visitor, but each browser was
// running it live under the anon role (150-row ratings select with two embeds,
// plus full-row like/comment scans) against the Micro instance — the main
// reason the feed intermittently blanked under load. This route runs it once
// under the service role and caches the result (Redis + CDN), so the page
// load becomes a single cache hit. Per-user signals (follows, my likes/saves,
// blocks) stay client-side — they're cheap indexed lookups.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 60; // short — new ratings should surface within a minute

interface FeedPayload {
  items: unknown[];
  likeCounts: Record<string, number>;
  commentCounts: Record<string, number>;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'feed', 60, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
  };

  const key = 'feed:explore:v1';
  const cached = await cacheGet<FeedPayload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { data: pool, error } = await supabase
    .from('ratings')
    .select(FEED_SELECT)
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) {
    console.error('[feed] pool query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const items = (pool as unknown as { id: string }[] | null) ?? [];
  const ratingIds = items.map((i) => i.id);

  const likeCounts: Record<string, number> = {};
  const commentCounts: Record<string, number> = {};
  if (ratingIds.length > 0) {
    const [likesRes, commentsRes] = await Promise.all([
      supabase.from('rating_likes').select('rating_id').in('rating_id', ratingIds),
      supabase.from('rating_comments').select('rating_id').in('rating_id', ratingIds),
    ]);
    for (const r of (likesRes.data as { rating_id: string }[] | null) ?? []) {
      likeCounts[r.rating_id] = (likeCounts[r.rating_id] ?? 0) + 1;
    }
    for (const r of (commentsRes.data as { rating_id: string }[] | null) ?? []) {
      commentCounts[r.rating_id] = (commentCounts[r.rating_id] ?? 0) + 1;
    }
  }

  const payload: FeedPayload = { items, likeCounts, commentCounts };
  await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}
