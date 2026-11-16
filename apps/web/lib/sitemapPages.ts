// Shared by app/sitemap.ts (which renders each file) and app/robots.ts (which has to list every
// file, since Next doesn't generate a sitemap index for generateSitemaps()). Keeping the id math
// in one place means robots.txt can't drift out of sync with the files that actually exist.
//
// Sitemap ids:
//   0            static pages + artist slice 0
//   1..N         album slices
//   1001..1000+M artist slices 1..M
//
// Files are slices of the uuid keyspace, not row offsets (2026-11-16). Both tables use random
// uuids, so N equal slices of the id space hold ~count/N rows each (±1% at these sizes). Each
// slice is read with index range scans (`id >= lo AND id < hi`), which stay fast at any depth.
// The previous version paged with Range offsets (`ORDER BY id OFFSET 400000`), which has to walk
// every skipped row: past ~300k rows that exceeded the anon role's 3s statement timeout, the error
// was swallowed, and album sitemaps 9-18 had been served EMPTY (Naver rejected them; Google got
// zero URLs). Artists were at 2.5s at offset 100k, about to hit the same wall.
//
// Before 2026-11-12 every artist went into file 0 (114k URLs, over Google's 50k-per-file limit).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Average URLs per file; random-uuid slices vary by well under 1k, far below the 50k limit. */
export const TARGET_PER_FILE = 40000;
export const ARTIST_OVERFLOW_BASE = 1000;
export const ALBUM_COUNT_FALLBACK = 820000;
export const ARTIST_COUNT_FALLBACK = 115000;

const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

/**
 * Row count, `count=estimated`: exact below PostgREST's threshold, else the planner's estimate.
 * Only decides how many slices to cut, so an approximate count is fine -- and an exact count of
 * 800k rows risks the same statement timeout.
 */
export async function tableCount(table: string, fallback: number): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
      headers: { ...headers, Prefer: 'count=estimated', 'Range-Unit': 'items', Range: '0-0' },
      next: { revalidate: 3600 },
    });
    const total = res.headers.get('content-range')?.split('/')[1];
    const n = total && total !== '*' ? parseInt(total, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function sliceCounts(): Promise<{ albumSlices: number; artistSlices: number }> {
  const [albumCount, artistCount] = await Promise.all([
    tableCount('release_groups', ALBUM_COUNT_FALLBACK),
    tableCount('artists', ARTIST_COUNT_FALLBACK),
  ]);
  return {
    albumSlices: Math.max(1, Math.ceil(albumCount / TARGET_PER_FILE)),
    artistSlices: Math.max(1, Math.ceil(artistCount / TARGET_PER_FILE)),
  };
}

/** Every sitemap id that has content, in the order robots.txt lists them. */
export async function sitemapIds(): Promise<number[]> {
  const { albumSlices, artistSlices } = await sliceCounts();
  return [
    0,
    ...Array.from({ length: albumSlices }, (_, i) => i + 1),
    ...Array.from({ length: artistSlices - 1 }, (_, i) => ARTIST_OVERFLOW_BASE + i + 1),
  ];
}

const SPACE = 2 ** 32; // slice on the first 32 bits of the uuid

/** Lower bound uuid of part k of n (n parts of the keyspace); part n's bound is "no bound". */
function bound(k: number, n: number): string | null {
  if (k >= n) return null;
  const v = Math.floor((k * SPACE) / n);
  return `${v.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
}

const SUB_SLICES = 64; // per file: ~600 rows each, usually one request
const PAGE = 1000; // PostgREST max rows per request (conservative)
const CONCURRENCY = 8;

/** All ids in [lo, hi) by keyset pagination (id > last), each request an index range scan. */
async function idsBetween(table: string, lo: string, hi: string | null): Promise<string[]> {
  const out: string[] = [];
  let after: string | null = null;
  for (;;) {
    const params = [`select=id`, `order=id.asc`, `limit=${PAGE}`, after ? `id=gt.${after}` : `id=gte.${lo}`];
    if (hi) params.push(`id=lt.${hi}`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params.join('&')}`, {
      headers,
      next: { revalidate: 3600 },
    });
    // Throw rather than return a short list: a failed sitemap is retried by crawlers, an empty
    // or partial one is stored as the truth.
    if (!res.ok) throw new Error(`[sitemap] ${table} ${lo}..${hi ?? 'end'}: HTTP ${res.status}`);
    const rows = (await res.json()) as { id: string }[];
    for (const r of rows) out.push(r.id);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].id;
  }
}

/** Every id in slice `slice` of `slices` equal slices of the uuid keyspace, ascending. */
export async function idsInSlice(table: string, slice: number, slices: number): Promise<string[]> {
  const parts = slices * SUB_SLICES;
  const ks = Array.from({ length: SUB_SLICES }, (_, j) => slice * SUB_SLICES + j);
  const results: string[][] = new Array(ks.length);
  for (let i = 0; i < ks.length; i += CONCURRENCY) {
    const batch = ks.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map((k) => idsBetween(table, bound(k, parts)!, bound(k + 1, parts))));
    got.forEach((ids, j) => (results[i + j] = ids));
  }
  return results.flat();
}
