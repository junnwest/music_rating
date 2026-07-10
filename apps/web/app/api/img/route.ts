import type { NextRequest } from 'next/server';

// Caching image proxy for release covers.
//
// ~95% of the catalog's cover_url values are Cover Art Archive
// (coverartarchive.org), whose URLs 307-redirect to archive.org and take
// 1.5–2.5s on first load — the dominant cause of slow covers in the app. This
// route follows the redirect ONCE, server-side, and returns the bytes with a
// long immutable cache, so the Vercel edge CDN caches each image and every
// client after the first gets an instant edge hit (no redirect, no archive.org
// round-trip). iTunes/Deezer are already fast CDNs and are left direct on the
// client — only CAA/archive.org URLs are routed here (see iOS `thumbnailUrl`).

// Node runtime, not edge: archive.org rejects requests from Vercel's edge
// POPs (hard 502s in prod — flagged 2026-07-08); the serverless egress IPs
// get through. Edge caching of the response is unaffected (s-maxage below).
export const runtime = 'nodejs';
export const maxDuration = 15;

// SSRF guard: only proxy the known cover-art image hosts.
const ALLOWED = ['coverartarchive.org', 'archive.org', 'mzstatic.com', 'dzcdn.net'];
const hostAllowed = (h: string) => ALLOWED.some((d) => h === d || h.endsWith('.' + d));

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) return new Response('missing url', { status: 400 });

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (u.protocol !== 'https:' || !hostAllowed(u.hostname)) {
    return new Response('forbidden host', { status: 403 });
  }

  // CAA/archive.org fails transiently on cold requests (observed: first hit
  // 502s, the immediate retry returns the image) — retry twice with backoff,
  // and cap each attempt so one hung socket can't eat the whole maxDuration.
  // With the year-long edge cache below, each image only ever needs to
  // succeed once.
  let upstream: Response | null = null;
  const backoff = [250, 750];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u.toString(), {
        headers: { 'User-Agent': 'sillajuku-cover-proxy/1.0', Accept: 'image/*' },
        // follows the CAA 307 -> archive.org redirect automatically
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        upstream = res;
        break;
      }
      if (res.status === 404) {
        // No art exists — cache the miss at the edge so repeat views of the
        // same coverless release don't re-hit CAA (client falls back anyway).
        return new Response('not found', {
          status: 404,
          headers: { 'Cache-Control': 'public, s-maxage=86400' },
        });
      }
    } catch {
      /* retry */
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, backoff[attempt]));
  }
  if (!upstream) {
    // All attempts failed — hand the browser the direct URL instead of a dead
    // 502. CSP/remotePatterns already allow *.archive.org, so the <img> still
    // renders (slower) without waiting for the client-side onError ladder.
    // Not cached: the next viewer should retry the proxy path.
    return new Response(null, {
      status: 302,
      headers: { Location: u.toString(), 'Cache-Control': 'no-store' },
    });
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return new Response('not an image', { status: 415 });
  }

  // The image for a given CAA URL never changes -> cache for a year, immutable.
  // s-maxage caches at the Vercel edge; max-age caches on the client / URLCache.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
    },
  });
}
