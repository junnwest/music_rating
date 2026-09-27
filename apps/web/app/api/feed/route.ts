import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { FEED_SELECT, type FeedItemRow } from '../../../lib/sj/data';
import { inList, privateUserIds } from '../../../lib/privateAccounts';

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
  items: FeedItemRow[];
  likeCounts: Record<string, number>;
  commentCounts: Record<string, number>;
  followerCounts: Record<string, number>;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'feed', 60, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
  };

  const key = 'feed:explore:v3'; // review-rich candidate pool + author followers
  const cached = await cacheGet<FeedPayload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // Shared by every visitor, so private accounts are left out entirely
  // (their approved followers see them in the Following feed instead).
  const hidden = await privateUserIds(supabase);
  const publicRatings = () => {
    let q = supabase.from('ratings').select(FEED_SELECT);
    if (hidden.length > 0) q = q.not('user_id', 'in', inList(hidden));
    return q;
  };
  const [recent, reviewed] = await Promise.all([
    publicRatings().order('created_at', { ascending: false }).limit(150),
    publicRatings().not('review_text', 'is', null).neq('review_text', '').order('created_at', { ascending: false }).limit(120),
  ]);
  if (recent.error || reviewed.error) {
    console.error('[feed] pool query error:', recent.error?.message ?? reviewed.error?.message);
    return NextResponse.json({ error: 'feed unavailable' }, { status: 503 });
  }

  const byId = new Map<string, FeedItemRow>();
  for (const item of [
    ...((recent.data as unknown as FeedItemRow[] | null) ?? []),
    ...((reviewed.data as unknown as FeedItemRow[] | null) ?? []),
  ]) byId.set(item.id, item);
  const items = Array.from(byId.values());
  const ratingIds = items.map((i) => i.id);

  const likeCounts: Record<string, number> = {};
  const commentCounts: Record<string, number> = {};
  const followerCounts: Record<string, number> = {};
  const authors = Array.from(new Set(items.map((i) => i.user_id)));
  if (authors.length > 0) {
    const { data, error: followerError } = await supabase.rpc('get_feed_author_followers', { p_user_ids: authors });
    if (followerError) console.error('[feed] follower counts unavailable:', followerError.message);
    for (const row of (data as { user_id: string; followers: number }[] | null) ?? []) followerCounts[row.user_id] = Number(row.followers);
  }
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

  const payload: FeedPayload = { items, likeCounts, commentCounts, followerCounts };
  await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}
