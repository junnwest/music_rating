'use client';

import { useState } from 'react';
import { thumbnailUrl } from '../../lib/sj/display';

/** CAA covers 307-redirect to archive.org and take 1.5–2.5s each; the
 * `/api/img` proxy follows the redirect server-side once and the Vercel edge
 * caches the bytes for a year — every later viewer gets an instant hit.
 * Fast CDNs (iTunes/Deezer/Spotify) stay direct. */
const isCaa = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === 'coverartarchive.org' || h === 'archive.org' || h.endsWith('.archive.org');
  } catch {
    return false;
  }
};

/**
 * Release cover image — the web mirror of iOS `CoverImage`.
 * Renders a neutral placeholder block while loading / when there's no art,
 * downsizes known CDN URLs for thumbnails, routes slow CAA art through the
 * caching proxy (falling back to the direct URL if the proxy errors), and
 * clips to a rounded rect. Size via className (e.g. "w-20 h-20").
 */
export default function Cover({
  url,
  alt = '',
  className = '',
  rounded = 'rounded-[10px]',
  thumb = true,
}: {
  url: string | null | undefined;
  alt?: string;
  className?: string;
  rounded?: string;
  thumb?: boolean;
}) {
  // 0 = preferred source, 1 = direct fallback (CAA only), 2 = placeholder
  const [state, setState] = useState<{ forUrl: string | null | undefined; attempt: number }>({
    forUrl: url,
    attempt: 0,
  });
  // Reset the attempt ladder when the url prop changes (recycled list rows)
  if (state.forUrl !== url) setState({ forUrl: url, attempt: 0 });
  const attempt = state.attempt;
  const setAttempt = (fn: (a: number) => number) =>
    setState((s) => ({ ...s, attempt: fn(s.attempt) }));

  let src: string | null = null;
  if (url && attempt < 2) {
    const direct = thumb ? thumbnailUrl(url) : url;
    src =
      isCaa(url) && attempt === 0 ? `/api/img?url=${encodeURIComponent(direct)}` : direct;
  }

  return (
    <div className={`relative overflow-hidden bg-divider shrink-0 ${rounded} ${className}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setAttempt((a) => (url && isCaa(url) && a === 0 ? 1 : 2))}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
