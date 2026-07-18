'use client';

import { useRef, useState } from 'react';

/**
 * Five draggable flower glyphs — web port of iOS's HalfStarRow (QuickAddView.swift).
 * One pointer gesture spans the whole row, continuously previewing the fill up to
 * the pointer; the rating only commits on release. `rating` is the resting fill
 * (null = fully empty, for unrated candidates); `step` is the snap grid (0.5 for
 * Quick Add, the profile's rating step for the manual modal); `onLiveChange`
 * streams the snapped value mid-drag for hosts with a numeric readout — at 0.1
 * steps a tenth of a flower isn't a readable difference.
 */
export default function FlowerRatingRow({
  rating = null,
  step = 0.5,
  size = 22,
  gap = 4,
  onLiveChange,
  onRate,
  label,
}: {
  rating?: number | null;
  step?: number;
  size?: number;
  gap?: number;
  onLiveChange?: (value: number) => void;
  onRate: (value: number) => void;
  label?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number | null>(null);

  function valueAt(clientX: number): number {
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0.5;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const raw = (x / rect.width) * 5;
    const snapped = Math.round(raw / step) * step;
    // 0.1 steps accumulate float drift (4.300000000000001) — round to 2 decimals.
    const cleaned = Math.round(snapped * 100) / 100;
    return Math.min(Math.max(cleaned, 0.5), 5);
  }

  const shown = live ?? rating;

  return (
    <div
      ref={rowRef}
      role="slider"
      aria-label={label}
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={shown ?? 0}
      tabIndex={0}
      className="inline-flex touch-none cursor-pointer select-none"
      style={{ gap }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueAt(e.clientX);
        setLive(v);
        onLiveChange?.(v);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        const v = valueAt(e.clientX);
        setLive(v);
        onLiveChange?.(v);
      }}
      onPointerUp={(e) => {
        const v = valueAt(e.clientX);
        setLive(null);
        onRate(v);
      }}
      onKeyDown={(e) => {
        // Keyboard path: arrows nudge by one step from the current value.
        const base = shown ?? 2.5;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onRate(Math.min(Math.round((base + step) * 100) / 100, 5));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onRate(Math.max(Math.round((base - step) * 100) / 100, 0.5));
        }
      }}
    >
      {[1, 2, 3, 4, 5].map((position) => {
        const fill = shown != null ? Math.min(Math.max(shown - (position - 1), 0), 1) : 0;
        return (
          <span key={position} className="relative inline-block" style={{ width: size, height: size }}>
            <span className="absolute inset-0 text-divider">
              <FlowerMask size={size} />
            </span>
            {fill > 0 && (
              <span
                className="absolute inset-y-0 left-0 overflow-hidden text-accent"
                style={{ width: size * fill }}
              >
                <FlowerMask size={size} />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Fixed-size flower glyph (FlowerGlyph but sized for clipping inside the fill mask). */
function FlowerMask({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="block bg-current"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: 'url(/logo-flower.svg)',
        maskImage: 'url(/logo-flower.svg)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
