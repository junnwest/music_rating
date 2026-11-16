import type { MetadataRoute } from 'next';
import { ARTIST_OVERFLOW_BASE, idsInSlice, sitemapIds, sliceCounts } from '../lib/sitemapPages';

// Companion to the robots.ts relaxation -- feeds Google the pages actually worth proactively
// discovering, without inviting an immediate mass-crawl of the full catalog (the same "~2.3M
// dynamic pages, each a real Supabase-backed render" cost concern robots.ts documents).
//
// Included: static content pages, every artist (~114k rows), every album (~814k rows), each split
// into ~40k-URL files (Google's limit is 50k/file) by uuid range. See lib/sitemapPages.ts for
// which id holds what and why it's by uuid range, not row offset.
//
// Deliberately EXCLUDED: individual song (/song/[id]) pages. recordings is ~3.16M rows -- by far
// the largest and (for a search query) lowest marginal-value content type here, since someone
// searching a song title is generally well-served by ranking on the *album* page instead. Songs
// are still crawlable (robots.ts no longer disallows them) -- just not proactively pushed, so
// discovery happens gradually by Google following links from album pages rather than all at once.
// Revisit if per-song search traffic turns out to matter once there's real Search Console data.
// www, not the bare apex -- see layout.tsx's matching comment. Every URL listed in these
// sitemaps needs to resolve directly, with no redirect hop, for Google's sitemap fetcher.
const BASE_URL = 'https://www.sillajuku.com';

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

export async function generateSitemaps() {
  return (await sitemapIds()).map((id) => ({ id }));
}

async function artistEntries(slice: number): Promise<MetadataRoute.Sitemap> {
  const { artistSlices } = await sliceCounts();
  if (slice >= artistSlices) return [];
  const artistIds = await idsInSlice('artists', slice, artistSlices);
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

  const { albumSlices } = await sliceCounts();
  if (id > albumSlices) return [];
  const albumIds = await idsInSlice('release_groups', id - 1, albumSlices);
  return albumIds.map((albumId) => ({
    url: `${BASE_URL}/album/${albumId}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));
}
