import type { MetadataRoute } from 'next';

// RELAXED AT LAUNCH (was: blanket `disallow: '/'` while pre-launch, per the original comment
// here — app's since been submitted to the App Store and the "we are not indexing yet" premise
// no longer holds). Default-allow, explicit disallow for private/low-value paths, rather than an
// allowlist -- simpler and less likely to accidentally block a real content route.
//
// The original cost concern is still real: the app server-renders ~2.3M dynamic pages on demand
// (418k /album/[mbid] + ~1.9M /song/[trackId]), each running several Supabase queries. sitemap.ts
// intentionally does NOT enumerate the full catalog for the same reason — see that file for what
// it includes and why. Only well-behaved bots obey robots.txt at all (Googlebot/Bingbot/GPTBot/
// etc.) — abusive scrapers still need a WAF/rate limit regardless.
//
// AI_CRAWLER_BLOCKLIST (added 2026-07-30, after the sitemap's ~460k album+artist URLs blew
// through Vercel's free Fluid Active CPU tier): these bots are exactly the "well-behaved, obeys
// robots.txt" kind noted above, which is what makes blocking them actually work. None of them
// send real visitors back the way Googlebot/Bingbot's search placement does — they exist to feed
// AI training or answer-engine indexes — so disallowing them cuts real server-render load with no
// SEO cost. A named User-agent block is matched *instead of* the `*` block below, not in addition
// to it, so Googlebot/Bingbot/every other crawler not listed here keeps the normal allow rules.
// generateSitemaps() in sitemap.ts produces N+1 static files (/sitemap/0.xml..N.xml), not a
// single /sitemap.xml index -- Next doesn't auto-generate an index linking them, so every
// individual file has to be listed here directly (the sitemap protocol supports multiple
// Sitemap: lines; MetadataRoute.Robots's `sitemap` field accepts a string[] for exactly this).
// Mirrors sitemap.ts's own album-page-count math since there's no shared index file to read it
// from instead.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PAGE_SIZE = 45000;

async function albumPageCount(): Promise<number> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/release_groups?select=id`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0',
      },
      next: { revalidate: 3600 },
    });
    const contentRange = res.headers.get('content-range');
    const total = contentRange?.split('/')[1];
    const count = total && total !== '*' ? parseInt(total, 10) : 420000;
    return Math.max(1, Math.ceil(count / PAGE_SIZE));
  } catch {
    return Math.max(1, Math.ceil(420000 / PAGE_SIZE));
  }
}

// AI training / answer-engine crawlers, blocked outright (see the comment above
// albumPageCount for why). Not exhaustive — extend if a new one shows up in
// Vercel's function logs consuming meaningful CPU.
const AI_CRAWLER_BLOCKLIST = [
  'GPTBot',
  'ChatGPT-User',
  'Google-Extended',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Bytespider',
  'PerplexityBot',
  'Applebot-Extended',
  'meta-externalagent',
  'Diffbot',
  'Omgilibot',
  'Omgili',
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  // www, not the bare apex -- see layout.tsx's matching comment. Confirmed live: submitting the
  // apex version to Search Console showed "Couldn't fetch" (sillajuku.com 307-redirects to
  // www.sillajuku.com, and Google's sitemap fetcher doesn't reliably follow that hop).
  const pageCount = await albumPageCount();
  const sitemaps = ['https://www.sillajuku.com/sitemap/0.xml'];
  for (let i = 1; i <= pageCount; i++) {
    sitemaps.push(`https://www.sillajuku.com/sitemap/${i}.xml`);
  }

  return {
    rules: [
      {
        userAgent: '*',
        disallow: [
          '/api/',
          '/admin/',
          '/i/',
          '/settings',
          '/onboarding',
          '/auth/',
          '/login',
          '/notifications',
          '/taste',
          '/search',
        ],
      },
      ...AI_CRAWLER_BLOCKLIST.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
    sitemap: sitemaps,
  };
}
