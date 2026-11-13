import type { MetadataRoute } from 'next';
import {
  ALBUM_COUNT_FALLBACK,
  ARTIST_COUNT_FALLBACK,
  ARTIST_OVERFLOW_BASE,
  SITEMAP_PAGE_SIZE as PAGE_SIZE,
  sitemapIds,
  tableCount as fetchCount,
} from '../lib/sitemapPages';

// Companion to the robots.ts relaxation -- feeds Google the pages actually worth proactively
// discovering, without inviting an immediate mass-crawl of the full catalog (the same "~2.3M
// dynamic pages, each a real Supabase-backed render" cost concern robots.ts documents).
//
// Included: static content pages, every artist (~114k rows), every album (~814k rows), each
// paginated into 45k-row sitemap files per Google's 50k/file limit. See lib/sitemapPages.ts for
// which id holds what.
//
// Deliberately EXCLUDED: individual song (/song/[id]) pages. recordings is ~3.16M rows -- by far
// the largest and (for a search query) lowest marginal-value content type here, since someone
// searching a song title is generally well-served by ranking on the *album* page instead. Songs
// are still crawlable (robots.ts no longer disallows them) -- just not proactively pushed, so
// discovery happens gradually by Google following links from album pages rather than all at once.
// Revisit if per-song search traffic turns out to matter once there's real Search Console data.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// www, not the bare apex -- see layout.tsx's matching comment. Every URL listed in these
// sitemaps needs to resolve directly, with no redirect hop, for Google's sitemap fetcher.
const BASE_URL = 'https://www.sillajuku.com';
const REST_CHUNK = 1000; // conservative assumption for PostgREST's default max rows/request

const STATIC_PATHS: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/charts', priority: 0.8 },
  { path: '/charts/top-rated', priority: 0.7 },
  { path: '/charts/most-rated', priority: 0.7 },
  { path: '/charts/hidden-gems', priority: 0.7 },
  { path: '/charts/controversial', priority: 0.6 },
  { path: '/charts/trending', priority: 0.7 },
  { path: '/help', priority: 0.3 },
  { path: '/terms', priority: 0.2 },
  { path: '/privacy', priority: 0.2 },
];

const CONCURRENCY = 8; // batch chunk fetches instead of firing all at once (see note below)

// `limit` must already be clamped to the real remaining row count by the caller -- firing
// requests for ranges known to be past the end of the table (e.g. the last, partial sitemap
// page naively requesting a full PAGE_SIZE) was silently dropping rows from EARLIER, perfectly
// valid chunks in the same batch (confirmed live: 45 parallel chunk requests where only ~9 were
// actually in range returned just 2 chunks' worth of data, not the ~9 expected) -- whether that's
// PostgREST's own response to an out-of-range Range header or something rate-limiting the burst,
// avoiding it entirely was more robust than chasing the exact mechanism. Batching the concurrency
// (instead of Promise.all-ing every chunk at once) is extra headroom against the same class of
// issue recurring at the full, in-range PAGE_SIZE.
async function fetchIdRange(table: string, offset: number, limit: number): Promise<string[]> {
  const chunkStarts: number[] = [];
  for (let i = 0; i < limit; i += REST_CHUNK) chunkStarts.push(offset + i);

  const results: string[] = [];
  for (let i = 0; i < chunkStarts.length; i += CONCURRENCY) {
    const batch = chunkStarts.slice(i, i + CONCURRENCY);
    const chunks = await Promise.all(
      batch.map(async (from) => {
        const to = Math.min(from + REST_CHUNK, offset + limit) - 1;
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&order=id.asc`, {
            headers: {
              apikey: ANON_KEY,
              Authorization: `Bearer ${ANON_KEY}`,
              Range: `${from}-${to}`,
            },
            next: { revalidate: 3600 },
          });
          const rows: { id: string }[] = await res.json();
          return Array.isArray(rows) ? rows.map((r) => r.id) : [];
        } catch {
          return [];
        }
      })
    );
    results.push(...chunks.flat());
  }
  return results;
}

export async function generateSitemaps() {
  return (await sitemapIds()).map((id) => ({ id }));
}

async function artistEntries(page: number): Promise<MetadataRoute.Sitemap> {
  const artistCount = await fetchCount('artists', ARTIST_COUNT_FALLBACK);
  const offset = page * PAGE_SIZE;
  const limit = Math.max(0, Math.min(PAGE_SIZE, artistCount - offset));
  const artistIds = await fetchIdRange('artists', offset, limit);
  return artistIds.map((artistId) => ({
    url: `${BASE_URL}/artist/${artistId}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));
}

export default async function sitemap({ id: rawId }: { id: number | string }): Promise<MetadataRoute.Sitemap> {
  const id = Number(rawId);

  if (id === 0) {
    const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, priority }) => ({
      url: `${BASE_URL}${path}`,
      changeFrequency: 'daily',
      priority,
    }));
    return [...staticEntries, ...(await artistEntries(0))];
  }

  if (id > ARTIST_OVERFLOW_BASE) return artistEntries(id - ARTIST_OVERFLOW_BASE);

  const offset = (id - 1) * PAGE_SIZE;
  const albumCount = await fetchCount('release_groups', ALBUM_COUNT_FALLBACK);
  const limit = Math.max(0, Math.min(PAGE_SIZE, albumCount - offset));
  const albumIds = await fetchIdRange('release_groups', offset, limit);
  return albumIds.map((albumId) => ({
    url: `${BASE_URL}/album/${albumId}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));
}
