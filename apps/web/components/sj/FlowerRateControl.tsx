'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FlowerGlyph from './FlowerGlyph';
import { spectrumFill, spectrumNumber, spectrumRing, formatScore } from '../../lib/sj/display';

/**
 * Drag-to-rate flower control — the quick-rate affordance for any album/song
 * surface (search, discovery, quick add). At rest it's a small flower button.
 * Press and drag outward: distance from the press point maps to the score
 * (farther = higher), shown live in an interactive circular gauge that fills
 * and shifts colour (red at 0.5 → blue at 5.0) as you go. Release to commit.
 *
 * A press with no meaningful drag is treated as a tap → `onRequestPrecise`
 * (open the full rating modal), so precision is never lost. Pointer events +
 * capture cover mouse and touch alike; `touch-action: none` stops the page
 * from scrolling mid-drag.
 */

const MIN_DIST = 10; // px — release below this = a tap, not a rating
const MAX_DIST = 150; // px — drag this far (in any direction) to reach 5.0

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
  size = 28,
  ariaLabel,
  className = '',
}: {
  /** Commit a drag-selected score (0.5–5.0). */
  onRate: (score: number) => void;
  /** A tap (no drag) — hand off to the precise rating modal. */
  onRequestPrecise?: () => void;
  size?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ ox: e.clientX, oy: e.clientY, px: e.clientX, py: e.clientY, score: 0.5 });
  }, []);

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
        className={`flex items-center justify-center rounded-full bg-white text-accent shadow hover:scale-105 active:scale-95 transition ${
          drag ? 'scale-95' : ''
        } ${className}`}
        style={{ width: size, height: size, touchAction: 'none' }}
      >
        <FlowerGlyph size={Math.round(size * 0.5)} />
      </button>
      {drag && typeof document !== 'undefined' && createPortal(<DragGauge {...drag} />, document.body)}
    </>
  );
}

/** The live radial gauge shown while dragging: a connector to the finger and a
 *  filling score ring anchored at the press point. */
function DragGauge({ ox, oy, px, py, score }: DragState) {
  const GAUGE = 108;
  const stroke = 7;
  const r = (GAUGE - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, score / 5));
  const ring = spectrumRing(score);

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none select-none">
      {/* Connector line + finger dot */}
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <line
          x1={ox}
          y1={oy}
          x2={px}
          y2={py}
          stroke={ring}
          strokeWidth={2}
          strokeDasharray="3 5"
          strokeLinecap="round"
          opacity={0.55}
        />
        <circle cx={px} cy={py} r={6} fill={ring} opacity={0.9} />
      </svg>

      {/* Score gauge anchored at the press point */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: ox, top: oy, width: GAUGE, height: GAUGE }}
      >
        <svg width={GAUGE} height={GAUGE} className="-rotate-90">
          <circle
            cx={GAUGE / 2}
            cy={GAUGE / 2}
            r={r}
            fill="none"
            stroke="rgba(0,0,0,0.12)"
            strokeWidth={stroke}
          />
          <circle
            cx={GAUGE / 2}
            cy={GAUGE / 2}
            r={r}
            fill="none"
            stroke={ring}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circ * frac} ${circ}`}
            style={{ transition: 'stroke-dasharray 60ms linear' }}
          />
        </svg>
        <div
          className="absolute flex items-center justify-center rounded-full"
          style={{
            inset: stroke + 3,
            background: spectrumFill(score),
            boxShadow: '0 8px 24px rgba(0,0,0,0.20), inset 0 1px 2px rgba(255,255,255,0.6)',
          }}
        >
          <span
            className="font-black leading-none tabular-nums"
            style={{
              fontSize: Math.round(GAUGE * 0.3),
              color: spectrumNumber(score),
              transform: 'scaleY(1.1)',
            }}
          >
            {formatScore(score)}
          </span>
        </div>
      </div>
    </div>
  );
}
