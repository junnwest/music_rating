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

export const runtime = 'edge';

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

  let upstream: Response;
  try {
    upstream = await fetch(u.toString(), {
      headers: { 'User-Agent': 'sillajuku-cover-proxy/1.0' },
      // follows the CAA 307 -> archive.org redirect automatically
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
  if (!upstream.ok) {
    return new Response('upstream error', { status: upstream.status === 404 ? 404 : 502 });
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
