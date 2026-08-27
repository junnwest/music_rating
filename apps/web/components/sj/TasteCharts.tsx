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
 * Your library across the years, drawn as a two-panel "stock" chart of bars.
 *
 * Top panel — a diverging column per release year: the bar grows **up in blue**
 * when your mean rating for that year beats your overall average, **down in red**
 * when it falls below, its length set by how far it diverges. Years you rated
 * nothing from are simply blank — a gap, never an invented value — which is why
 * bars read cleanly here where a line could not.
 *
 * Bottom panel — how many releases you rated from each year, as light bars, with
 * a centred 5-year moving average over the counts: the "rating pace" line (the
 * moving average of the *frequency*, replacing the old broken trend).
 *
 * Hover snaps to a year: mean rating (with ▲/▼ against your average) and count.
 */
export function YearChart({
  years,
  avgScore,
  aboveLabel,
  belowLabel,
  freqLabel,
  freqTrendLabel,
  baselineLabel,
}: {
  years: { year: number; count: number; avg: number | null }[];
  avgScore: number;
  aboveLabel: string;
  belowLabel: string;
  freqLabel: string;
  freqTrendLabel: string;
  baselineLabel: string;
}) {
  const { ref, hover, onPointerMove, onPointerLeave } = useBinHover(years.length);
  const n = years.length;
  // Column centres (percent) — bars, the hover guide, ticks and the pace line
  // all key off these, so every layer stays aligned.
  const cx = (i: number) => ((i + 0.5) / n) * 100;

  // ── Score panel: diverging bars around your overall average ──
  // Height encodes the *magnitude* of divergence; the larger absolute swing
  // (above or below) sets the full-scale so both directions share one scale.
  const devs = years.map((y) => (y.avg == null ? null : y.avg - avgScore));
  const maxDev = Math.max(0.1, ...devs.map((d) => (d == null ? 0 : Math.abs(d))));
  const HALF = 44; // % of panel height each side of the midline can fill
  const barPct = (dev: number) => Math.max(4, (Math.abs(dev) / maxDev) * HALF);

  // ── Frequency panel: release counts + a centred 5-year moving average ──
  const maxCount = Math.max(1, ...years.map((y) => y.count));
  const BAR_MAX = 92; // of the 100-unit viewBox
  const yVol = (v: number) => 100 - (v / maxCount) * BAR_MAX;
  const W = 2;
  const pace = years.map((_, i) => {
    let sum = 0;
    let k = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j += 1) {
      sum += years[j].count;
      k += 1;
    }
    return sum / k;
  });
  const pacePath = monotonePath(pace.map((v, i) => ({ x: cx(i), y: yVol(v) })));

  const tickEvery = Math.max(1, Math.ceil(n / 6));
  const hy = hover != null ? years[hover] : null;
  const hoverX = hover != null ? cx(hover) : 0;
  const tipLeft = Math.max(8, Math.min(92, hoverX));

  return (
    <div className="mt-5">
      <div ref={ref} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} className="relative">
        {/* ── score panel ── */}
        <div className="relative h-40">
          {/* baseline = your overall average, at the vertical midline */}
          <span className="absolute inset-x-0 top-1/2 h-px bg-ink/20 pointer-events-none" />
          <span className="absolute right-0 top-1/2 -translate-y-1/2 pl-1 text-[10px] font-semibold text-muted tabular-nums bg-surface">
            {baselineLabel} {avgScore.toFixed(2)}
          </span>
          {/* diverging bars */}
          <div className="absolute inset-0 flex items-stretch gap-[2px]">
            {years.map((y, i) => {
              const dev = devs[i];
              const up = dev != null && dev >= 0;
              return (
                <div
                  key={y.year}
                  className={`relative flex-1 min-w-0 rounded-sm ${hover === i ? 'bg-ink/[0.05]' : ''}`}
                >
                  {dev != null && (
                    <span
                      className="absolute left-0 right-0 mx-auto w-[62%] max-w-[16px]"
                      style={{
                        [up ? 'bottom' : 'top']: '50%',
                        height: `${barPct(dev)}%`,
                        background: up ? 'var(--tr-up)' : 'var(--tr-dn)',
                        opacity: hover == null || hover === i ? 1 : 0.72,
                        borderRadius: up ? '3px 3px 0 0' : '0 0 3px 3px',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* hover guide + tooltip */}
          {hover != null && (
            <span
              className="absolute inset-y-0 w-px bg-ink/20 pointer-events-none"
              style={{ left: `${hoverX}%` }}
            />
          )}
          {hy && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink/90 px-2 py-1 text-[11px] font-semibold text-page whitespace-nowrap shadow-sm"
              style={{ left: `${tipLeft}%` }}
            >
              {hy.year} ·{' '}
              {hy.avg != null ? (
                <span>
                  {hy.avg.toFixed(2)}★{' '}
                  <span style={{ color: hy.avg >= avgScore ? 'var(--tr-up)' : 'var(--tr-dn)' }}>
                    {hy.avg >= avgScore ? '▲' : '▼'}
                    {Math.abs(hy.avg - avgScore).toFixed(2)}
                  </span>
                </span>
              ) : (
                <span className="text-page/60">—</span>
              )}{' '}
              · {hy.count}
            </div>
          )}
        </div>

        {/* ── frequency panel ── */}
        <div className="relative h-14 mt-2">
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {years.map((y, i) => (
              <div key={y.year} className="flex-1 min-w-0 h-full flex items-end">
                <span
                  className={`w-full mx-auto max-w-[16px] rounded-t ${hover === i ? 'bg-accent' : 'bg-accent/30'}`}
                  style={{ height: `${y.count > 0 ? Math.max(4, (y.count / maxCount) * 100) : 0}%` }}
                />
              </div>
            ))}
          </div>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full pointer-events-none"
            aria-hidden
          >
            <path
              d={pacePath}
              fill="none"
              stroke="currentColor"
              className="text-ink/50"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {hover != null && (
            <span
              className="absolute inset-y-0 w-px bg-ink/15 pointer-events-none"
              style={{ left: `${hoverX}%` }}
            />
          )}
        </div>
      </div>

      {/* year axis */}
      <div className="relative mt-1 h-3">
        {years.map((y, i) =>
          i % tickEvery === 0 || i === n - 1 ? (
            <span
              key={y.year}
              className="absolute -translate-x-1/2 text-[10px] text-muted/70 tabular-nums"
              style={{ left: `${Math.max(3, Math.min(97, cx(i)))}%` }}
            >
              {y.year}
            </span>
          ) : null,
        )}
      </div>

      {/* legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'var(--tr-up)' }} />
          {aboveLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: 'var(--tr-dn)' }} />
          {belowLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent/30 shrink-0" />
          {freqLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-[2px] rounded-full bg-ink/50 shrink-0" />
          {freqTrendLabel}
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
