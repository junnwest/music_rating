'use client';

import { useEffect, useRef, useState } from 'react';
import { spectrumColor } from '../../lib/sj/display';

/**
 * Chart + motion primitives for the Taste report (2026-08-10 rebuild).
 *
 * Shared design rules (dataviz method):
 * - One axis per chart, thin marks, 4px rounded data-ends, 2px gaps.
 * - Every plot ships a real hover layer (pointer-tracked tooltip + column
 *   highlight), not just native `title` — native tooltips are invisible on
 *   touch and slow on desktop.
 * - Sequential magnitude = the app accent hue; the score ramp (multi-hue
 *   OKLCh spectrum) appears only where color *is* the score — redundant with
 *   an axis or label, and always beside a stated 1→5 legend.
 * - Text wears text tokens; series color lives in marks and legend swatches.
 * - All motion (reveal, bar growth, gauge sweep, count-up) collapses under
 *   `prefers-reduced-motion`.
 */

// ── Motion CSS (inject once per page via <style>{TASTE_MOTION_CSS}</style>) ──

export const TASTE_MOTION_CSS = `
.tr-reveal{opacity:0;transform:translateY(16px);transition:opacity .65s ease,transform .65s cubic-bezier(.16,1,.3,1)}
.tr-reveal.is-in{opacity:1;transform:none}
.tr-reveal .tr-bar{transform:scaleY(0);transform-origin:bottom;transition:transform .7s cubic-bezier(.22,.61,.36,1)}
.tr-reveal.is-in .tr-bar{transform:scaleY(1)}
.tr-reveal .tr-gauge-arc{stroke-dashoffset:var(--tr-c);transition:stroke-dashoffset 1.1s cubic-bezier(.22,.61,.36,1) .1s}
.tr-reveal.is-in .tr-gauge-arc{stroke-dashoffset:var(--tr-off)}
.tr-reveal .tr-grow{transform:scaleX(0);transform-origin:left;transition:transform .8s cubic-bezier(.22,.61,.36,1) .15s}
.tr-reveal.is-in .tr-grow{transform:scaleX(1)}
@media (prefers-reduced-motion:reduce){
  .tr-reveal{opacity:1;transform:none;transition:none}
  .tr-reveal .tr-bar,.tr-reveal .tr-grow{transform:none;transition:none}
  .tr-reveal .tr-gauge-arc{transition:none}
}
`;

/** Scroll-triggered fade-up wrapper. Fires once, ~15% visible. */
export function Reveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -30px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`tr-reveal ${inView ? 'is-in' : ''} ${className ?? ''}`}>
      {children}
    </div>
  );
}

/** Ease-out number count-up; instant under reduced motion. */
export function CountUp({
  value,
  decimals = 0,
  duration = 950,
}: {
  value: number;
  decimals?: number;
  duration?: number;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tabular-nums">{shown.toFixed(decimals)}</span>;
}

// ── Hover layer ─────────────────────────────────────────────────────────────

/** Track which of `count` equal-width bins the pointer is over. */
function useBinHover(count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || count === 0) return;
    const rect = el.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * count);
    setHover(Math.max(0, Math.min(count - 1, i)));
  };
  return { ref, hover, onPointerMove, onPointerLeave: () => setHover(null) };
}

/** Ink-on-page tooltip pinned above bin `i` of `count`. */
function BinTooltip({ i, count, text }: { i: number; count: number; text: string }) {
  const left = Math.max(6, Math.min(94, ((i + 0.5) / count) * 100));
  return (
    <div
      className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink/90 px-2 py-1 text-[11px] font-semibold text-page whitespace-nowrap shadow-sm"
      style={{ left: `${left}%` }}
    >
      {text}
    </div>
  );
}

/** The app's 1→5 score ramp, stated: `1 ▓▓▓▓ 5 · label`. */
export function RampLegend({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] text-muted tabular-nums">1</span>
      <span
        className="h-[6px] w-14 rounded-full"
        style={{
          background: `linear-gradient(to right, ${[1, 2, 3, 4, 5]
            .map((s) => spectrumColor(s, 0.62, 1))
            .join(', ')})`,
        }}
      />
      <span className="text-[10px] text-muted tabular-nums">5</span>
      <span className="text-[10px] text-muted">{label}</span>
    </span>
  );
}

// ── Release-year histogram ──────────────────────────────────────────────────

