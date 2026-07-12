import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { rateLimit } from '../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../lib/cache';

// Global (non-personalized) Add-page discovery rows, served once under the
// service role and cached — the same treatment /api/feed gave the Home feed.
// Previously each visitor ran these live under the anon role, and both rows
// were misdefined:
//   * "Popular" was ORDER BY first_release_date DESC — a new-releases feed of
//     whatever the pipeline last ingested, zero popularity signal. Now split
//     honestly: `popular` = prestige-ranked canon, `newReleases` = the
//     newest-first list under its real name.
//   * "Trending" counted the 500 most recent ratings with no bot filter —
//     and 99.2% of last-30-days ratings are bot ratings (7,653 vs 59 real,
//     measured 2026-07-12), so the row tracked bot activity. Now a weighted
//     blend: a real-user rating counts REAL_WEIGHT× a bot rating, so genuine
//     activity dominates wherever it exists while bot-rated canon still fills
//     the row until real volume grows.
//
// Per-user filtering (already-rated ids + ≤1.5★ blocked artists) stays
// client-side via the search page's visible() — this payload is identical for
// everyone, so it CDN-caches cleanly.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 600;
const REAL_WEIGHT = 20; // one real rating outweighs 20 bot ratings in trending
const TRENDING_WINDOW_DAYS = 30;
const TRENDING_SIZE = 25;

const RG_COLS =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title';

interface Payload {
  popular: unknown[];
  newReleases: unknown[];
  trending: unknown[];
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'discovery', 60, 60);
  if (limited) return limited;

  const cdnHeaders = {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  };

  const key = 'discovery:v1';
  const cached = await cacheGet<Payload>(key);
  if (cached) return NextResponse.json(cached, { headers: cdnHeaders });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const cutoff = new Date(Date.now() - TRENDING_WINDOW_DAYS * 86400e3).toISOString();
  const [popularRes, newReleasesRes, trendingRatingsRes] = await Promise.all([
    supabase
      .from('release_groups')
      .select(RG_COLS)
      .not('prestige_score', 'is', null)
      .in('release_group_type', ['album', 'ep'])
      .not('cover_url', 'is', null)
      .order('prestige_score', { ascending: false })
      .limit(50),
    supabase
      .from('release_groups')
      .select(RG_COLS)
      .in('release_group_type', ['album', 'ep'])
      .not('cover_url', 'is', null)
      .order('first_release_date', { ascending: false, nullsFirst: false })
      .limit(50),
    // Skinny rows; ~8k/month at current volume, fetched once per cache TTL.
    supabase
      .from('ratings')
      .select('release_group_id, profiles!ratings_user_id_fkey!inner(is_bot)')
      .gt('created_at', cutoff)
      .limit(10000),
  ]);

  for (const res of [popularRes, newReleasesRes, trendingRatingsRes]) {
    if (res.error) {
      // Never cache a payload with an errored section (house rule from /api/feed).
      console.error('[discovery] query error:', res.error.message);
      return NextResponse.json({ error: res.error.message }, { status: 503 });
    }
  }

  const scores = new Map<string, number>();
  for (const row of (trendingRatingsRes.data as unknown as {
    release_group_id: string;
    profiles: { is_bot: boolean | null } | null;
  }[]) ?? []) {
    const w = row.profiles?.is_bot ? 1 : REAL_WEIGHT;
    scores.set(row.release_group_id, (scores.get(row.release_group_id) ?? 0) + w);
  }
  const trendingIds = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TRENDING_SIZE * 2) // over-fetch: singles/coverless rows drop below
    .map(([id]) => id);

  let trending: unknown[] = [];
  if (trendingIds.length > 0) {
    const { data: rows, error } = await supabase
      .from('release_groups')
      .select(RG_COLS)
      .in('id', trendingIds)
      .neq('release_group_type', 'single')
      .not('cover_url', 'is', null);
    if (error) {
      console.error('[discovery] trending fetch error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const byId = new Map((rows ?? []).map((r: { id: string }) => [r.id, r]));
    trending = trendingIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .slice(0, TRENDING_SIZE) as unknown[];
  }

  const payload: Payload = {
    popular: popularRes.data ?? [],
    newReleases: newReleasesRes.data ?? [],
    trending,
  };
  await cacheSet(key, payload, TTL_SECONDS);
  return NextResponse.json(payload, { headers: cdnHeaders });
}
