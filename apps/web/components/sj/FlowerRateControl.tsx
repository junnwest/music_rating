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

// Radii are literal drag distances: OFFSET is a dead zone (release inside =
// cancel), then each whole star is STEP px further out — so the drawn rings show
// exactly how far to drag for each rating. TAP_THRESHOLD distinguishes a short
// click (→ open the precise modal) from a real drag.
const TAP_THRESHOLD = 8; // px of movement below which a release is a click, not a drag
const OFFSET = 44; // dead-zone radius — release inside cancels
const STEP = 52; // px of drag per whole star
const ringRadius = (star: number) => OFFSET + star * STEP; // star 1..5

/** Distance → score, or null inside the dead zone (a cancel). */
function distanceToScore(dist: number): number | null {
  if (dist < OFFSET) return null;
  const stars = (dist - OFFSET) / STEP;
  const half = Math.round(stars * 2) / 2;
  return Math.min(5, Math.max(0.5, half));
}

interface DragState {
  ox: number;
  oy: number;
  px: number;
  py: number;
  score: number | null;
  maxDist: number;
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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ ox: e.clientX, oy: e.clientY, px: e.clientX, py: e.clientY, score: null, maxDist: 0 });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dist = Math.hypot(e.clientX - d.ox, e.clientY - d.oy);
    setDrag({
      ...d,
      px: e.clientX,
      py: e.clientY,
      score: distanceToScore(dist),
      maxDist: Math.max(d.maxDist, dist),
    });
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !commit) return;
      // Short click (barely moved) → open the precise modal.
      if (d.maxDist < TAP_THRESHOLD) {
        onRequestPrecise?.();
        return;
      }
      // Dragged, but released back inside the dead zone → cancel, no rating.
      if (d.score == null) return;
      onRate(d.score);
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

/** The live radial gauge shown while dragging: concentric rings whose radii ARE
 *  the drag distance for each whole star, filled with translucent discs that
 *  stack toward the centre (denser as more stars fill), a dashed dead-zone
 *  boundary, and a small score readout kept at the original icon size. */
function DragGauge({ state, iconSize }: { state: DragState; iconSize: number }) {
  const { ox, oy, px, py, score } = state;
  const cancel = score == null;
  const filled = cancel ? 0 : Math.round(score); // whole stars reached
  const ring = spectrumRing(score ?? 0.5);
  const stars = [1, 2, 3, 4, 5];

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none select-none">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {/* Filled discs — one per reached whole star; overlapping translucent
            fills accumulate toward the centre, so it's denser in the middle and
            more opaque overall the further you drag. */}
        {stars
          .filter((s) => s <= filled)
          .map((s) => (
            <circle key={`fill-${s}`} cx={ox} cy={oy} r={ringRadius(s)} fill={ring} opacity={0.1} />
          ))}
        {/* Whole-star guide rings — radius = how far to drag for that rating */}
        {stars.map((s) => {
          const reached = s <= filled;
          return (
            <circle
              key={`ring-${s}`}
              cx={ox}
              cy={oy}
              r={ringRadius(s)}
              fill="none"
              stroke={reached ? ring : 'rgb(120,120,120)'}
              strokeOpacity={reached ? 0.5 : 0.16}
              strokeWidth={reached ? 2 : 1}
            />
          );
        })}
        {/* Dead-zone boundary — release inside cancels */}
        <circle
          cx={ox}
          cy={oy}
          r={OFFSET}
          fill="none"
          stroke="rgb(120,120,120)"
          strokeOpacity={0.3}
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {/* Connector + cursor dot */}
        <line
          x1={ox}
          y1={oy}
          x2={px}
          y2={py}
          stroke={cancel ? 'rgb(120,120,120)' : ring}
          strokeWidth={2}
          strokeDasharray="3 5"
          strokeLinecap="round"
          opacity={0.35}
        />
        <circle cx={px} cy={py} r={5} fill={cancel ? 'rgb(120,120,120)' : ring} opacity={0.8} />
      </svg>

      {/* Score readout — kept at the original icon size, not enlarged. In the
          dead zone it shows a dash to signal "release here to cancel". */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full"
        style={{
          left: ox,
          top: oy,
          width: iconSize,
          height: iconSize,
          background: cancel ? '#fff' : spectrumFill(score ?? 0.5),
          boxShadow: '0 2px 8px rgba(0,0,0,0.18), inset 0 1px 2px rgba(255,255,255,0.6)',
        }}
      >
        <span
          className="font-black leading-none tabular-nums"
          style={{
            fontSize: Math.round(iconSize * 0.4),
            color: cancel ? 'rgb(150,150,150)' : spectrumNumber(score ?? 0.5),
          }}
        >
          {cancel ? '–' : formatScore(score ?? 0.5)}
        </span>
      </div>
    </div>
  );
}