/**
 * A smooth SVG path through (x,y) points using **monotone cubic Hermite**
 * interpolation (Fritsch–Carlson tangents). Chosen over Catmull-Rom because it
 * is shape-preserving: the curve never overshoots the values it connects, so a
 * trend line falling into a run of zero-count years eases down onto the baseline
 * instead of dipping below it or ringing — the discontinuity is handled, not
 * papered over. Points must be x-ascending; y is in SVG space (down = larger).
 */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;

  // Secant slopes between consecutive points.
  const h: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    h.push(dx);
    s.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
  }

  // Tangents: endpoints take the adjacent secant; interior points use the
  // weighted harmonic mean, forced flat at local extrema (where the sign flips)
  // so no segment can overshoot — this is what keeps the curve off the axis.
  const t: number[] = new Array(n);
  t[0] = s[0];
  t[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (s[i - 1] * s[i] <= 0) {
      t[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      t[i] = (w1 + w2) / (w1 / s[i - 1] + w2 / s[i]);
    }
  }

  // Emit one cubic Bézier per interval; control points ride the tangents at h/3.
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c1x = pts[i].x + h[i] / 3;
    const c1y = pts[i].y + (t[i] * h[i]) / 3;
    const c2x = pts[i + 1].x - h[i] / 3;
    const c2y = pts[i + 1].y - (t[i + 1] * h[i]) / 3;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[
      i + 1
    ].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/**
 * Rated releases per release-year: accent bars, a centred 5-year moving
 * average, and a shaded mean±sd "your era" band. Hover shows year · count.
 */
export function YearChart({
  years,
  label,
  trendLabel,
  meanYear,
  sdYears,
  eraLabel,
}: {
  years: { year: number; count: number }[];
  label: string;
  trendLabel: string;
  meanYear: number | null;
  sdYears: number | null;
  eraLabel: string;
}) {
  const { ref, hover, onPointerMove, onPointerLeave } = useBinHover(years.length);
  const max = Math.max(1, ...years.map((y) => y.count));
  const peak = years.reduce((best, y, i) => (y.count > years[best].count ? i : best), 0);

  // Centred moving average with an edge-shrinking window, so the line spans
  // the full range instead of stopping two years short.
  const W = 2;
  const trend = years.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(years.length - 1, i + W); j += 1) {
      sum += years[j].count;
      n += 1;
    }
    return sum / n;
  });

  const H = 100;
  const step = years.length > 1 ? 100 / (years.length - 1) : 0;
  // Smooth, shape-preserving trend: a monotone cubic through the moving-average
  // points, so the line reads as a continuous curve yet still eases onto the
  // baseline across zero-count years rather than overshooting below it.
  //
  // The y-map is inset top and bottom: a flat/zero stretch (e.g. recent years
  // with nothing rated) then rides *visibly just above the axis* instead of
  // landing on y=H, where the SVG's bottom edge and the border clip it and the
  // line looks like it stops at the last non-empty year. With the inset the
  // trend spans the whole range end to end.
  const TREND_TOP = 4;
  const TREND_BOT = 6;
  const trendY = (v: number) => TREND_TOP + (1 - v / max) * (H - TREND_TOP - TREND_BOT);
  const path = monotonePath(trend.map((v, i) => ({ x: i * step, y: trendY(v) })));

  // Era band: mean ± sd mapped onto slot centres, clamped to the domain.
  const first = years[0]?.year ?? 0;
  const slot = (y: number) =>
    Math.max(0, Math.min(100, ((y - first + 0.5) / years.length) * 100));
  const band =
    meanYear != null && sdYears != null && sdYears > 0
      ? { lo: slot(meanYear - sdYears), hi: slot(meanYear + sdYears) }
      : null;

  const tickEvery = Math.max(1, Math.ceil(years.length / 6));

  return (
    <div className="mt-5">
      <div className="relative">
        {band && (
          <div
            className="absolute inset-y-0 rounded-md bg-accent/[0.07] border-x border-accent/20 pointer-events-none"
            style={{ left: `${band.lo}%`, width: `${Math.max(0, band.hi - band.lo)}%` }}
          >
            <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-0.5 text-[10px] font-bold text-accent-deep/80 whitespace-nowrap">
              {eraLabel}
            </span>
          </div>
        )}
        <div
          ref={ref}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          className="relative flex items-end gap-[2px] h-32 border-b border-divider"
          aria-label={label}
        >
          {years.map((y, i) => (
            <div
              key={y.year}
              className={`flex-1 min-w-0 h-full flex flex-col items-center justify-end rounded-sm ${
                hover === i ? 'bg-ink/[0.05]' : ''
              }`}
            >
              {i === peak && y.count > 0 && hover == null && (
                <span className="text-[10px] font-semibold text-muted mb-0.5 tabular-nums">
                  {y.count}
                </span>
              )}
              <span
                className={`tr-bar w-full rounded-t ${hover === i ? 'bg-accent' : 'bg-accent/70'}`}
                style={{
                  height: y.count > 0 ? Math.max(3, Math.round((y.count / max) * 100)) : 0,
                  transitionDelay: `${Math.min(i * 9, 350)}ms`,
                }}
              />
            </div>
          ))}
          {hover != null && years[hover] && (
            <BinTooltip
              i={hover}
              count={years.length}
              text={`${years[hover].year} · ${years[hover].count}`}
            />
          )}
        </div>
        {years.length > 2 && (
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
            aria-hidden
          >
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              className="text-ink/45"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <div className="flex gap-[2px] mt-1">
        {years.map((y, i) => (
          <span
            key={y.year}
            className="flex-1 min-w-0 text-center text-[10px] text-muted/70 tabular-nums"
          >
            {i % tickEvery === 0 || i === years.length - 1 ? y.year : ''}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent/70 shrink-0" />
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-[2px] rounded-full bg-ink/45 shrink-0" />
          {trendLabel}
        </span>
      </div>
    </div>
  );
}

// ── Score distribution ──────────────────────────────────────────────────────

/**
 * Half-star bins where each bar wears the score ramp at its own score — color
 * restates the x-axis (never the sole encoding) and the RampLegend names the
 * scale. Mean marker on top; hover shows score · count.
 */
export function ScoreChart({
  bins,
  mean,
  legend,
}: {
  bins: number[];
  mean: { pos: number; label: string } | null;
  legend: string;
}) {
  const { ref, hover, onPointerMove, onPointerLeave } = useBinHover(bins.length);
  const max = Math.max(1, ...bins);
  const peak = bins.reduce((best, x, i) => (x > bins[best] ? i : best), 0);
  const scoreAt = (i: number) => (i + 1) / 2;

  return (
    <div className="mt-8">
      <div className="relative">
        <div
          ref={ref}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          className="relative flex items-end gap-[3px] h-28 border-b border-divider"
        >
          {bins.map((count, i) => (
            <div
              key={i}
              className={`flex-1 h-full flex flex-col items-center justify-end min-w-0 rounded-sm ${
                hover === i ? 'bg-ink/[0.05]' : ''
              }`}
            >
              {i === peak && count > 0 && hover == null && (
                <span className="text-[10px] font-semibold text-muted mb-0.5 tabular-nums">
                  {count}
                </span>
              )}
              <span
                className="tr-bar w-full max-w-[26px] rounded-t"
                style={{
                  height: count > 0 ? Math.max(3, Math.round((count / max) * 88)) : 0,
                  background: spectrumColor(scoreAt(i), 0.62, hover === i ? 1 : 0.9),
                  transitionDelay: `${i * 35}ms`,
                }}
              />
            </div>
          ))}
          {hover != null && (
            <BinTooltip
              i={hover}
              count={bins.length}
              text={`${scoreAt(hover).toFixed(1)}★ · ${bins[hover]}`}
            />
          )}
        </div>
        {mean && (
          <>
            <span
              className="absolute -top-1 bottom-0 w-px bg-ink/35 pointer-events-none"
              style={{ left: `${Math.max(2, Math.min(98, mean.pos * 100))}%` }}
            />
            <span
              className="absolute -top-6 -translate-x-1/2 text-[10px] font-semibold text-muted whitespace-nowrap pointer-events-none"
              style={{ left: `${Math.max(10, Math.min(90, mean.pos * 100))}%` }}
            >
              {mean.label}
            </span>
          </>
        )}
      </div>
      <div className="flex gap-[3px] mt-1">
        {bins.map((_, i) => (
          <span key={i} className="flex-1 min-w-0 text-center text-[10px] text-muted/70 tabular-nums">
            {i % 2 === 1 ? scoreAt(i) : ''}
          </span>
        ))}
      </div>
      <div className="mt-2.5">
        <RampLegend label={legend} />
      </div>
    </div>
  );
}

// ── Scene mix ───────────────────────────────────────────────────────────────

/** Part-to-whole stacked bar; 2px surface gaps; grows in on reveal. */
export function SceneBar({
  segments,
}: {
  segments: { share: number; color: string; title: string }[];
}) {
  return (
    <div className="tr-grow mt-4 flex h-[14px] rounded-full overflow-hidden gap-[2px]">
      {segments.map((s, i) => (
        <span
          key={i}
          title={s.title}
          className="min-w-[6px]"
          style={{ flex: `${s.share} 1 0px`, background: s.color }}
        />
      ))}
    </div>
  );
}

// ── Canon gauge ─────────────────────────────────────────────────────────────

/** Radial donut gauge: track in divider, arc in accent, % + label centred. */
export function CanonGauge({ pct, label }: { pct: number; label: string }) {
  const r = 46;
  const C = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative w-[132px] h-[132px]">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="9" className="stroke-divider/80" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="tr-gauge-arc stroke-accent"
          strokeDasharray={C}
          style={{
            ['--tr-c' as string]: `${C}px`,
            ['--tr-off' as string]: `${C * (1 - clamped)}px`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-black text-ink leading-none tabular-nums">
          {Math.round(clamped * 100)}%
        </span>
        <span className="mt-1 text-[10px] font-semibold text-muted text-center leading-tight px-4">
          {label}
        </span>
      </div>
    </div>
  );
}

// ── Community dumbbells ─────────────────────────────────────────────────────

/** Shared 0.5–5 axis header for the dumbbell rows below it. */
export function DumbbellAxis() {
  const ticks = [1, 2, 3, 4, 5];
  const pos = (v: number) => Math.max(2, Math.min(98, ((v - 0.5) / 4.5) * 100));
  return (
    <div className="relative h-4 mb-1">
      {ticks.map((v) => (
        <span
          key={v}
          className="absolute -translate-x-1/2 text-[10px] text-muted/60 tabular-nums"
          style={{ left: `${pos(v)}%` }}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

/**
 * You-vs-community dumbbell on the fixed 0.5–5.0 track; dots wear surface
 * rings; a CSS-only tooltip with both values appears on hover/focus.
 */
export function DumbbellRow({
  user,
  community,
  tipText,
}: {
  user: number;
  community: number;
  tipText: string;
}) {
  const pos = (v: number) => Math.max(2, Math.min(98, ((v - 0.5) / 4.5) * 100));
  const lo = Math.min(pos(user), pos(community));
  const hi = Math.max(pos(user), pos(community));
  const mid = (lo + hi) / 2;
  return (
    <div className="group relative h-[20px]" tabIndex={0}>
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-divider/70" />
      <span
        className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-muted/40"
        style={{ left: `${lo}%`, width: `${hi - lo}%` }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[11px] h-[11px] rounded-full bg-muted/50 ring-2 ring-surface"
        style={{ left: `${pos(community)}%` }}
      />
      <span
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[11px] h-[11px] rounded-full bg-accent ring-2 ring-surface"
        style={{ left: `${pos(user)}%` }}
      />
      <span
        className="pointer-events-none absolute -top-0.5 -translate-x-1/2 -translate-y-full rounded-md bg-ink/90 px-2 py-1 text-[11px] font-semibold text-page whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 z-10"
        style={{ left: `${Math.max(14, Math.min(86, mid))}%` }}
      >
        {tipText}
      </span>
    </div>
  );
}

// ── 12-month activity ───────────────────────────────────────────────────────

/** Monthly rating counts; the peak month wears accent and its own label. */
export function ActivitySpark({
  timeline,
  peakIndex,
  monthLabel,
}: {
  timeline: { month: string; count: number }[];
  peakIndex: number | null;
  monthLabel: (month: string) => string;
}) {
  const { ref, hover, onPointerMove, onPointerLeave } = useBinHover(timeline.length);
  const max = Math.max(1, ...timeline.map((t) => t.count));
  return (
    <div>
      <div
        ref={ref}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        className="relative flex items-end gap-[3px] h-16 border-b border-divider"
      >
        {timeline.map((m, i) => (
          <div
            key={m.month}
            className={`flex-1 min-w-0 h-full flex items-end rounded-sm ${
              hover === i ? 'bg-ink/[0.05]' : ''
            }`}
          >
            <span
              className={`tr-bar w-full rounded-t ${
                i === peakIndex ? 'bg-accent' : 'bg-accent/30'
              }`}
              style={{
                height: m.count > 0 ? Math.max(3, Math.round((m.count / max) * 56)) : 2,
                transitionDelay: `${i * 30}ms`,
              }}
            />
          </div>
        ))}
        {hover != null && timeline[hover] && (
          <BinTooltip
            i={hover}
            count={timeline.length}
            text={`${monthLabel(timeline[hover].month)} · ${timeline[hover].count}`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted/70 tabular-nums">
        <span>{monthLabel(timeline[0]?.month ?? '')}</span>
        <span>{monthLabel(timeline[timeline.length - 1]?.month ?? '')}</span>
      </div>
    </div>
  );
}
