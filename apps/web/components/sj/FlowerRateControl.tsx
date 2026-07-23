'use client';

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FlowerGlyph from './FlowerGlyph';
import { spectrumFill, spectrumNumber, spectrumRing, formatScore } from '../../lib/sj/display';

/**
 * Drag-to-rate flower control — the quick-rate affordance for any album/song
 * surface (search, explore, quick add). At rest it's a small rounded-flower
 * button (or the current score, if already rated — press it again to re-rate).
 *
 * The flower itself never moves. Press it and drag outward: distance from the
 * button's centre maps to the score (farther = higher, 0.1 steps). A single thin
 * arc — drawn at the current score's radius, angled toward the cursor and fading
 * out along its length — is the whole gauge; a dotted horizontal baseline with
 * whole-star ticks gives the drag something to read against. The live score
 * fades in *over* the flower, centred and stationary, as the glyph dims out.
 *
 * A press with no meaningful drag is treated as a tap → `onRequestPrecise`
 * (open the full rating modal). Pointer events + capture cover mouse and touch;
 * `touch-action: none` stops the page scrolling mid-drag.
 */

// Radii are literal drag distances from the button's centre: OFFSET is a dead
// zone (release inside = cancel), then each whole star is STEP px further out.
// The full 0.5→5.0 sweep lands at OFFSET + 5*STEP ≈ 206px — comfortable on a
// phone, and 0.1 of a star is ~3.4px, so tenths stay distinguishable.
const TAP_THRESHOLD = 8; // px of movement below which a release is a click, not a drag
const OFFSET = 36; // dead-zone radius — release inside cancels
const STEP = 34; // px of drag per whole star
const MAX_RADIUS = OFFSET + 5 * STEP;
const scoreRadius = (score: number) => OFFSET + score * STEP;

/**
 * Distance → score snapped to `ratingStep` (the user's manual rating precision —
 * 0.5 half-star / 0.1 decimal), or null inside the dead zone (a cancel).
 * Previously hardcoded to 0.1 regardless of the caller's step, so the drag let a
 * half-star user land on a decimal score — the tap-to-open precise modal already
 * respected `ratingStep` (see AlbumRateButton), only the drag itself didn't.
 */
function distanceToScore(dist: number, ratingStep: number): number | null {
  if (dist < OFFSET) return null;
  const stars = (dist - OFFSET) / STEP;
  const snapped = Math.round(stars / ratingStep) * ratingStep;
  return Math.min(5, Math.max(0.5, snapped));
}

interface DragState {
  /** Gauge origin — the button's centre, in viewport coords. It never moves. */
  ox: number;
  oy: number;
  /** Cursor angle from the origin, radians. */
  angle: number;
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
  ratingStep = 0.5,
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
  /** The user's manual rating precision (0.5 half-star / 0.1 decimal, from
   *  `profile.manual_rating_step`) — the drag snaps to this, same as the
   *  tap-to-open precise modal already does. */
  ratingStep?: number;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Anchor the gauge to the button's centre so it stays put no matter where
    // on the flower the press landed.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrag({
      ox: rect.left + rect.width / 2,
      oy: rect.top + rect.height / 2,
      angle: 0,
      score: null,
      maxDist: 0,
    });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.ox;
    const dy = e.clientY - d.oy;
    const dist = Math.hypot(dx, dy);
    setDrag({
      ...d,
      angle: dist > 1 ? Math.atan2(dy, dx) : d.angle,
      score: distanceToScore(dist, ratingStep),
      maxDist: Math.max(d.maxDist, dist),
    });
  }, [ratingStep]);

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
  // What the button shows right now: the live drag score wins over the stored one.
  const shown = drag?.score ?? (drag ? null : currentScore);
  const showNumber = shown != null;

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
        // grid + a shared cell stacks the glyph and the number without needing
        // `relative` here — several call sites pass their own `absolute …`.
        className={`grid place-items-center rounded-full shadow transition-transform hover:scale-105 active:scale-95 ${className}`}
        style={{
          width: size,
          height: size,
          touchAction: 'none',
          background: showNumber ? spectrumFill(shown!) : '#fff',
          transition: 'background 140ms ease-out',
        }}
      >
        {/* Flower glyph — dims out as the drag score rises over it. */}
        <span
          className="flex items-center justify-center"
          style={{
            gridArea: '1 / 1',
            opacity: showNumber ? 0 : 1,
            transform: showNumber ? 'scale(0.82)' : 'scale(1)',
            transition: 'opacity 130ms ease-out, transform 130ms ease-out',
          }}
        >
          <FlowerGlyph src="/icon-flower.svg" size={Math.round(size * 0.56)} className="text-accent" />
        </span>
        {/* Score, revealed in place over the flower — a touch of overshoot on the
            way in so it reads as a "pop", not a crossfade. */}
        <span
          className="font-black leading-none tabular-nums"
          style={{
            gridArea: '1 / 1',
            fontSize: Math.round(size * 0.4),
            color: showNumber ? spectrumNumber(shown!) : 'transparent',
            opacity: showNumber ? 1 : 0,
            transform: showNumber ? 'scale(1)' : 'scale(0.6)',
            transition:
              'opacity 130ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), color 140ms ease-out',
          }}
        >
          {showNumber ? formatScore(shown!) : rated ? formatScore(currentScore!) : ''}
        </span>
      </button>
      {drag && typeof document !== 'undefined' &&
        createPortal(<DragGauge state={drag} />, document.body)}
    </>
  );
}

