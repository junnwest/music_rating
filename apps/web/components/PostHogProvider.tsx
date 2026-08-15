'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { Suspense } from 'react';

if (typeof window !== 'undefined') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: false, // manual below so we get the right path
    capture_pageleave: true,
    // Cookieless analytics: keep the distinct-id in memory only — no cookies,
    // no localStorage. This is what lets the privacy policy honestly say we use
    // strictly-necessary cookies only (so no consent banner is required), while
    // still getting session-scoped product analytics. `respect_dnt` backs the
    // policy's "we honor Do Not Track for analytics" line. Persists across the
    // App Router's client-side navigations (same JS context); resets on a hard
    // reload / new tab.
    persistence: 'memory',
    respect_dnt: true,
  });
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const url = pathname + (searchParams.toString() ? `?${searchParams}` : '');
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense>
        <PageviewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
