import type { MetadataRoute } from 'next';

// PRE-LAUNCH: block all crawlers.
//
// The app server-renders ~2.3M dynamic pages on demand (418k /album/[mbid] +
// ~1.9M /song/[trackId], plus force-dynamic home/genre/rankings). Each render
// runs several Supabase queries (album pages also compute Silla scores in JS),
// and an open crawl of every unique URL was burning Vercel "Fluid Active CPU"
// with zero user benefit — we are not indexing yet. Redis/ISR can't help a
// one-time crawl since every URL is a unique cold render.
//
// ⚠️ RELAX AT LAUNCH: allow `/` (and the public content paths you want indexed),
// add a sitemap, and consider keeping deep paths (/song) disallowed or rate-
// limited if crawl CPU is still a concern. Note: only well-behaved bots obey
// this (Googlebot/Bingbot/GPTBot/etc.) — abusive scrapers need a WAF/rate limit.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
