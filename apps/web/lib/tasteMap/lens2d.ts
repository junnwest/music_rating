/**
 * Screen-space display lenses for the 2D star chart (client-side, pure; Map2D
 * applies them after projecting stars to the screen, so they never touch the
 * layout, only how it is drawn and hit-tested).
 *
 * - parallaxShift: the cursor's offset from the stage center tilts the sky.
 *   Stars shift opposite the cursor in proportion to their depth along the
 *   plane normal (the same depth the 2D lightness shows), so the flat chart
 *   reads as a volume. The background (field, contours, territories) is depth 0
 *   and stays put.
 * - magnify: a graphical fisheye with a smooth Gaussian falloff,
 *   r' = r · (1 + m·e^(−r²/2σ²)). Magnification 1 + m at the cursor, 1 far away,
 *   continuous slope everywhere and monotone for m < 2.2 (the derivative's
 *   minimum, 1 − 0.446m at r = √3σ, stays positive), so stars never cross.
 *   Returns the growth factor for the star's size too.
 * - separate: overlap removal for discs on screen (covers when zoomed in, big
 *   stars when crowded): pairwise pushes, capped per star.
 * - approach: frame-rate independent exponential smoothing.
 */

/** Pixels of shift per unit depth (σ) at the stage's edge. */
export const PARALLAX_PX = 7;
/** Fisheye: magnification at the cursor − 1, and its reach (px). */
export const FISHEYE_M = 0.55;
export const FISHEYE_SIGMA = 62;

/**
 * Shift for a star at depth `zNorm` (σ units, + = in front) with the cursor at
 * (ux, uy) ∈ [−1, 1]² relative to the stage center.
 */
export function parallaxShift(zNorm: number, ux: number, uy: number, px = PARALLAX_PX): [number, number] {
  const z = Math.max(-2.5, Math.min(2.5, zNorm));
  return [-ux * z * px, -uy * z * px];
}

/** Fisheye around (cx, cy) at `strength` 0…1. */
export function magnify(
  x: number,
  y: number,
  cx: number,
  cy: number,
  strength: number,
  m = FISHEYE_M,
  sigma = FISHEYE_SIGMA,
): { x: number; y: number; grow: number } {
  if (strength <= 0) return { x, y, grow: 1 };
  const dx = x - cx;
  const dy = y - cy;
  const g = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  const f = m * strength * g;
  return { x: cx + dx * (1 + f), y: cy + dy * (1 + f), grow: 1 + 0.8 * f };
}

/**
 * Offsets that pull overlapping discs apart: each overlapping pair is pushed
 * along its center line by half the overlap (+ pad), a few sweeps, and each
 * star's total offset is capped at `maxShift` (px) so the map's shape survives.
 */
export function separate(
  pts: { x: number; y: number; r: number }[],
  pad = 2,
  sweeps = 3,
  maxShift = 24,
): Float32Array {
  const n = pts.length;
  const off = new Float32Array(n * 2);
  if (n < 2) return off;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  // Sort by x so each star only checks neighbors within reach.
  const maxR = Math.max(...pts.map((p) => p.r));
  for (let s = 0; s < sweeps; s++) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
    let moved = false;
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi];
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj];
        const dx = xs[j] - xs[i];
        const need = pts[i].r + pts[j].r + pad;
        if (dx > pts[i].r + maxR + pad) break;
        const dy = ys[j] - ys[i];
        const d = Math.hypot(dx, dy);
        if (d >= need) continue;
        const ux = d > 1e-6 ? dx / d : 1;
        const uy = d > 1e-6 ? dy / d : 0;
        const push = (need - d) / 2;
        xs[i] -= ux * push;
        ys[i] -= uy * push;
        xs[j] += ux * push;
        ys[j] += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) {
    let dx = xs[i] - pts[i].x;
    let dy = ys[i] - pts[i].y;
    const d = Math.hypot(dx, dy);
    if (d > maxShift) {
      dx *= maxShift / d;
      dy *= maxShift / d;
    }
    off[2 * i] = dx;
    off[2 * i + 1] = dy;
  }
  return off;
}

/** Cursor focus: a star within FOCUS_R px (edge-inclusive) takes the focus; it keeps it out to FOCUS_RELEASE px. */
export const FOCUS_R = 64;
export const FOCUS_RELEASE = 96;
/** A rival must be this much closer than the focused star to take the focus over. */
export const FOCUS_SWITCH = 0.6;

/**
 * Which star the cursor is focused on (Map2D: that star holds still and glows,
 * the sky's parallax pivots on its depth, the fisheye centers on it). Distances
 * are to each star's edge (center distance − radius, ≥ 0), from what was drawn
 * last frame. Hysteresis keeps the focus from flickering between close stars:
 * the current focus holds until the cursor is FOCUS_RELEASE px away or a rival
 * is under FOCUS_SWITCH × its distance.
 */
export function pickFocus(
  stars: Iterable<[string, { x: number; y: number; r: number }]>,
  cx: number,
  cy: number,
  current: string | null,
  radius = FOCUS_R,
  release = FOCUS_RELEASE,
): { key: string | null; d: number } {
  let best: string | null = null;
  let bestD = Infinity;
  let curD = Infinity;
  for (const [key, q] of stars) {
    const d = Math.max(0, Math.hypot(q.x - cx, q.y - cy) - q.r);
    if (key === current) curD = d;
    if (d < bestD) {
      bestD = d;
      best = key;
    }
  }
  if (current != null && curD <= release) {
    if (best !== current && bestD < curD * FOCUS_SWITCH && bestD <= radius) return { key: best, d: bestD };
    return { key: current, d: curD };
  }
  return bestD <= radius ? { key: best, d: bestD } : { key: null, d: Infinity };
}

/** Move `from` toward `to` with time constant `tauMs` over `dtMs` (frame-rate independent). */
export function approach(from: number, to: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return to;
  return to + (from - to) * Math.exp(-Math.max(0, dtMs) / tauMs);
}

/**
 * Semantic zoom: how many labels compete at zoom k (the rest wait until you
 * zoom in), and how far stars have turned into album covers (0…1).
 */
export function labelBudget(k: number, n: number): number {
  return Math.min(n, Math.round(10 + 14 * Math.max(0, k - 0.6) ** 1.4));
}
export const COVER_K0 = 2.4;
export const COVER_K1 = 3.6;
export function coverAmount(k: number): number {
  const t = Math.min(1, Math.max(0, (k - COVER_K0) / (COVER_K1 - COVER_K0)));
  return t * t * (3 - 2 * t);
}

/** Cover half-size (px) at zoom k for a node of `mass` rated albums. */
export function coverHalf(mass: number, k: number): number {
  return Math.min(40, (9 + 3.2 * Math.sqrt(Math.max(0, mass))) * (0.25 + 0.26 * k));
}

/** A small thumbnail URL for known cover hosts (the full-size art is 600px+). */
export function coverThumb(url: string): string {
  // Apple: …/600x600bb.jpg → …/160x160bb.jpg
  const apple = url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|png|webp)$/i, '/160x160bb.$2');
  if (apple !== url) return apple;
  // Cover Art Archive: …/front-500 or …/front → …/front-250
  if (/coverartarchive\.org\/release(-group)?\//.test(url)) return url.replace(/\/front(-\d+)?$/, '/front-250');
  return url;
}
