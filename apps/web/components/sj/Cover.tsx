'use client';

import { useState } from 'react';
import { thumbnailUrl } from '../../lib/sj/display';

/**
 * Release cover image — the web mirror of iOS `CoverImage`.
 * Renders a neutral placeholder block while loading / when there's no art,
 * downsizes known CDN URLs for thumbnails, and clips to a rounded rect.
 * Size via className (e.g. "w-20 h-20").
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
  const [failed, setFailed] = useState(false);
  const src = url && !failed ? (thumb ? thumbnailUrl(url) : url) : null;

  return (
    <div className={`relative overflow-hidden bg-divider shrink-0 ${rounded} ${className}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
