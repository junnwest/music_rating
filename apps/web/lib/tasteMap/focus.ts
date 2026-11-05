/**
 * Selection refocus for the 2D map (client-side, pure; animated by Map2D).
 *
 * Selecting a star re-lays the others out around it, in plane units, with the
 * selected star kept where it is so the view stays anchored:
 *
 * - distance: an ego view. Radius = simRadius(true similarity to the selected
 *   star) × R, bearing kept from the current view so the map stays
 *   recognizable. Similarity on this map is mostly small (zero: median 0.09,
 *   max 0.69), so the radius is logarithmic in similarity, not linear: the
 *   0.8 / 0.6 / 0.4 / 0.2 / 0.1 rings land at 0.06 / 0.14 / 0.25 / 0.42 / 0.58 R
 *   instead of all crowding into the outer quarter. Stars that collide are
 *   nudged along their ring (bearing only), so the radius stays exact.
 * - vector: x = the same similarity scale (the selected star at the right end,
 *   less alike further left), y = the strongest remaining direction among the
 *   others: the first principal axis of their sound mix after removing the
 *   selected star's own mix direction (labelled by the tags at each end), or,
 *   without a palette, of their similarity rows (labelled by the artists at
 *   each end). The axis is fitted with weights that favor stars similar to
 *   the selection (the neighborhood you're reading), and y is half the
 *   projection, half its rank (evened out), so one far-off cluster can't
 *   squash everyone else into a line. Collisions move stars vertically only.
 * - depth: a side elevation. x = in-plane offset from the selected star (as in
 *   the current view), y = depth along the plane normal relative to it, in
 *   standard deviations (up = in front). Collisions move stars only sideways.
 *
 * whatsHere: the kernel-weighted sound mix and nearest artists at a point of
 * empty sky (the "What's here?" card).
 */
import type { NodeKey, PaletteHue, Vec2 } from './types';

export type EgoMode = 'distance' | 'vector' | 'depth';
export const EGO_MODES: readonly EgoMode[] = ['distance', 'vector', 'depth'];

/** Similarity floor of the log scale: below it everything sits at the rim. */
export const SIM_EPS = 0.03;
/** Labelled similarity rings / ticks. */
export const RINGS = [0.8, 0.6, 0.4, 0.2, 0.1] as const;
/** Vector mode: x span and y half-height, in units of R. */
export const VEC_W = 1.5;
export const VEC_H = 0.8;

/** Radius fraction (0 at sim 1, 1 at sim 0) for a true similarity. Monotone, log-scaled. */
export function simRadius(sim: number, eps = SIM_EPS): number {
  const s = Math.min(1, Math.max(0, sim));
  return Math.log((1 + eps) / (s + eps)) / Math.log((1 + eps) / eps);
}

export interface EgoNode {
  key: NodeKey;
  /** Current plane position (as shown, before the refocus). */
  x: number;
  y: number;
  /** Depth along the plane normal, in standard deviations (+ = in front). */
  z: number;
  mass: number;
  mix?: Record<string, number>;
}

export interface EgoInput {
  nodes: EgoNode[];
  selected: NodeKey;
  /** True similarity of every other node to the selected one (similarityLookup.row). */
  sim: Map<NodeKey, number>;
  /** Other nodes' similarity rows, for the vector fallback without a palette. */
  simOf?: (a: NodeKey, b: NodeKey) => number | null;
  mode: EgoMode;
  /** Plane units: the outer ring's radius (distance), the x span (vector). */
  R: number;
  /** Minimum center distance between stars, plane units. */
  minSep: number;
  palette?: PaletteHue[];
  labelOf?: (key: NodeKey) => string;
}

export interface EgoAxis {
  /** Words at the positive / negative ends. */
  pos: string;
  neg: string;
  /** Tag ids at the ends (vector mode with a palette), for coloring. */
  posId?: string;
  negId?: string;
}

export interface EgoLayout {
  key: NodeKey;
  mode: EgoMode;
  center: Vec2;
  R: number;
  pos: Map<NodeKey, Vec2>;
  /** Plane-unit radius of each labelled ring (distance) / x of each tick (vector). */
  rings: { sim: number; r: number }[];
  /** vector: the vertical axis's meaning. */
  axis: EgoAxis | null;
  /** depth: plane units per standard deviation of depth. */
  zUnit: number;
  /** Per node 0..1: how early it moves in the staggered transition (nearest first). */
  order: Map<NodeKey, number>;
}

