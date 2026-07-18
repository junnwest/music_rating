'use client';

import { User } from 'lucide-react';

/**
 * User avatar with a consistent default -- a gray circle + person silhouette, mirroring iOS's
 * "person.circle.fill" fallback (Color(uiColor: .systemGray3)) -- not a colored circle with the
 * user's initial, which was the web-only convention every avatar render had drifted to.
 */
export default function Avatar({
  url,
  size = 36,
  className = '',
}: {
  url?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-divider overflow-hidden shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <User size={Math.round(size * 0.58)} className="text-muted" fill="currentColor" strokeWidth={0} />
      )}
    </span>
  );
}
