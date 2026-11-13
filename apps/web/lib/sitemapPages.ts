// Shared by app/sitemap.ts (which renders each file) and app/robots.ts (which has to list every
// file, since Next doesn't generate a sitemap index for generateSitemaps()). Keeping the id math
// in one place means robots.txt can't drift out of sync with the files that actually exist.
//
// Sitemap ids:
//   0            static pages + artists [0, 45k)
//   1..N         albums, 45k per file (unchanged since launch, so already-known URLs stay put)
//   1001..1000+M artists beyond the first 45k, 45k per file
// Artist overflow starts at a fixed 1001 rather than right after the album pages so its ids
// don't shift whenever the album count crosses a 45k boundary.
//
// Before 2026-11-12 every artist went into file 0, which was fine at ~49k artists but had grown
// to 114k URLs -- over Google's 50,000-URL-per-file limit, so the whole file (homepage and charts
// included) was likely being rejected.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const SITEMAP_PAGE_SIZE = 45000; // headroom under Google's 50,000-URL-per-file limit
export const ARTIST_OVERFLOW_BASE = 1000;
export const ALBUM_COUNT_FALLBACK = 420000;
export const ARTIST_COUNT_FALLBACK = 120000;

export async function tableCount(table: string, fallback: number): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0',
      },
      next: { revalidate: 3600 },
    });
    const total = res.headers.get('content-range')?.split('/')[1];
    return total && total !== '*' ? parseInt(total, 10) : fallback;
  } catch {
    return fallback;
  }
}

/** Every sitemap id that has content, in the order robots.txt lists them. */
export async function sitemapIds(): Promise<number[]> {
  const [albumCount, artistCount] = await Promise.all([
    tableCount('release_groups', ALBUM_COUNT_FALLBACK),
    tableCount('artists', ARTIST_COUNT_FALLBACK),
  ]);
  const albumPages = Math.max(1, Math.ceil(albumCount / SITEMAP_PAGE_SIZE));
  // Artist page 0 lives in sitemap 0; only the rest need overflow files.
  const artistOverflowPages = Math.max(0, Math.ceil(artistCount / SITEMAP_PAGE_SIZE) - 1);
  return [
    0,
    ...Array.from({ length: albumPages }, (_, i) => i + 1),
    ...Array.from({ length: artistOverflowPages }, (_, i) => ARTIST_OVERFLOW_BASE + i + 1),
  ];
}
