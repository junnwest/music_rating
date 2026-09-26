'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import FlowerGlyph from './FlowerGlyph';
import { useLanguage } from '../../lib/i18n';
import { spectrumFill, spectrumNumber, spectrumRing, formatScore } from '../../lib/sj/display';

/**
 * Drag-to-rate flower control — the quick-rate affordance for any album/song
 * surface (search, explore, quick add). At rest it's a small rounded-flower
 * button (or the current score, if already rated — press it again to re-rate).
 *
 * The flower itself never moves. Press it and drag outward: distance from the
 * button's centre maps to the score (farther = higher, 0.1 steps). Concentric
 * rings at each whole-star radius (solid + coloured once reached) are the scale,
 * with a single thin arc at the current score's radius — angled toward the
 * cursor and fading out along its length — as the live pointer; a light dotted
 * baseline gives the drag axis something to read against. While dragging, the
 * flower is lifted and popped forward in 3D *in front of* a fade that diffuses
 * outward from behind it, the live score fading in over the glyph.
 *
 * A press with no meaningful drag is treated as a tap → `onRequestPrecise`
 * (open the full rating modal). Pointer events + capture cover mouse and touch;
 * `touch-action: none` stops the page scrolling mid-drag.
 *
 * Releasing back inside the dead zone always cancels (the rating is left as it
 * was). Deleting is its own gesture, as on iOS: on an already-rated item a
 * trash target sits past the 5★ ring, and a release beyond DELETE_RADIUS calls
 * `onRate(null)`.
 */

