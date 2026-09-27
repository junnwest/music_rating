'use client';

import { Clock, ListMusic } from 'lucide-react';
import Cover from './Cover';

/**
 * A mix's cover: a 2×2 mosaic of its newest covers (one cover fills the tile;
 * none shows the mix icon). Mirrors iOS MixShareCard's artwork.
 */
export default function MixMosaic({
  covers,
  isDefault = false,
  className = 'w-10 h-10',
  rounded = 'rounded-lg',
}: {
  covers: string[];
  isDefault?: boolean;
  className?: string;
  rounded?: string;
}) {
  if (covers.length === 0) {
    const Icon = isDefault ? Clock : ListMusic;
    return (
      <span
        className={`${className} ${rounded} shrink-0 grid place-items-center bg-accent/10 text-accent`}
      >
        <Icon size={16} />
      </span>
    );
  }
  if (covers.length < 4) {
    return <Cover url={covers[0]} className={`${className} shrink-0`} rounded={rounded} />;
  }
  return (
    <span className={`${className} ${rounded} shrink-0 grid grid-cols-2 grid-rows-2 overflow-hidden`}>
      {covers.slice(0, 4).map((c, i) => (
        <Cover key={`${c}-${i}`} url={c} className="w-full h-full" rounded="rounded-none" />
      ))}
    </span>
  );
}
