'use client';

import FlowerGlyph from './FlowerGlyph';
import type { FoundingStatus } from '../../lib/sj/founding';

export type BadgeDirection = 'chip' | 'ring' | 'flower';

/**
 * The founding badge — 3 structurally distinct directions to pick from (see
 * app/founding/badge-directions for a side-by-side review). All three share
 * one semantic grammar rather than being arbitrary skins: pending reads as
 * muted/dashed/incomplete, locked-in reads as solid/confident/finished. None
 * of them encode fractional activity progress on the badge itself — that
 * belongs on the account-status panel (app/invite), not a 20px inline mark
 * meant to be scanned in a feed.
 */
export default function FoundingBadge({
  direction,
  status,
  number,
  size = 22,
}: {
  direction: BadgeDirection;
  status: FoundingStatus;
  number: number;
  size?: number;
}) {
  const locked = status === 'locked_in';
  const label = locked ? `#${number}` : `#${number} · pending`;

  if (direction === 'chip') {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={`inline-flex items-center justify-center rounded-full font-bold tabular-nums shrink-0 ${
          locked ? 'bg-ink text-page' : 'border border-dashed border-muted text-muted'
        }`}
        style={{ height: size, minWidth: size, paddingInline: size * 0.32, fontSize: size * 0.46 }}
      >
        {number}
      </span>
    );
  }

  if (direction === 'ring') {
    const ringStroke = Math.max(1.5, size * 0.07);
    const r = size / 2 - ringStroke;
    const c = 2 * Math.PI * r;
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="relative inline-flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="absolute -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={locked ? 'rgb(var(--color-accent))' : 'rgb(var(--color-muted))'}
            strokeWidth={ringStroke}
            strokeLinecap="round"
            strokeDasharray={locked ? undefined : `${c * 0.18} ${c * 0.1}`}
            opacity={locked ? 1 : 0.55}
          />
        </svg>
        <span
          className={`relative font-bold tabular-nums leading-none ${locked ? 'text-ink' : 'text-muted'}`}
          style={{ fontSize: size * 0.36 }}
        >
          {number}
        </span>
      </span>
    );
  }

  // direction === 'flower'
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className={locked ? 'text-accent' : 'text-muted'}
        style={{ opacity: locked ? 1 : 0.4 }}
      >
        <FlowerGlyph src="/icon-flower.svg" size={size} />
      </span>
      <span
        className="absolute font-black leading-none tabular-nums"
        style={{
          fontSize: size * 0.3,
          color: locked ? 'white' : 'rgb(var(--color-page))',
          textShadow: locked ? '0 0 2px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        {number}
      </span>
    </span>
  );
}
