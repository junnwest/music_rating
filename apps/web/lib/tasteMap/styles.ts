/**
 * Four candidate schematic styles for the 2D map, to compare side by side
 * (components/sj/tasteMap/SchematicCompare.tsx). Pure layout math, no drawing.
 * Every style reads the same inputs: the schematic positions (schematic.ts),
 * realms and provinces (regions.ts) and the all-pairs similarity.
 *
 * 1. Tile map (`hexTiles`): each artist gets one hexagon. Positions are scaled so
 *    the median nearest-neighbor distance is one cell, then assigned to cells by
 *    the Hungarian method (minimum total squared displacement), so neighbors on
 *    the map stay neighbors on the lattice. Borders are classified per edge:
 *    coast (no tile), realm border, province border.
 * 3. Contour ink (`contourInk`): a Gaussian kernel density of the stars drawn
 *    only as isolines, like a survey map, with each realm's highest point as a
 *    summit.
 * 5. Fingerprint (`fingerprint`): the mass-weighted distribution of bearings
 *    around you, as a truncated Fourier series r(θ). Fejér weights
 *    (1 − k/(K+1)) keep it non-negative, so it is always a closed blob. Low K is
 *    the broad shape (|c₁| = how one-sided the taste is, |c₂| = how two-sided);
 *    each extra harmonic adds detail.
 * 6. Tree (`dendrogram`): average-linkage (UPGMA) clustering on the true
 *    similarity. Merge height = the similarity at which two branches join.
 *    Leaves are ordered so each join puts its most similar ends side by side.
 */
import { contours as gridContours } from 'd3-contour';
import type { NodeKey, Vec2 } from './types';

export interface StyleNode {
  key: NodeKey;
  label: string;
  mass: number;
  avgScore: number | null;
  /** Schematic plane position. */
  pos: Vec2;
  /** Realm index (regions.ts), −1 when outside every country. */
  realm: number;
  /** Country (province) index, −1 when none. */
  country: number;
}

const TAU = Math.PI * 2;
const byKey = (a: { key: NodeKey }, b: { key: NodeKey }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

// ── 1. Tile map ──────────────────────────────────────────────────────────────

export interface Tile {
  key: NodeKey;
  q: number;
  r: number;
  /** Center, in cell units (neighboring centers are 1 apart). */
  x: number;
  y: number;
}

export interface TileEdge {
  a: Vec2;
  b: Vec2;
  kind: 'coast' | 'realm' | 'province';
}

export interface TileMap {
  tiles: Tile[];
  edges: TileEdge[];
  /** Hexagon side (circumradius), in cell units. */
  side: number;
}

/** Axial hex directions (pointy-top). */
const HEX_DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const SIDE = 1 / Math.sqrt(3);
const hexCenter = (q: number, r: number): Vec2 => [q + r / 2, r * Math.sqrt(3) / 2];

/** Nearest axial cell to a point (cube rounding). */
function hexRound(x: number, y: number): [number, number] {
  const rf = (2 * y) / Math.sqrt(3);
  const qf = x - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

/**
 * Minimum-cost assignment of n rows to m ≥ n columns (Hungarian, O(n²m)).
 * Returns the column of each row.
 */
export function assign(cost: number[][]): number[] {
  const n = cost.length;
  const m = n ? cost[0].length : 0;
  const INF = Infinity;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) out[p[j] - 1] = j - 1;
  return out;
}

export function hexTiles(input: StyleNode[]): TileMap {
  const ns = [...input].sort(byKey);
  const n = ns.length;
  if (!n) return { tiles: [], edges: [], side: SIDE };
  // Scale: median nearest-neighbor distance → one cell.
  const nn = ns.map((a, i) => {
    let d = Infinity;
    ns.forEach((b, j) => {
      if (i !== j) d = Math.min(d, Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]));
    });
    return d;
  });
  const sorted = nn.filter(Number.isFinite).sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
  const k = 1 / Math.max(med, 1e-9);
  let cx = 0;
  let cy = 0;
  for (const a of ns) {
    cx += a.pos[0];
    cy += a.pos[1];
  }
  cx /= n;
  cy /= n;
  const pts: Vec2[] = ns.map((a) => [(a.pos[0] - cx) * k, (a.pos[1] - cy) * k]);
  // Candidate cells: everything within 3 rings of each point's own cell.
  const cells = new Map<string, [number, number]>();
  for (const [x, y] of pts) {
    const [q0, r0] = hexRound(x, y);
    for (let dq = -3; dq <= 3; dq++)
      for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++) cells.set(`${q0 + dq},${r0 + dr}`, [q0 + dq, r0 + dr]);
  }
  const cand = [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const cost = pts.map(([x, y]) =>
    cand.map(([q, r]) => {
      const [hx, hy] = hexCenter(q, r);
      return (hx - x) ** 2 + (hy - y) ** 2;
    }),
  );
  const col = assign(cost);
  const tiles: Tile[] = ns.map((a, i) => {
    const [q, r] = cand[col[i]];
    const [x, y] = hexCenter(q, r);
    return { key: a.key, q, r, x, y };
  });
  // Edges.
  const at = new Map(tiles.map((t, i) => [`${t.q},${t.r}`, i]));
  const edges: TileEdge[] = [];
  tiles.forEach((t, i) => {
    for (const [dq, dr] of HEX_DIRS) {
      const j = at.get(`${t.q + dq},${t.r + dr}`);
      // Each shared edge once, from the lower index.
      if (j != null && j < i) continue;
      let kind: TileEdge['kind'] | null;
      if (j == null) kind = 'coast';
      else if (ns[i].realm !== ns[j].realm) kind = 'realm';
      else if (ns[i].country !== ns[j].country) kind = 'province';
      else kind = null;
      if (!kind) continue;
      const [nx, ny] = hexCenter(t.q + dq, t.r + dr);
      const mx = (t.x + nx) / 2;
      const my = (t.y + ny) / 2;
      // The shared edge is perpendicular to the center line, one side long.
      const px = -(ny - t.y);
      const py = nx - t.x;
      const h = SIDE / 2;
      edges.push({ a: [mx + px * h, my + py * h], b: [mx - px * h, my - py * h], kind });
    }
  });
  return { tiles, edges, side: SIDE };
}

