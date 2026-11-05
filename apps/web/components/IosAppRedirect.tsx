'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * On an iPhone, send a visitor to the app if it is installed, otherwise to the App Store.
 *
 * A web page cannot ask iOS whether an app is installed, so this does the standard try-then-fall-back:
 * navigate to the app's custom scheme (sillajuku://open), and if the page is still visible ~2.5 s later
 * the app did not open, so go to the App Store. If the app did open, Safari is backgrounded, the page
 * goes hidden, and the fallback is cancelled.
 *
 * Runs once per browser session (sessionStorage), so someone who comes back from the App Store or
 * chooses to stay on the web can browse without being bounced on every page. ?web=1 opts out for good
 * (localStorage) — useful for testing and for anyone who wants the website.
 *
 * Skipped on routes that must work in the browser: invite/beta links (they hand off via the clipboard
 * and redirect themselves), auth callbacks, admin, and the legal/help pages App Review opens on a phone.
 */
const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/us/app/sillajuku/id6785741603';
const APP_URL = 'sillajuku://open';
const FALLBACK_MS = 2500;
const SESSION_KEY = 'sj-app-redirect-tried';
const OPT_OUT_KEY = 'sj-app-redirect-off';
const SKIP_PREFIXES = ['/i/', '/beta', '/auth', '/login', '/admin', '/privacy', '/terms', '/help', '/api'];

function storage(kind: 'session' | 'local') {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export default function IosAppRedirect() {
  const pathname = usePathname() ?? '/';

  useEffect(() => {
    const ua = navigator.userAgent;
    if (!/iPhone|iPod/.test(ua) || /bot|crawl|spider|preview/i.test(ua)) return;
    if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return;

    const session = storage('session');
    const local = storage('local');
    if (new URLSearchParams(window.location.search).get('web') === '1') {
      local?.setItem(OPT_OUT_KEY, '1');
      return;
    }
    if (local?.getItem(OPT_OUT_KEY) || session?.getItem(SESSION_KEY)) return;
    // No storage (private mode with storage blocked) means no way to remember we already tried;
    // bail rather than redirect on every page.
    if (!session) return;
    session.setItem(SESSION_KEY, '1');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (document.hidden && timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('pagehide', cancel);

    timer = setTimeout(() => {
      if (!document.hidden) window.location.href = APP_STORE_URL;
    }, FALLBACK_MS);
    window.location.href = APP_URL;
    // No cleanup on purpose: this sits in the root layout and never unmounts, and clearing the timer
    // in a cleanup would let React's dev double-invoke cancel the only attempt (the session flag is
    // already set by then).
    // Only the landing page decides; later client-side navigation is covered by the session flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