export function egoLayout(input: EgoInput): EgoLayout {
  const { nodes, selected, sim, mode, R, minSep } = input;
  const sel = nodes.find((n) => n.key === selected);
  const center: Vec2 = sel ? [sel.x, sel.y] : [0, 0];
  const others = nodes.filter((n) => n.key !== selected);
  const pos = new Map<NodeKey, Vec2>();
  if (sel) pos.set(sel.key, center);
  const simTo = (k: NodeKey) => sim.get(k) ?? 0;

  let axis: EgoAxis | null = null;
  let zUnit = 0;
  let rings: { sim: number; r: number }[] = [];

  if (mode === 'distance') {
    const pts = others.map((n) => {
      const r = Math.max(minSep * 1.1, simRadius(simTo(n.key)) * R);
      const dx = n.x - center[0];
      const dy = n.y - center[1];
      // A star exactly on the selection keeps a bearing from its key, so it's stable.
      const th = Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dy, dx) : hashAngle(n.key);
      return { key: n.key, r, th };
    });
    relaxBearings(pts, minSep);
    for (const p of pts) pos.set(p.key, [center[0] + p.r * Math.cos(p.th), center[1] + p.r * Math.sin(p.th)]);
    rings = RINGS.map((s) => ({ sim: s, r: simRadius(s) * R }));
  } else if (mode === 'vector') {
    const W = R * VEC_W;
    const H = R * VEC_H;
    const { values, axis: ax } = secondaryAxis(input, others);
    axis = ax;
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const evened = new Array<number>(values.length).fill(0);
    order.forEach((i, r) => (evened[i] = order.length > 1 ? (2 * r) / (order.length - 1) - 1 : 0));
    const ys = values.map((v, i) => (values.every((x) => x === 0) ? 0 : 0.5 * v + 0.5 * evened[i]));
    const pts = others.map((n, i) => ({ key: n.key, x: center[0] - simRadius(simTo(n.key)) * W, y: center[1] + ys[i] * H }));
    relaxAlong(pts, minSep, 'y');
    for (const p of pts) pos.set(p.key, [p.x, p.y]);
    rings = RINGS.map((s) => ({ sim: s, r: simRadius(s) * W }));
  } else {
    // Side elevation: keep the in-plane x offset (scaled to fit), depth goes vertical.
    const span = Math.max(1e-6, ...others.map((n) => Math.abs(n.x - center[0])));
    const sx = Math.min(1, R / span);
    const zs = others.map((n) => n.z - (sel?.z ?? 0));
    const zMax = Math.max(1, ...zs.map(Math.abs));
    zUnit = (R * 0.85) / zMax;
    const pts = others.map((n, i) => ({ key: n.key, x: center[0] + (n.x - center[0]) * sx, y: center[1] + zs[i] * zUnit }));
    relaxAlong(pts, minSep, 'x');
    for (const p of pts) pos.set(p.key, [p.x, p.y]);
  }

  // Stagger: the most similar move first.
  const ranked = [...others].sort((a, b) => simTo(b.key) - simTo(a.key));
  const order = new Map<NodeKey, number>(ranked.map((n, i) => [n.key, ranked.length > 1 ? i / (ranked.length - 1) : 0]));
  if (sel) order.set(sel.key, 0);
  return { key: selected, mode, center, R, pos, rings, axis, zUnit, order };
}

/** Deterministic angle in [−π, π) from a key. */
function hashAngle(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 * Math.PI - Math.PI;
}

/**
 * Spread stars that collide along their own ring: radius fixed, bearings pushed
 * apart (each pair by half the missing gap), a few sweeps. Only pairs whose
 * radii differ by less than minSep can collide, so pairs are scanned in radius
 * order and the scan stops early (≈ 1 ms for 300 stars).
 */