// ── 3. Contour ink ───────────────────────────────────────────────────────────

export interface ContourInk {
  /** Isolines, low to high: rings of [x, y] in the input plane. */
  levels: { value: number; rings: Vec2[][] }[];
  /** Per realm: its densest point and the member nearest it. */
  summits: { realm: number; x: number; y: number; key: NodeKey; height: number }[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Kernel density over the box around the stars (bandwidth = `bw` × the box's
 * long side), cut into `count` evenly spaced isolines between 8% and 92% of
 * the peak.
 */
export function contourInk(input: StyleNode[], count = 9, bw = 0.07, gridN = 96): ContourInk {
  const ns = [...input].sort(byKey);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const a of ns) {
    x0 = Math.min(x0, a.pos[0]);
    y0 = Math.min(y0, a.pos[1]);
    x1 = Math.max(x1, a.pos[0]);
    y1 = Math.max(y1, a.pos[1]);
  }
  if (!ns.length) return { levels: [], summits: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 } };
  const side = Math.max(x1 - x0, y1 - y0, 1e-9);
  const h = bw * side;
  const pad = 3 * h;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  const big = Math.max(x1 - x0, y1 - y0);
  const cell = big / gridN;
  const nx = Math.ceil((x1 - x0) / cell);
  const ny = Math.ceil((y1 - y0) / cell);
  const w = (a: StyleNode) => 0.5 + 0.5 * Math.sqrt(Math.max(a.mass, 0));
  const field = (members: StyleNode[]) => {
    const f = new Float64Array(nx * ny);
    for (const a of members)
      for (let j = 0; j < ny; j++) {
        const dy = y0 + (j + 0.5) * cell - a.pos[1];
        for (let i = 0; i < nx; i++) {
          const dx = x0 + (i + 0.5) * cell - a.pos[0];
          f[j * nx + i] += w(a) * Math.exp(-(dx * dx + dy * dy) / (2 * h * h));
        }
      }
    return f;
  };
  const all = field(ns);
  const peak = Math.max(...all);
  const values = Array.from({ length: count }, (_, i) => peak * (0.08 + (0.84 * i) / Math.max(count - 1, 1)));
  const toPlane = (ring: number[][]): Vec2[] => ring.map(([gx, gy]) => [x0 + gx * cell, y0 + gy * cell]);
  const levels = gridContours()
    .size([nx, ny])
    .thresholds(values)(Array.from(all))
    .map((c) => ({ value: c.value, rings: c.coordinates.flatMap((poly) => poly.map(toPlane)) }));
  // Summits: each realm's own density peak, named by the member nearest it.
  const realms = [...new Set(ns.map((a) => a.realm).filter((r) => r >= 0))].sort((a, b) => a - b);
  const summits = realms.map((realm) => {
    const ms = ns.filter((a) => a.realm === realm);
    const f = field(ms);
    let best = 0;
    for (let i = 1; i < f.length; i++) if (f[i] > f[best]) best = i;
    const x = x0 + ((best % nx) + 0.5) * cell;
    const y = y0 + (Math.floor(best / nx) + 0.5) * cell;
    const near = [...ms].sort((a, b) => Math.hypot(a.pos[0] - x, a.pos[1] - y) - Math.hypot(b.pos[0] - x, b.pos[1] - y) || byKey(a, b))[0];
    return { realm, x, y, key: near.key, height: all[best] / peak };
  });
  return { levels, summits, box: { x0, y0, x1, y1 } };
}

