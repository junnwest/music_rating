/**
 * Map geometry beyond the dots (client-side, pure; drawn by Map2D):
 *
 * - colorField: the continuous background. Each cell's color is the
 *   Nadaraya–Watson kernel average of nearby nodes' colors (Gaussian kernel,
 *   mass-weighted), its opacity 1 − exp(−density/ρ), so color says what lives
 *   here and opacity says how much of your listening does.
 * - tagGradients: the compass. For each palette tag, a mass-weighted
 *   least-squares plane  share_t ≈ β0 + β1·x + β2·y  over node positions; (β1, β2)
 *   is the direction the tag grows in across the map and R² how well a straight
 *   direction explains it (a biplot axis, fitted rather than projected).
 * - spanningTree: Kruskal's minimum spanning tree of the kNN graph with
 *   distance 1 − sim, the map's "constellation lines": the fewest strongest
 *   links that still connect everything that is connected at all.
 */
import type { Neighbor, NodeKey, PaletteHue } from './types';
import type { Rgb } from './color';

export interface FieldPoint {
  x: number;
  y: number;
  /** Kernel weight (mass). */
  w: number;
  rgb: Rgb;
}

export interface FieldGrid {
  x0: number;
  y0: number;
  /** World units per cell. */
  cell: number;
  nx: number;
  ny: number;
}

/** Opacity ceiling of the field, and the density that reaches ~63% of it. */
export const FIELD_MAX_ALPHA = 0.5;
export const FIELD_RHO = 1.4;

/**
 * RGBA per cell, row-major with row 0 at y0 (the caller flips for screen).
 * Kernel cut at 3 bandwidths.
 */
export function colorField(points: FieldPoint[], grid: FieldGrid, bandwidth: number): Uint8ClampedArray {
  const { x0, y0, cell, nx, ny } = grid;
  const out = new Uint8ClampedArray(nx * ny * 4);
  const acc = new Float64Array(nx * ny * 4);
  const h2 = 2 * bandwidth * bandwidth;
  const reach = Math.ceil((3 * bandwidth) / cell);
  for (const p of points) {
    if (!(p.w > 0)) continue;
    const ci = Math.round((p.x - x0) / cell);
    const cj = Math.round((p.y - y0) / cell);
    for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j++) {
      const dy = y0 + j * cell - p.y;
      for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
        const dx = x0 + i * cell - p.x;
        const k = p.w * Math.exp(-(dx * dx + dy * dy) / h2);
        if (k < 1e-4) continue;
        const o = (j * nx + i) * 4;
        acc[o] += k * p.rgb[0];
        acc[o + 1] += k * p.rgb[1];
        acc[o + 2] += k * p.rgb[2];
        acc[o + 3] += k;
      }
    }
  }
  for (let c = 0; c < nx * ny; c++) {
    const o = c * 4;
    const d = acc[o + 3];
    if (!(d > 0)) continue;
    out[o] = acc[o] / d;
    out[o + 1] = acc[o + 1] / d;
    out[o + 2] = acc[o + 2] / d;
    out[o + 3] = 255 * FIELD_MAX_ALPHA * (1 - Math.exp(-d / FIELD_RHO));
  }
  return out;
}

export interface TagGradient extends PaletteHue {
  /** Unit direction in plane coordinates (y up). */
  dx: number;
  dy: number;
  /** Change in share across one standard deviation of position along (dx, dy). */
  strength: number;
  r2: number;
}

/** Solve a 3×3 system by Cramer's rule; null when singular. */
function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map((c) => det(A.map((r, i) => r.map((x, j) => (j === c ? b[i] : x)))) / D);
}

export function tagGradients(
  points: { x: number; y: number; w: number; mix: Record<string, number> | undefined }[],
  palette: PaletteHue[],
): TagGradient[] {
  const pts = points.filter((p) => p.w > 0);
  if (pts.length < 4) return [];
  const W = pts.reduce((s, p) => s + p.w, 0);
  const mx = pts.reduce((s, p) => s + p.w * p.x, 0) / W;
  const my = pts.reduce((s, p) => s + p.w * p.y, 0) / W;
  // Normal equations on centered coordinates (shared by every tag).
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pts) {
    const r = [1, p.x - mx, p.y - my];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += p.w * r[i] * r[j];
  }
  const out: TagGradient[] = [];
  for (const t of palette) {
    const ys = pts.map((p) => p.mix?.[t.id] ?? 0);
    const b = [0, 0, 0];
    pts.forEach((p, i) => {
      const r = [1, p.x - mx, p.y - my];
      for (let k = 0; k < 3; k++) b[k] += p.w * r[k] * ys[i];
    });
    const beta = solve3(A, b);
    if (!beta) continue;
    const ybar = ys.reduce((s, y, i) => s + pts[i].w * y, 0) / W;
    let ssTot = 0;
    let ssRes = 0;
    pts.forEach((p, i) => {
      const fit = beta[0] + beta[1] * (p.x - mx) + beta[2] * (p.y - my);
      ssTot += p.w * (ys[i] - ybar) ** 2;
      ssRes += p.w * (ys[i] - fit) ** 2;
    });
    const g = Math.hypot(beta[1], beta[2]);
    if (!(g > 0) || !(ssTot > 0)) continue;
    const dx = beta[1] / g;
    const dy = beta[2] / g;
    // Spread of positions along the gradient direction.
    const sd = Math.sqrt(pts.reduce((s, p) => s + p.w * ((p.x - mx) * dx + (p.y - my) * dy) ** 2, 0) / W);
    out.push({ ...t, dx, dy, strength: g * sd, r2: Math.max(0, 1 - ssRes / ssTot) });
  }
  return out.sort((a, b) => b.r2 * b.strength - a.r2 * a.strength);
}

export interface TreeEdge {
  a: NodeKey;
  b: NodeKey;
  sim: number;
}

/** Kruskal over the (symmetrized) kNN lists, restricted to `keep`. */
export function spanningTree(neighbors: Record<NodeKey, Neighbor[]>, keep: Set<NodeKey>): TreeEdge[] {
  const best = new Map<string, TreeEdge>();
  for (const [a, list] of Object.entries(neighbors)) {
    if (!keep.has(a)) continue;
    for (const nb of list) {
      if (!keep.has(nb.key) || nb.key === a) continue;
      const [x, y] = a < nb.key ? [a, nb.key] : [nb.key, a];
      const id = `${x}|${y}`;
      const prev = best.get(id);
      if (!prev || nb.sim > prev.sim) best.set(id, { a: x, b: y, sim: nb.sim });
    }
  }
  const edges = [...best.values()].sort((p, q) => q.sim - p.sim || (p.a + p.b < q.a + q.b ? -1 : 1));
  const parent = new Map<NodeKey, NodeKey>();
  const find = (k: NodeKey): NodeKey => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const out: TreeEdge[] = [];
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) continue;
    parent.set(ra, rb);
    if (!parent.has(rb)) parent.set(rb, rb);
    out.push(e);
  }
  return out;
}
