'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Deployment skew: a client holding the previous deploy's HTML requests
  // chunk hashes the new deploy no longer serves (ChunkLoadError). A reload
  // fetches the fresh shell — do it automatically, once, instead of making
  // the user reload 2–3 times themselves.
  useEffect(() => {
    const chunkError =
      error?.name === 'ChunkLoadError' ||
      /Loading chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
        error?.message ?? '',
      );
    if (!chunkError) return;
    const KEY = 'sj-chunk-reload';
    if (sessionStorage.getItem(KEY)) return; // one attempt — never loop
    sessionStorage.setItem(KEY, '1');
    window.location.reload();
  }, [error]);

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-5 text-center">
      <p className="text-[11px] font-semibold text-muted uppercase mb-4" style={{ letterSpacing: '0.7px' }}>
        500
      </p>
      <h1
        className="text-[40px] sm:text-[56px] font-extrabold text-ink leading-[1.04]"
        style={{ letterSpacing: '-1.5px' }}
      >
        Something went wrong
      </h1>
      <p className="text-[15px] text-muted mt-4 max-w-[360px] leading-relaxed">
        An unexpected error occurred. Try refreshing the page.
      </p>
      <div className="flex gap-3 mt-8">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-7 py-3 text-[14px] font-semibold hover:opacity-80 transition"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 border border-divider rounded-xl px-7 py-3 text-[14px] font-semibold text-ink hover:bg-surface transition"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