// ── 5. Fingerprint ───────────────────────────────────────────────────────────

export interface Fingerprint {
  /** Per K: the curve r(θ) sampled at `samples` angles, r scaled so the largest K peaks at 1. */
  curves: { k: number; r: number[] }[];
  samples: number;
  /** Fourier magnitudes |c_k| of the bearing distribution, k = 1..maxK. */
  harmonics: number[];
  /** Each star's bearing (radians, plane convention: atan2(y, x)). */
  bearing: Map<NodeKey, number>;
  /** Per realm: its arc of bearings (circular), heaviest first. */
  arcs: { realm: number; from: number; to: number; mid: number; mass: number }[];
  /** Direction of the first harmonic (where the taste leans). */
  lean: number;
}

/** Star weight for the fingerprint: mass, nudged by how well it is rated (0–5). */
const fpWeight = (a: StyleNode) => Math.max(a.mass, 0.05) * (a.avgScore == null ? 1 : 0.7 + 0.12 * a.avgScore);

export function fingerprint(input: StyleNode[], ks: number[] = [1, 2, 4, 8], samples = 256): Fingerprint {
  const ns = [...input].sort(byKey);
  const maxK = Math.max(...ks);
  let cx = 0;
  let cy = 0;
  let W = 0;
  for (const a of ns) {
    cx += a.mass * a.pos[0];
    cy += a.mass * a.pos[1];
    W += a.mass;
  }
  cx /= W || 1;
  cy /= W || 1;
  const bearing = new Map(ns.map((a) => [a.key, Math.atan2(a.pos[1] - cy, a.pos[0] - cx)] as const));
  const wsum = ns.reduce((s, a) => s + fpWeight(a), 0) || 1;
  // c_k = Σ w e^{-ikθ} / Σ w
  const re: number[] = [1];
  const im: number[] = [0];
  for (let k = 1; k <= maxK; k++) {
    let c = 0;
    let s = 0;
    for (const a of ns) {
      const t = bearing.get(a.key)!;
      c += fpWeight(a) * Math.cos(k * t);
      s -= fpWeight(a) * Math.sin(k * t);
    }
    re.push(c / wsum);
    im.push(s / wsum);
  }
  const harmonics = re.slice(1).map((c, i) => Math.hypot(c, im[i + 1]));
  // Fejér-summed density: f_K(θ) = 1 + 2 Σ_{k≤K} (1 − k/(K+1)) Re(c_k e^{ikθ}) ≥ 0.
  const raw = ks.map((K) => {
    const r: number[] = [];
    for (let s = 0; s < samples; s++) {
      const th = (TAU * s) / samples;
      let f = 1;
      for (let k = 1; k <= K; k++) f += 2 * (1 - k / (K + 1)) * (re[k] * Math.cos(k * th) - im[k] * Math.sin(k * th));
      r.push(Math.max(f, 0));
    }
    return { k: K, r };
  });
  // A base circle keeps a lopsided taste from collapsing to a point.
  const top = Math.max(...raw.flatMap((c) => c.r)) || 1;
  const curves = raw.map((c) => ({ k: c.k, r: c.r.map((f) => 0.28 + 0.72 * (f / top)) }));
  // Realm arcs: the smallest arc covering each realm's bearings.
  const realms = [...new Set(ns.map((a) => a.realm).filter((r) => r >= 0))];
  const arcs = realms
    .map((realm) => {
      const ms = ns.filter((a) => a.realm === realm);
      const ts = ms.map((a) => ((bearing.get(a.key)! % TAU) + TAU) % TAU).sort((a, b) => a - b);
      // Open the circle at the widest gap.
      let gapAt = 0;
      let gap = -1;
      ts.forEach((t, i) => {
        const next = i + 1 < ts.length ? ts[i + 1] : ts[0] + TAU;
        if (next - t > gap) {
          gap = next - t;
          gapAt = i;
        }
      });
      const from = ts[(gapAt + 1) % ts.length];
      let to = ts[gapAt];
      if (to < from) to += TAU;
      let sx = 0;
      let sy = 0;
      for (const a of ms) {
        sx += a.mass * Math.cos(bearing.get(a.key)!);
        sy += a.mass * Math.sin(bearing.get(a.key)!);
      }
      return { realm, from, to, mid: Math.atan2(sy, sx), mass: ms.reduce((s, a) => s + a.mass, 0) };
    })
    .sort((a, b) => b.mass - a.mass || a.realm - b.realm);
  return { curves, samples, harmonics, bearing, arcs, lean: Math.atan2(-im[1], re[1]) };
}