// Radii are literal drag distances from the button's centre: OFFSET is a dead
// zone (release inside = cancel), then each whole star is STEP px further out.
// The full 0.5→5.0 sweep lands at OFFSET + 5*STEP ≈ 206px — comfortable on a
// phone, and 0.1 of a star is ~3.4px, so tenths stay distinguishable.
const TAP_THRESHOLD = 8; // px of movement below which a release is a click, not a drag
const OFFSET = 36; // dead-zone radius — release inside cancels
const STEP = 34; // px of drag per whole star
const MAX_RADIUS = OFFSET + 5 * STEP;
// Past 5★ the score just holds at 5 until DELETE_RADIUS, where a release deletes
// the rating (rated items only). The gap keeps an enthusiastic 5 from deleting.
const DELETE_GAP = 44;
const DELETE_RADIUS = MAX_RADIUS + DELETE_GAP;
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
  /** Past DELETE_RADIUS on a rated item — releasing deletes the rating. */
  deleting: boolean;
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
  /** Commit a drag-selected score (0.5–5.0), or `null` to delete an existing
   *  rating (dragged out past the 5★ ring onto the trash target). */
  onRate: (score: number | null) => void;
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
  const { t } = useLanguage();
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // The pressed button, kept across the drag so the origin can be re-read from
  // its live position on every move (see onPointerMove).
  const elRef = useRef<HTMLElement | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    elRef.current = el;
    el.setPointerCapture(e.pointerId);
    // Anchor the gauge to the button's centre so it stays put no matter where
    // on the flower the press landed.
    const rect = el.getBoundingClientRect();
    setDrag({
      ox: rect.left + rect.width / 2,
      oy: rect.top + rect.height / 2,
      angle: 0,
      score: null,
      maxDist: 0,
      deleting: false,
    });
  }, []);

  const rated = currentScore != null;

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    // Re-read the origin from the button's live rect rather than the stale
    // pointerdown snapshot — the page can scroll under an active drag (a
    // scrollable list, iOS momentum, the address bar collapsing), and a frozen
    // origin makes the gauge drift out of sync with where the flower actually
    // is. The button stays mounted (just opacity: 0) while dragging, so its
    // rect is always current.
    const rect = elRef.current?.getBoundingClientRect();
    const ox = rect ? rect.left + rect.width / 2 : d.ox;
    const oy = rect ? rect.top + rect.height / 2 : d.oy;
    const dx = e.clientX - ox;
    const dy = e.clientY - oy;
    const dist = Math.hypot(dx, dy);
    const deleting = rated && dist >= DELETE_RADIUS;
    setDrag({
      ox,
      oy,
      angle: dist > 1 ? Math.atan2(dy, dx) : d.angle,
      score: deleting ? null : distanceToScore(dist, ratingStep),
      maxDist: Math.max(d.maxDist, dist),
      deleting,
    });
  }, [ratingStep, rated]);

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
      // Out on the trash target → delete. Back inside the dead zone → cancel,
      // leaving any existing rating untouched.
      if (d.deleting) {
        onRate(null);
        return;
      }
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

  // What the button shows right now: the live drag score wins over the stored
  // one. Crucially, a rated album keeps showing its *stored* score's color
  // while the drag is still sitting in the dead zone (drag.score is null
  // there) — otherwise the button's fill blanked to white the instant you
  // touched it, before you'd moved your finger at all, which read as the
  // rating vanishing. An unrated album has nothing to fall back to, so it
  // stays blank in the dead zone exactly as before.
  const shown = drag ? (drag.score ?? (rated ? currentScore : null)) : currentScore;
  const showNumber = shown != null;

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel ?? t('sj.rate.rateTooltip')}
        title={t('sj.rate.rateTooltip')}
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
          // While dragging, the flower is re-rendered inside the portal, lifted
          // and 3D-popped *in front of* the fade. Hide the in-flow original so
          // there's no ghost behind the scrim (it still owns the pointer capture,
          // so it keeps receiving the drag even at opacity 0).
          opacity: drag ? 0 : 1,
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
        createPortal(
          <DragGauge
            state={drag}
            rated={rated}
            displayScore={drag.deleting ? null : shown}
            size={size}
            deleteLabel={t('sj.common.delete')}
          />,
          document.body,
        )}
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
function DragGauge({
  state,
  rated,
  displayScore,
  size,
  deleteLabel,
}: {
  state: DragState;
  /** Already rated → the trash target past 5★ is available. */
  rated: boolean;
  deleteLabel: string;
  /** What the popped-forward flower's fill/number should show — the live
   *  drag score, or (in the dead zone) the stored score for an already-rated
   *  album so its color doesn't blank out the instant the drag starts. The
   *  ring/arc below stay keyed off the raw `score` — they signal what
   *  releasing *right now* would do, which is a dead zone regardless. */
  displayScore: number | null;
  size: number;
}) {
  const { ox, oy, angle, score, deleting } = state;
  const cancel = score == null;
  const color = spectrumRing(score ?? 0.5);
  // The trash target rides the drag angle just past DELETE_RADIUS, so it's
  // always out along the direction the pointer is already heading.
  const trashR = DELETE_RADIUS + 16;
  const trashX = ox + trashR * Math.cos(angle);
  const trashY = oy + trashR * Math.sin(angle);
  const radius = scoreRadius(score ?? 0.5);
  const showNumber = displayScore != null;

  // Fade the whole overlay in on mount so the scrim doesn't hard-cut over the
  // page the instant a drag starts.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

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
      {/* Translucent scrim — a soft radial vignette that dims the busy album art
          so the gauge rings and live score read clearly. It's fully clear right
          behind the (lifted) flower, then *diffuses outward* — building to its
          darkest through the gauge band and dissolving gently to nothing beyond,
          with no hard edges. Reads as the fade seeping out from behind the
          popped-forward button. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at ${ox}px ${oy}px, rgba(8,8,12,0) 0px, rgba(8,8,12,0.05) ${Math.round(OFFSET * 0.72)}px, rgba(8,8,12,0.30) ${OFFSET + Math.round(STEP * 0.9)}px, rgba(8,8,12,0.42) ${OFFSET + Math.round(STEP * 2.4)}px, rgba(8,8,12,0.30) ${MAX_RADIUS}px, rgba(8,8,12,0) ${Math.round(MAX_RADIUS * 1.62)}px)`,
          // Diffuse the fade *outward over time* on press: the gradient grows
          // from a tight disc behind the flower to its full reach, scaled about
          // the button's centre, while it eases in. Reads as the dark seeping
          // out from behind the button rather than snapping on as a flat wash.
          transformOrigin: `${ox}px ${oy}px`,
          transform: shown ? 'scale(1)' : 'scale(0.35)',
          opacity: shown ? 1 : 0,
          transition:
            'transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease-out',
        }}
      />
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {/* Concentric star rings — one full circle at each whole-star radius,
            the gauge's primary scale. Faint dashed by default, but a solid,
            colour-filled ring once the drag has reached that star, so the
            "you're past 3★" read is unmistakable against the dark scrim. */}
        {[1, 2, 3, 4, 5].map((s) => {
          const r = scoreRadius(s);
          const reached = !cancel && score! >= s;
          return (
            <circle
              key={`ring-${s}`}
              cx={ox}
              cy={oy}
              r={r}
              fill="none"
              stroke={reached ? color : 'rgb(232,234,244)'}
              strokeWidth={reached ? 1.75 : 1}
              strokeOpacity={reached ? 0.7 : 0.24}
              strokeDasharray={reached ? undefined : '2 5'}
            />
          );
        })}
        {/* Dotted horizontal baseline — a light orientation reference out of the
            flower along the drag axis. Two halves that start at the dead-zone
            edge, so nothing crosses the flower itself. */}
        {[-1, 1].map((side) => (
          <line
            key={`base-${side}`}
            x1={ox + side * OFFSET}
            y1={oy}
            x2={ox + side * MAX_RADIUS}
            y2={oy}
            stroke="rgb(232,234,244)"
            strokeWidth={1}
            strokeDasharray="1 5"
            strokeLinecap="round"
            opacity={0.34}
          />
        ))}
        {/* Dead-zone edge — release inside here cancels. */}
        <circle
          cx={ox}
          cy={oy}
          r={OFFSET}
          fill="none"
          stroke={cancel && !deleting ? 'rgb(150,150,150)' : color}
          strokeOpacity={cancel && !deleting ? 0.6 : 0.18}
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        {/* Delete boundary — only for a rated item. Faint until the drag
            crosses it, then solid red. */}
        {rated && (
          <circle
            cx={ox}
            cy={oy}
            r={DELETE_RADIUS}
            fill="none"
            stroke="rgb(232,84,84)"
            strokeOpacity={deleting ? 0.85 : 0.35}
            strokeWidth={deleting ? 2 : 1}
            strokeDasharray={deleting ? undefined : '3 5'}
          />
        )}
        {!deleting && segments}
      </svg>
      {/* Trash target past the 5★ ring (rated items only). */}
      {rated && (
        <div
          className="absolute flex flex-col items-center gap-1"
          style={{
            left: trashX,
            top: trashY,
            transform: `translate(-50%, -50%) scale(${deleting ? 1.15 : 0.9})`,
            opacity: deleting ? 1 : 0.7,
            transition: 'transform 140ms ease-out, opacity 140ms ease-out',
          }}
        >
          <span
            className="grid place-items-center rounded-full shadow-lg"
            style={{
              width: 34,
              height: 34,
              background: deleting ? 'rgb(220,60,60)' : 'rgba(220,60,60,0.25)',
              border: '1px solid rgba(255,120,120,0.6)',
              transition: 'background 140ms ease-out',
            }}
          >
            <Trash2 size={16} color="#fff" strokeWidth={2.25} />
          </span>
          {deleting && (
            <span className="text-[11px] font-bold" style={{ color: 'rgb(255,130,130)' }}>
              {deleteLabel}
            </span>
          )}
        </div>
      )}
      {/* The flower itself, lifted out of the page and popped forward in 3D —
          rendered here (above the scrim) so it sits genuinely *in front of* the
          fade rather than under it. Mirrors the resting button's flower→score
          crossfade; the in-flow original is hidden while this is up. */}
      <div
        className="absolute grid place-items-center rounded-full"
        style={{
          left: ox,
          top: oy,
          width: size,
          height: size,
          background: deleting ? 'rgb(220,60,60)' : showNumber ? spectrumFill(displayScore!) : '#fff',
          transform: `translate(-50%, -50%) translateY(${shown ? -3 : 0}px) scale(${shown ? 1.22 : 1})`,
          boxShadow: shown
            ? '0 14px 30px -6px rgba(0,0,0,0.6), 0 5px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 1px rgba(255,255,255,0.35)'
            : '0 2px 6px rgba(0,0,0,0.3)',
          transition:
            'transform 220ms cubic-bezier(0.34, 1.5, 0.64, 1), box-shadow 220ms ease-out, background 140ms ease-out',
        }}
      >
        <span
          className="flex items-center justify-center"
          style={{
            gridArea: '1 / 1',
            opacity: showNumber || deleting ? 0 : 1,
            transform: showNumber || deleting ? 'scale(0.82)' : 'scale(1)',
            transition: 'opacity 130ms ease-out, transform 130ms ease-out',
          }}
        >
          <FlowerGlyph src="/icon-flower.svg" size={Math.round(size * 0.56)} className="text-accent" />
        </span>
        {deleting && (
          <span className="flex items-center justify-center" style={{ gridArea: '1 / 1' }}>
            <Trash2 size={Math.round(size * 0.5)} color="#fff" strokeWidth={2.25} />
          </span>
        )}
        <span
          className="font-black leading-none tabular-nums"
          style={{
            gridArea: '1 / 1',
            fontSize: Math.round(size * 0.4),
            color: showNumber ? spectrumNumber(displayScore!) : 'transparent',
            opacity: showNumber ? 1 : 0,
            transform: showNumber ? 'scale(1)' : 'scale(0.6)',
            transition:
              'opacity 130ms ease-out, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), color 140ms ease-out',
          }}
        >
          {showNumber ? formatScore(displayScore!) : ''}
        </span>
      </div>
    </div>
  );
}
