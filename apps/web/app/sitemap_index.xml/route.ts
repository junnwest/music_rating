import { sitemapIds } from '../../lib/sitemapPages';

// Sitemap index (2026-11-16): one URL to submit to Google Search Console / Naver Search Advisor
// instead of every /sitemap/<id>.xml file. Next 14's generateSitemaps() splits the sitemap but
// doesn't generate an index, so this lists the same ids robots.txt does (lib/sitemapPages.ts).
// When the catalog grows into a new file, it shows up here without resubmitting anything.
//
// Not at /sitemap.xml: that path belongs to app/sitemap.ts's metadata route (the dev server
// serves the split files as /sitemap.xml/<id>), so a handler there would collide.
export const revalidate = 3600;

const BASE_URL = 'https://www.sillajuku.com';

export async function GET() {
  const ids = await sitemapIds();
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    ids.map((id) => `<sitemap><loc>${BASE_URL}/sitemap/${id}.xml</loc></sitemap>`).join('\n') +
    '\n</sitemapindex>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