// ── 6. Tree ──────────────────────────────────────────────────────────────────

export interface TreeNode {
  /** Leaf: the star's key; join: null. */
  key: NodeKey | null;
  /** Similarity at which this branch forms (1 for a leaf). */
  height: number;
  children: TreeNode[];
  /** Leaf order positions covered, [first, last]. */
  span: [number, number];
  /** The realm when every leaf below shares one, else −1. */
  realm: number;
}

export interface Dendrogram {
  root: TreeNode | null;
  /** Leaf keys, top to bottom. */
  order: NodeKey[];
}

export function dendrogram(input: StyleNode[], sim: (a: NodeKey, b: NodeKey) => number): Dendrogram {
  const ns = [...input].sort(byKey);
  if (!ns.length) return { root: null, order: [] };
  const realmOf = new Map(ns.map((a) => [a.key, a.realm]));
  interface Raw {
    key: NodeKey | null;
    height: number;
    children: Raw[];
    realm: number;
  }
  interface Cluster {
    leaves: NodeKey[];
    node: Raw;
  }
  let live: Cluster[] = ns.map((a) => ({ leaves: [a.key], node: { key: a.key, height: 1, children: [], realm: a.realm } }));
  const S = new Map<string, number>();
  const s = (a: NodeKey, b: NodeKey) => {
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = S.get(id);
    if (v == null) S.set(id, (v = sim(a, b)));
    return v;
  };
  const avg = (x: NodeKey[], y: NodeKey[]) => {
    let t = 0;
    for (const a of x) for (const b of y) t += s(a, b);
    return t / (x.length * y.length);
  };
  while (live.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = -Infinity;
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const v = avg(live[i].leaves, live[j].leaves);
        if (v > best + 1e-12) {
          best = v;
          bi = i;
          bj = j;
        }
      }
    let A = live[bi];
    let B = live[bj];
    // Orient: put the most similar ends next to each other.
    const ends = (c: Cluster) => [c.leaves[0], c.leaves[c.leaves.length - 1]] as const;
    const deep = (c: Cluster): Cluster => {
      // Reverse the whole subtree (every level), so leaves read in reverse.
      const rev = (t: Raw): Raw => ({ ...t, children: t.children.map(rev).reverse() });
      return { leaves: [...c.leaves].reverse(), node: rev(c.node) };
    };
    const options: [Cluster, Cluster][] = [
      [A, B],
      [deep(A), B],
      [A, deep(B)],
      [deep(A), deep(B)],
    ];
    let pick = options[0];
    let pickS = -Infinity;
    for (const o of options) {
      const v = s(ends(o[0])[1], ends(o[1])[0]);
      if (v > pickS + 1e-12) {
        pickS = v;
        pick = o;
      }
    }
    [A, B] = pick;
    const rA = A.node.realm;
    const merged: Cluster = {
      leaves: [...A.leaves, ...B.leaves],
      node: { key: null, height: best, children: [A.node, B.node], realm: rA >= 0 && rA === B.node.realm ? rA : -1 },
    };
    live = live.filter((_, k) => k !== bi && k !== bj);
    live.push(merged);
  }
  const order = live[0].leaves;
  const pos = new Map(order.map((k, i) => [k, i]));
  const withSpan = (t: Raw): TreeNode => {
    if (t.key != null) return { key: t.key, height: t.height, children: [], span: [pos.get(t.key)!, pos.get(t.key)!], realm: realmOf.get(t.key) ?? -1 };
    const kids = t.children.map(withSpan);
    return { key: null, height: t.height, realm: t.realm, children: kids, span: [Math.min(...kids.map((c) => c.span[0])), Math.max(...kids.map((c) => c.span[1]))] };
  };
  return { root: withSpan(live[0].node), order };
}