export function relaxBearings(pts: { r: number; th: number }[], minSep: number, sweeps = 40): void {
  const n = pts.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[a].r - pts[b].r);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const place = (i: number) => {
    xs[i] = pts[i].r * Math.cos(pts[i].th);
    ys[i] = pts[i].r * Math.sin(pts[i].th);
  };
  for (let i = 0; i < n; i++) place(i);
  for (let it = 0; it < sweeps; it++) {
    let moved = false;
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi];
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj];
        const a = pts[i];
        const b = pts[j];
        if (b.r - a.r >= minSep) break;
        const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
        if (d >= minSep) continue;
        let dth = b.th - a.th;
        while (dth > Math.PI) dth -= 2 * Math.PI;
        while (dth < -Math.PI) dth += 2 * Math.PI;
        const sign = dth === 0 ? (oi % 2 ? 1 : -1) : Math.sign(dth);
        // The bearing gap whose chord at the smaller radius is minSep (the
        // larger radius only adds distance), split between the two.
        const rr = Math.max(Math.min(a.r, b.r), minSep / 2);
        const gap = 2 * Math.asin(Math.min(1, minSep / (2 * rr)));
        const need = Math.max(0, gap - Math.abs(dth)) + 1e-6;
        a.th -= (sign * need) / 2;
        b.th += (sign * need) / 2;
        place(i);
        place(j);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Push colliding stars apart along one axis only (the other coordinate is
 * data). Pairs are scanned in order of the fixed coordinate, so the scan stops
 * as soon as they're minSep apart on it.
 */
