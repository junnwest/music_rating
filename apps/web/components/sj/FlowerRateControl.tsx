'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FlowerGlyph from './FlowerGlyph';
import { spectrumFill, spectrumNumber, spectrumRing, formatScore } from '../../lib/sj/display';

/**
 * Drag-to-rate flower control — the quick-rate affordance for any album/song
 * surface (search, explore, quick add). At rest it's a small rounded-flower
 * button (or the current score, if already rated — press it again to re-rate).
 * Press and drag outward: distance from the press point maps to the score
 * (farther = higher). Concentric translucent rings around the flower fill
 * outward, one per whole star, as the cursor moves; the exact score stays small
 * inside the original icon circle. Release to commit.
 *
 * A press with no meaningful drag is treated as a tap → `onRequestPrecise`
 * (open the full rating modal). Pointer events + capture cover mouse and touch;
 * `touch-action: none` stops the page scrolling mid-drag.
 */

const MIN_DIST = 10; // px — release below this = a tap, not a rating
const MAX_DIST = 300; // px — drag this far (in any direction) to reach 5.0

function distanceToScore(dist: number): number {
  const frac = Math.min(1, Math.max(0, (dist - MIN_DIST) / (MAX_DIST - MIN_DIST)));
  const half = Math.round(frac * 5 * 2) / 2;
  return Math.min(5, Math.max(0.5, half));
}

interface DragState {
  ox: number;
  oy: number;
  px: number;
  py: number;
  score: number;
}

export default function FlowerRateControl({
  onRate,
  onRequestPrecise,
  size = 30,
  currentScore = null,
  ariaLabel,
  className = '',
}: {
  /** Commit a drag-selected score (0.5–5.0). */
  onRate: (score: number) => void;
  /** A tap (no drag) — hand off to the precise rating modal. */
  onRequestPrecise?: () => void;
  size?: number;
  /** If already rated, the resting score to show (still re-ratable on press). */
  currentScore?: number | null;
  ariaLabel?: string;
  className?: string;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ ox: e.clientX, oy: e.clientY, px: e.clientX, py: e.clientY, score: currentScore ?? 0.5 });
    },
    [currentScore],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dist = Math.hypot(e.clientX - d.ox, e.clientY - d.oy);
    setDrag({ ...d, px: e.clientX, py: e.clientY, score: distanceToScore(dist) });
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !commit) return;
      const dist = Math.hypot(d.px - d.ox, d.py - d.oy);
      if (dist < MIN_DIST) onRequestPrecise?.();
      else onRate(d.score);
    },
    [onRate, onRequestPrecise],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    },
    [finish],
  );

  const rated = currentScore != null;

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finish(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRequestPrecise?.();
          }
        }}
        className={`flex items-center justify-center rounded-full shadow transition hover:scale-105 active:scale-95 ${
          drag ? 'opacity-0' : ''
        } ${className}`}
        style={{
          width: size,
          height: size,
          touchAction: 'none',
          background: rated ? spectrumFill(currentScore!) : '#fff',
          color: rated ? spectrumNumber(currentScore!) : undefined,
        }}
      >
        {rated ? (
          <span
            className="font-black leading-none tabular-nums"
            style={{ fontSize: Math.round(size * 0.4) }}
          >
            {formatScore(currentScore!)}
          </span>
        ) : (
          <FlowerGlyph src="/icon-flower.svg" size={Math.round(size * 0.56)} className="text-accent" />
        )}
      </button>
      {drag && typeof document !== 'undefined' &&
        createPortal(<DragGauge state={drag} iconSize={size} />, document.body)}
    </>
  );
}

/** The live radial gauge shown while dragging: concentric translucent rings
 *  (one per whole star, filling outward as the cursor moves) around a small
 *  score readout kept at the original icon size. */
function DragGauge({ state, iconSize }: { state: DragState; iconSize: number }) {
  const { ox, oy, px, py, score } = state;
  const iconR = iconSize / 2;
  const gap = 14; // radial spacing between whole-star rings
  const band = gap * 0.72; // ring thickness
  const filled = Math.round(score); // whole stars reached
  const ring = spectrumRing(score);

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none select-none">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {/* Faint connector to the cursor (travel can exceed the ring halo) */}
        <line
          x1={ox}
          y1={oy}
          x2={px}
          y2={py}
          stroke={ring}
          strokeWidth={2}
          strokeDasharray="3 5"
          strokeLinecap="round"
          opacity={0.4}
        />
        {/* Concentric whole-star rings, outer drawn first */}
        {[5, 4, 3, 2, 1].map((i) => {
          const r = iconR + i * gap;
          const isFilled = i <= filled;
          return (
            <circle
              key={i}
              cx={ox}
              cy={oy}
              r={r}
              fill="none"
              stroke={isFilled ? ring : 'rgb(120,120,120)'}
              strokeOpacity={isFilled ? 0.22 + (filled - i) * 0.05 : 0.12}
              strokeWidth={band}
              style={{ transition: 'stroke-opacity 80ms linear' }}
            />
          );
        })}
        {/* Cursor dot */}
        <circle cx={px} cy={py} r={5} fill={ring} opacity={0.8} />
      </svg>

      {/* Score readout — kept at the original icon size, not enlarged */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full"
        style={{
          left: ox,
          top: oy,
          width: iconSize,
          height: iconSize,
          background: spectrumFill(score),
          boxShadow: '0 2px 8px rgba(0,0,0,0.18), inset 0 1px 2px rgba(255,255,255,0.6)',
        }}
      >
        <span
          className="font-black leading-none tabular-nums"
          style={{ fontSize: Math.round(iconSize * 0.4), color: spectrumNumber(score) }}
        >
          {formatScore(score)}
        </span>
      </div>
    </div>
  );
}
