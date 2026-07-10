import type {
  ChartRankedRPC,
  ChartTrendingRPC,
  ChartsPulseRPC,
  RankingsUnlockStatusRPC,
  SongChartRPC,
  TrendingSongRPC,
} from '../db/types';
import type { FeedItemRow } from './data';

/**
 * Fetchers for the cached server routes (/api/feed, /api/charts/summary,
 * /api/charts/songs). Each route runs the underlying queries once under the
 * service role and caches at Redis + the CDN — pages call these instead of
 * live per-visitor anon RPCs. All throw on a non-OK response; callers fall
 * back to their direct-query path so a route outage never blanks a page.
 */

export interface FeedPayload {
  items: FeedItemRow[];
  likeCounts: Record<string, number>;
  commentCounts: Record<string, number>;
}

export async function fetchFeed(): Promise<FeedPayload> {
  const res = await fetch('/api/feed');
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return (await res.json()) as FeedPayload;
}

export interface ChartsSummaryPayload {
  unlock: RankingsUnlockStatusRPC | null;
  pulse: ChartsPulseRPC | null;
  mostRated: ChartRankedRPC[];
  trending: ChartTrendingRPC[];
}

export async function fetchChartsSummary(): Promise<ChartsSummaryPayload> {
  const res = await fetch('/api/charts/summary');
  if (!res.ok) throw new Error(`charts summary ${res.status}`);
  return (await res.json()) as ChartsSummaryPayload;
}

export interface ChartsSongsPayload {
  topRated: SongChartRPC[];
  mostRated: SongChartRPC[];
  trending: TrendingSongRPC[];
}

export async function fetchChartsSongs(): Promise<ChartsSongsPayload> {
  const res = await fetch('/api/charts/songs');
  if (!res.ok) throw new Error(`charts songs ${res.status}`);
  return (await res.json()) as ChartsSongsPayload;
}