/** Arc geometry: half-width of the sector, and how many sub-segments compose it.
 *  The arc is built from short strokes with a cosine opacity falloff, which
 *  fades it out along its length without needing a gradient in arc space. */
const ARC_SPAN = (52 * Math.PI) / 180; // total sweep of the arc, radians
const ARC_SEGMENTS = 22;

/**
 * The live gauge: a dotted horizontal baseline out of the (stationary) flower
 * with whole-star ticks, plus one thin arc at the current score's radius,
 * centred on the cursor's angle and fading toward both ends.
 */
function DragGauge({ state }: { state: DragState }) {
  const { ox, oy, angle, score } = state;
  const cancel = score == null;
  const color = spectrumRing(score ?? 0.5);
  const radius = scoreRadius(score ?? 0.5);

  // Arc sub-segments, each a short stroke with its own opacity.
  const segments = [];
  if (!cancel) {
    const step = ARC_SPAN / ARC_SEGMENTS;
    for (let i = 0; i < ARC_SEGMENTS; i += 1) {
      const t = (i + 0.5) / ARC_SEGMENTS; // 0..1 along the arc
      const a0 = angle - ARC_SPAN / 2 + i * step;
      const a1 = a0 + step * 1.04; // slight overlap so the strokes read continuous
      // Cosine falloff: opaque in the middle, vanishing at both ends.
      const fade = Math.pow(Math.sin(t * Math.PI), 1.4);
      segments.push(
        <line
          key={i}
          x1={ox + radius * Math.cos(a0)}
          y1={oy + radius * Math.sin(a0)}
          x2={ox + radius * Math.cos(a1)}
          y2={oy + radius * Math.sin(a1)}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          opacity={fade * 0.95}
        />,
      );
    }
  }

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none select-none">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {/* Dotted horizontal baseline — the fixed reference the drag reads
            against — with a tick at each whole star. Drawn as two halves that
            start at the dead-zone edge, so nothing crosses the flower itself. */}
        {[-1, 1].map((side) => (
          <line
            key={`base-${side}`}
            x1={ox + side * OFFSET}
            y1={oy}
            x2={ox + side * MAX_RADIUS}
            y2={oy}
            stroke="rgb(120,120,120)"
            strokeWidth={1}
            strokeDasharray="1 5"
            strokeLinecap="round"
            opacity={0.4}
          />
        ))}
        {[1, 2, 3, 4, 5].map((s) => {
          const r = scoreRadius(s);
          const reached = !cancel && score! >= s;
          return [-1, 1].map((side) => (
            <line
              key={`tick-${s}-${side}`}
              x1={ox + side * r}
              y1={oy - 3}
              x2={ox + side * r}
              y2={oy + 3}
              stroke={reached ? color : 'rgb(120,120,120)'}
              strokeWidth={reached ? 1.5 : 1}
              opacity={reached ? 0.55 : 0.28}
            />
          ));
        })}
        {/* Dead-zone edge — release inside here cancels. */}
        <circle
          cx={ox}
          cy={oy}
          r={OFFSET}
          fill="none"
          stroke={cancel ? 'rgb(120,120,120)' : color}
          strokeOpacity={cancel ? 0.35 : 0.18}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        {segments}
      </svg>
    </div>
  );
}