export function relaxAlong(pts: { x: number; y: number }[], minSep: number, along: 'x' | 'y', sweeps = 40): void {
  const o = along === 'y' ? 'x' : 'y';
  const order = pts.map((_, i) => i).sort((a, b) => pts[a][o] - pts[b][o]);
  for (let it = 0; it < sweeps; it++) {
    let moved = false;
    for (let oi = 0; oi < order.length; oi++) {
      const a = pts[order[oi]];
      for (let oj = oi + 1; oj < order.length; oj++) {
        const b = pts[order[oj]];
        const dO = b[o] - a[o];
        if (dO >= minSep) break;
        const dA = b[along] - a[along];
        const d = Math.hypot(dO, dA);
        if (d >= minSep) continue;
        // Missing length along the free axis so the pair clears minSep.
        const need = Math.sqrt(minSep * minSep - dO * dO) - Math.abs(dA) + 1e-6;
        const sign = dA === 0 ? (oi % 2 ? 1 : -1) : Math.sign(dA);
        a[along] -= (sign * need) / 2;
        b[along] += (sign * need) / 2;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Vector mode's vertical axis: the others' first principal direction once the
 * selected star's own direction is removed. Values in [−1, 1], index-aligned
 * with `others`.
 */
export function secondaryAxis(input: EgoInput, others: EgoNode[]): { values: number[]; axis: EgoAxis | null } {
  const { palette, selected, nodes } = input;
  const zero = { values: others.map(() => 0), axis: null };
  if (others.length < 2) return zero;
  const label = input.labelOf ?? ((k: NodeKey) => k);

  const sel = nodes.find((n) => n.key === selected);
  const useMix = !!palette?.length && others.filter((n) => n.mix && Object.keys(n.mix).length).length >= 2;
  let dims: number;
  let vec: (n: EgoNode) => number[];
  if (useMix) {
    const ids = palette!.map((p) => p.id);
    dims = ids.length;
    vec = (n) => ids.map((id) => n.mix?.[id] ?? 0);
  } else if (input.simOf) {
    const ks = others.map((n) => n.key);
    dims = ks.length;
    vec = (n) => ks.map((k) => (k === n.key ? 1 : input.simOf!(n.key, k) ?? 0));
  } else return zero;

  // Remove the selected star's direction, so y is the strongest *other* contrast.
  const u = sel ? vec(sel) : null;
  const uLen = u ? Math.hypot(...u) : 0;
  const rows = others.map((n) => {
    const v = vec(n);
    if (u && uLen > 1e-9) {
      const d = v.reduce((s, x, i) => s + x * u[i], 0) / (uLen * uLen);
      for (let i = 0; i < dims; i++) v[i] -= d * u[i];
    }
    return v;
  });
  // The neighborhood being read counts most: weight by similarity to the selection.
  const w = others.map((n) => (0.5 + 0.5 * Math.sqrt(Math.max(0, n.mass))) * (0.15 + (input.sim.get(n.key) ?? 0)));
  const pc = principal(rows, w);
  if (!pc) return zero;
  let values = rows.map((r) => r.reduce((s, x, i) => s + (x - pc.mean[i]) * pc.dir[i], 0));
  const m = Math.max(...values.map(Math.abs));
  if (!(m > 1e-9)) return zero;
  values = values.map((x) => x / m);

  let axis: EgoAxis;
  if (useMix) {
    // Name each end by its heaviest loading tag; flip so the stronger end is up.
    let iMax = 0;
    let iMin = 0;
    pc.dir.forEach((x, i) => {
      if (x > pc.dir[iMax]) iMax = i;
      if (x < pc.dir[iMin]) iMin = i;
    });
    let flip = Math.abs(pc.dir[iMin]) > Math.abs(pc.dir[iMax]);
    if (pc.dir[iMax] <= 1e-9) flip = true;
    if (flip) values = values.map((x) => -x);
    const top = flip ? iMin : iMax;
    const bottom = flip ? iMax : iMin;
    const strongBottom = Math.abs(pc.dir[bottom]) > 0.15 && Math.sign(pc.dir[bottom]) !== Math.sign(pc.dir[top]);
    axis = {
      pos: palette![top].label,
      neg: strongBottom ? palette![bottom].label : '',
      posId: palette![top].id,
      negId: strongBottom ? palette![bottom].id : undefined,
    };
  } else {
    let iMax = 0;
    let iMin = 0;
    values.forEach((x, i) => {
      if (x > values[iMax]) iMax = i;
      if (x < values[iMin]) iMin = i;
    });
    axis = { pos: label(others[iMax].key), neg: label(others[iMin].key) };
  }
  return { values, axis };
}

/** Weighted first principal component by power iteration; null when there's no spread. */
export function principal(rows: number[][], w: number[]): { mean: number[]; dir: number[]; variance: number } | null {
  const n = rows.length;
  const d = rows[0]?.length ?? 0;
  if (!n || !d) return null;
  const sw = w.reduce((s, x) => s + x, 0);
  const mean = new Array(d).fill(0);
  rows.forEach((r, i) => r.forEach((x, j) => (mean[j] += (w[i] * x) / sw)));
  const C = Array.from({ length: d }, () => new Array(d).fill(0));
  rows.forEach((r, i) => {
    for (let a = 0; a < d; a++) {
      const da = r[a] - mean[a];
      if (da === 0) continue;
      for (let b = 0; b < d; b++) C[a][b] += (w[i] * da * (r[b] - mean[b])) / sw;
    }
  });
  // Deterministic start: the diagonal (largest-variance coordinates lead).
  let v = C.map((row, i) => row[i] + 1e-6 * (i + 1));
  let lambda = 0;
  for (let it = 0; it < 100; it++) {
    const nv = C.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
    const len = Math.hypot(...nv);
    if (!(len > 1e-12)) return null;
    const next = nv.map((x) => x / len);
    const delta = next.reduce((s, x, j) => s + Math.abs(x - v[j]), 0);
    v = next;
    lambda = len;
    if (delta < 1e-9) break;
  }
  return lambda > 1e-9 ? { mean, dir: v, variance: lambda } : null;
}

// ── What's here? ─────────────────────────────────────────────────────────────

export interface HerePoint {
  key: NodeKey;
  x: number;
  y: number;
  mass: number;
  mix?: Record<string, number>;
}

export interface HereSummary {
  /** Palette tag → kernel-weighted share at the point, largest first, ≥ 2%. */
  mix: { id: string; share: number }[];
  /** Σ kernel weights: how much of the listening is around here (0 = empty sky). */
  density: number;
  /** Nearest stars, closest first, with plane distance. */
  nearest: { key: NodeKey; d: number }[];
}

/**
 * The smoothed sound mix at (x, y): a Nadaraya–Watson average of the nodes'
 * `mix` with the color field's Gaussian kernel and mass weights, so the card
 * says in words what the field shows in color.
 */
export function whatsHere(points: HerePoint[], at: Vec2, bandwidth: number, nearestK = 3): HereSummary {
  const h2 = 2 * bandwidth * bandwidth;
  const acc = new Map<string, number>();
  let density = 0;
  for (const p of points) {
    const d2 = (p.x - at[0]) ** 2 + (p.y - at[1]) ** 2;
    const k = (0.5 + 0.5 * Math.sqrt(Math.max(0, p.mass))) * Math.exp(-d2 / h2);
    if (k < 1e-6) continue;
    density += k;
    for (const [id, s] of Object.entries(p.mix ?? {})) acc.set(id, (acc.get(id) ?? 0) + k * s);
  }
  const mix = density > 0
    ? [...acc].map(([id, s]) => ({ id, share: s / density })).filter((m) => m.share >= 0.02).sort((a, b) => b.share - a.share)
    : [];
  const nearest = points
    .map((p) => ({ key: p.key, d: Math.hypot(p.x - at[0], p.y - at[1]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, nearestK);
  return { mix, density, nearest };
}
