import { NextResponse, type NextRequest } from 'next/server';

// Album and artist pages are cached on Vercel's CDN (ISR, 7 days) -- 2026-11-24. About 94% of
// all server work was crawlers rendering /album/[id] fresh on every request: those pages read the
// visitor's language from cookies/headers, which makes a Next page dynamic (uncacheable).
//
// The language is now decided here instead, and the request is rewritten internally to
// /album/<id>/<lang>, so each page has exactly two cacheable versions (en, ko). The browser URL
// doesn't change. Same rule as lib/i18n/server.ts getServerLang: the sj-lang cookie, else a
// Korean first Accept-Language (Naver's crawler sends one), else English.
//
// The internal /<lang> URLs aren't public: a request that arrives with that shape gets a 404,
// so crawlers can't index duplicate copies of every page.
const LANGS = new Set(['en', 'ko']);

function langFor(req: NextRequest): 'en' | 'ko' {
  const stored = req.cookies.get('sj-lang')?.value;
  if (stored === 'en' || stored === 'ko') return stored;
  const primary = (req.headers.get('accept-language') ?? '').split(',')[0]?.split(';')[0]?.trim() ?? '';
  return primary.startsWith('ko') ? 'ko' : 'en';
}

export function middleware(req: NextRequest) {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean); // ['album', id] or ['album', id, lang]
  if (parts.length === 2) {
    const url = req.nextUrl.clone();
    url.pathname = `/${parts[0]}/${parts[1]}/${langFor(req)}`;
    return NextResponse.rewrite(url);
  }
  if (parts.length === 3 && LANGS.has(parts[2])) {
    const url = req.nextUrl.clone();
    url.pathname = '/_not-found';
    return NextResponse.rewrite(url, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/album/:path*', '/artist/:path*'],
};
