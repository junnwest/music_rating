import type { SillaLeaderboardRPC } from '../db/types';

/**
 * Fetch the Silla leaderboard via the cached API route (/api/charts/silla).
 * The RPC itself runs ~7s of live bayesian calibration — over the browser's
 * 3s anon statement timeout — so it runs server-side under the service role
 * and is cached (Redis + CDN, 15 min). Results are also memoized here per
 * filter combo so switching filters back within a session is instant.
 */
const clientCache = new Map<string, SillaLeaderboardRPC[]>();

export async function fetchSillaLeaderboard(
  genre: string | null,
  country: string | null,
  limit: number,
): Promise<SillaLeaderboardRPC[]> {
  const key = `${genre ?? '-'}|${country ?? '-'}|${limit}`;
  const hit = clientCache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({ limit: String(limit) });
  if (genre) params.set('genre', genre);
  if (country) params.set('country', country);
  const res = await fetch(`/api/charts/silla?${params}`);
  if (!res.ok) throw new Error(`silla ${res.status}`);
  const body = (await res.json()) as { entries?: SillaLeaderboardRPC[] };
  const rows = body.entries ?? [];
  clientCache.set(key, rows);
  return rows;
}
