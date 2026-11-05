/**
 * Layout engine for the taste map (TASTE_MAP_PLAN.md D3, D5, D8).
 *
 * Pure functions over a FeatureSpace: a weighted-cosine distance matrix → UMAP
 * (umap-js, 3 components, precomputed kNN, seeded) → normalized 3D positions,
 * a deterministic 2D principal plane, and explained kNN neighbors.
 *
 * The similarity here mirrors features.ts `similarity(a, b, w)` on purpose (this
 * file must not import it): sim = Σ_b w_b·dot(a_b, b_b) / Σ_{b where both has} w_b,
 * with per-dim weights on the tags block when provided, each w_b scaled by the
 * pair's confidence in the block and the denominator floored (evidence.ts).
 */
import { UMAP } from 'umap-js';
import {
  BLOCKS,
  type BlockName,
  type Contribution,
  type FeatureSpace,
  type LayoutResult,
  type MapNode,
  type MetricWeights,
  type Neighbor,
  type NodeKey,
  type Vec3,
} from './types';
import { planeBasis, principalAxes, projectPlane, toPlane } from './plane';
import { normalizer, pairBlockWeight } from './evidence';

// ── Small utilities ──────────────────────────────────────────────────────────

/** Seeded PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function unitWeights(): MetricWeights {
  return { block: { tags: 1, text: 1, graph: 1, era: 1 }, tagDims: null };
}

export type ExplainFn = (a: MapNode, b: MapNode) => Contribution[];

// ── Weighted similarity (kept consistent with features.ts) ───────────────────

function blockDot(a: number[], b: number[], dimW: number[] | null): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  if (dimW) {
    for (let i = 0; i < n; i++) {
      const ai = a[i];
      if (ai !== 0) s += (dimW[i] ?? 1) * ai * b[i];
    }
  } else {
    for (let i = 0; i < n; i++) {
      const ai = a[i];
      if (ai !== 0) s += ai * b[i];
    }
  }
  return s;
}

/** Per-block numerators w_b·dot_b and the shared denominator Σ_{both has} w_b (confidence-scaled, floored: evidence.ts). */
export function blockTerms(
  a: MapNode,
  b: MapNode,
  w: MetricWeights = unitWeights(),
): { terms: Record<BlockName, number>; denom: number } {
  const terms = { tags: 0, text: 0, graph: 0, era: 0 } as Record<BlockName, number>;
  let shared = 0;
  for (const blk of BLOCKS) {
    // Same semantics as features.similarity: a zero-weighted block is ignored,
    // not counted as disagreement; weights are scaled by the pair's confidence
    // and the normalizer is floored (evidence.ts).
    const wb = pairBlockWeight(a, b, blk, w);
    if (wb === 0) continue;
    shared += wb;
    terms[blk] = wb * blockDot(a.blocks[blk], b.blocks[blk], blk === 'tags' ? w.tagDims : null);
  }
  return { terms, denom: normalizer(shared, w) };
}

/** Weighted cosine similarity; 0 when the nodes share no block with weight. */
export function weightedSimilarity(a: MapNode, b: MapNode, w?: MetricWeights): number {
  const { terms, denom } = blockTerms(a, b, w);
  if (denom <= 1e-12) return 0;
  let num = 0;
  for (const blk of BLOCKS) num += terms[blk];
  return num / denom;
}

const BLOCK_LABEL: Record<BlockName, string> = {
  tags: 'genre',
  text: 'described alike',
  graph: 'listeners overlap',
  era: 'same era',
};

/** Default explanation: each block's share of the positive similarity mass. */
export function blockShares(a: MapNode, b: MapNode, w?: MetricWeights): Contribution[] {
  const { terms } = blockTerms(a, b, w);
  let pos = 0;
  for (const blk of BLOCKS) if (terms[blk] > 0) pos += terms[blk];
  if (pos <= 1e-12) return [];
  return BLOCKS.filter((blk) => terms[blk] > 0)
    .map((blk) => ({ label: BLOCK_LABEL[blk], share: terms[blk] / pos }))
    .sort((x, y) => y.share - x.share);
}

/** Dense n×n similarity matrix (row-major), symmetric, diagonal = 1. */
export function similarityMatrix(nodes: MapNode[], w?: MetricWeights): Float64Array {
  const n = nodes.length;
  const S = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    S[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = weightedSimilarity(nodes[i], nodes[j], w);
      S[i * n + j] = s;
      S[j * n + i] = s;
    }
  }
  return S;
}

// ── 3×3 linear algebra (Jacobi eigen, Procrustes, PCA) ───────────────────────

type M3 = number[][]; // 3×3

/** Eigen-decomposition of a symmetric 3×3 matrix. Values descending; vectors[i] is a unit column. */
function symEigen3(A: M3): { values: number[]; vectors: number[][] } {
  const a = A.map((r) => r.slice());
  const V: M3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]),
  };
}

const dot3 = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross3 = (u: number[], v: number[]): number[] => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const norm3 = (u: number[]) => Math.sqrt(dot3(u, u));
function unit3(u: number[]): number[] {
  const l = norm3(u);
  return l > 0 ? [u[0] / l, u[1] / l, u[2] / l] : [1, 0, 0];
}
function anyOrthogonal(u: number[]): number[] {
  const ax = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit3(cross3(u, ax));
}

function mean3(pts: Vec3[]): Vec3 {
  const m: Vec3 = [0, 0, 0];
  if (!pts.length) return m;
  for (const p of pts) {
    m[0] += p[0];
    m[1] += p[1];
    m[2] += p[2];
  }
  return [m[0] / pts.length, m[1] / pts.length, m[2] / pts.length];
}

function covariance3(pts: Vec3[], mu: Vec3): M3 {
  const C: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pts) {
    const d = [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  return C;
}

export interface SimilarityTransform {
  /** Row-vector convention: y = s·(x − srcMean)·R + dstMean. */
  R: M3;
  s: number;
  srcMean: Vec3;
  dstMean: Vec3;
}

export function applyTransform(p: Vec3, t: SimilarityTransform): Vec3 {
  const d = [p[0] - t.srcMean[0], p[1] - t.srcMean[1], p[2] - t.srcMean[2]];
  const out: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    out[j] = t.s * (d[0] * t.R[0][j] + d[1] * t.R[1][j] + d[2] * t.R[2][j]) + t.dstMean[j];
  }
  return out;
}

/** Least-squares similarity transform mapping X onto Y (paired rows). */
function procrustes(X: Vec3[], Y: Vec3[], allowReflection: boolean): SimilarityTransform {
  const mx = mean3(X);
  const my = mean3(Y);
  const I: M3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  if (X.length < 2) return { R: I, s: 1, srcMean: mx, dstMean: my };
  // M = Xcᵀ·Yc
  const M: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let xx = 0;
  for (let k = 0; k < X.length; k++) {
    const x = [X[k][0] - mx[0], X[k][1] - mx[1], X[k][2] - mx[2]];
    const y = [Y[k][0] - my[0], Y[k][1] - my[1], Y[k][2] - my[2]];
    xx += dot3(x, x);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += x[i] * y[j];
  }
  if (xx <= 1e-18) return { R: I, s: 1, srcMean: mx, dstMean: my };
  // SVD via eigen of MᵀM = V Σ² Vᵀ, u_i = M v_i / σ_i.
  const MtM: M3 = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => M[0][i] * M[0][j] + M[1][i] * M[1][j] + M[2][i] * M[2][j]),
  );
  const { values, vectors: V } = symEigen3(MtM);
  const sig = values.map((v) => Math.sqrt(Math.max(v, 0)));
  const tol = Math.max(sig[0], 1e-300) * 1e-9;
  const U: number[][] = [];
  for (let i = 0; i < 3; i++) {
    if (sig[i] > tol) {
      const v = V[i];
      U.push(unit3([dot3(M[0], v), dot3(M[1], v), dot3(M[2], v)]));
    } else if (i === 1) {
      U.push(anyOrthogonal(U[0]));
    } else if (i === 2) {
      U.push(unit3(cross3(U[0], U[1])));
    } else {
      return { R: I, s: 1, srcMean: mx, dstMean: my };
    }
  }
  const signs = [1, 1, 1];
  const build = (): M3 =>
    [0, 1, 2].map((r) => [0, 1, 2].map((c) => signs.reduce((acc, sg, i) => acc + sg * U[i][r] * V[i][c], 0)));
  let R = build();
  const det =
    R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
    R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
    R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (det < 0 && (!allowReflection || sig[2] <= tol)) {
    signs[2] = -1;
    R = build();
  }
  const trace = sig[0] * signs[0] + sig[1] * signs[1] + sig[2] * signs[2];
  return { R, s: Math.max(trace / xx, 1e-12), srcMean: mx, dstMean: my };
}

/**
 * Procrustes (rotation + uniform scale + translation) aligning `src` onto `dst`,
 * fit on their shared keys and applied to every key of `src`.
 * `rms` is the residual over the shared keys after alignment.
 */
export function alignTo(
  src: Record<NodeKey, Vec3>,
  dst: Record<NodeKey, Vec3>,
  opts: { allowReflection?: boolean; scale?: boolean } = {},
): { positions: Record<NodeKey, Vec3>; rms: number; transform: SimilarityTransform } {
  const shared = Object.keys(src)
    .filter((k) => dst[k])
    .sort();
  const X = shared.map((k) => src[k]);
  const Y = shared.map((k) => dst[k]);
  let t: SimilarityTransform;
  if (shared.length >= 3) {
    t = procrustes(X, Y, opts.allowReflection ?? true);
    if (opts.scale === false) t = { ...t, s: 1 };
  } else {
    t = { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], s: 1, srcMean: mean3(X), dstMean: mean3(Y) };
  }
  const positions: Record<NodeKey, Vec3> = {};
  for (const k of Object.keys(src)) positions[k] = applyTransform(src[k], t);
  let sq = 0;
  for (const k of shared) {
    const p = positions[k];
    const q = dst[k];
    sq += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  }
  return { positions, rms: shared.length ? Math.sqrt(sq / shared.length) : 0, transform: t };
}

// principalAxes / projectPlane live in plane.ts (no umap import, safe for the
// browser bundle); re-exported here so existing imports keep working.
export { principalAxes, projectPlane } from './plane';

// ── Neighbors and placement ──────────────────────────────────────────────────

function topK(
  i: number,
  n: number,
  sim: (j: number) => number,
  k: number,
  keyOf: (j: number) => string,
  include: (j: number) => boolean = () => true,
): { j: number; s: number }[] {
  const cand: { j: number; s: number }[] = [];
  for (let j = 0; j < n; j++) if (j !== i && include(j)) cand.push({ j, s: sim(j) });
  cand.sort((x, y) => y.s - x.s || (keyOf(x.j) < keyOf(y.j) ? -1 : 1));
  return cand.slice(0, k);
}

export interface PlaceOptions {
  weights?: MetricWeights;
  /** Neighbors averaged (default 5). */
  k?: number;
  explain?: ExplainFn;
}

/**
 * D3 new-artist placement: similarity-weighted barycentre of the k nearest
 * already-placed nodes (in the given metric). Nodes absent from `positions`
 * and the node itself are ignored.
 */
export function placeNew(
  space: FeatureSpace,
  positions: Record<NodeKey, Vec3>,
  node: MapNode,
  opts: PlaceOptions = {},
): { pos: Vec3; anchors: Neighbor[] } {
  const k = opts.k ?? 5;
  const placed = space.nodes.filter((m) => m.key !== node.key && positions[m.key]);
  if (!placed.length) return { pos: [0, 0, 0], anchors: [] };
  const near = topK(-1, placed.length, (j) => weightedSimilarity(node, placed[j], opts.weights), k, (j) => placed[j].key);
  let wsum = 0;
  for (const c of near) wsum += Math.max(c.s, 0);
  const uniform = wsum <= 1e-12;
  const pos: Vec3 = [0, 0, 0];
  let tot = 0;
  for (const c of near) {
    const wt = uniform ? 1 : Math.max(c.s, 0);
    const p = positions[placed[c.j].key];
    pos[0] += wt * p[0];
    pos[1] += wt * p[1];
    pos[2] += wt * p[2];
    tot += wt;
  }
  pos[0] /= tot;
  pos[1] /= tot;
  pos[2] /= tot;
  const anchors = near.map((c) => ({
    key: placed[c.j].key,
    sim: c.s,
    why: opts.explain ? opts.explain(node, placed[c.j]) : blockShares(node, placed[c.j], opts.weights),
  }));
  return { pos, anchors };
}

// ── Solve ────────────────────────────────────────────────────────────────────

export interface SolveOptions {
  weights?: MetricWeights;
  /** Previous / global-anchor positions. Missing keys are placed by kNN barycentre. */
  init?: Record<NodeKey, Vec3>;
  seed?: number;
  /** Neighbors per node in the result (default 8). */
  k?: number;
  explain?: ExplainFn;
  /** UMAP epochs (default: umap-js's 500 for n ≤ 2500). */
  nEpochs?: number;
  minDist?: number;
  /** UMAP learning rate. Default 1 cold, 0.25 when warm-started from `init` (refine, don't re-make). */
  learningRate?: number;
  /** Radius the init is scaled to in UMAP units (default 10). */
  initScale?: number;
  /**
   * Per-epoch pull of init'd nodes toward their init position, inside the UMAP
   * loop (an anchor term umap-js lacks). 0 = plain warm start. Default 0.01.
   *
   * Presets: re-solving from the user's previous layout → defaults (lr 0.25,
   * pull 0.01: centroids move < ~0.05). Seeding from the coarse global anchor,
   * where the personal metric should win → `learningRate: 1, initPull: 0.003`.
   */
  initPull?: number;
}

function tinyLayout(nodes: MapNode[], init?: Record<NodeKey, Vec3>): Vec3[] {
  const n = nodes.length;
  if (init && nodes.every((m) => init[m.key])) return nodes.map((m) => [...init[m.key]] as Vec3);
  if (n === 1) return [[0, 0, 0]];
  return nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [0.5 * Math.cos(a), 0.5 * Math.sin(a), 0] as Vec3;
  });
}

/** Center at the origin and scale so the farthest point sits at radius 1. */
function normalizeUnit(pts: Vec3[]): Vec3[] {
  const mu = mean3(pts);
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]));
  const s = r > 1e-12 ? 1 / r : 1;
  return pts.map((p) => [(p[0] - mu[0]) * s, (p[1] - mu[1]) * s, (p[2] - mu[2]) * s] as Vec3);
}

/** Rotate into the principal frame (x = most variance), canonical signs. */
function canonicalFrame(pts: Vec3[]): Vec3[] {
  const { mu, axes } = principalAxes(pts);
  return pts.map((p) => {
    const d = [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]];
    return [dot3(d, axes[0]), dot3(d, axes[1]), dot3(d, axes[2])] as Vec3;
  });
}

/** Build the initial embedding (UMAP scale ±10) from `init`, filling gaps by barycentre. */
function buildInit(
  nodes: MapNode[],
  S: Float64Array,
  init: Record<NodeKey, Vec3>,
  scale: number,
): { emb: Vec3[]; have: boolean[] } | null {
  const n = nodes.length;
  const have = nodes.map((m) => !!init[m.key]);
  if (have.filter(Boolean).length < Math.min(3, n)) return null;
  const known = normalizeUnit(nodes.filter((_, i) => have[i]).map((m) => init[m.key]));
  const base: Vec3[] = new Array(n);
  let q = 0;
  for (let i = 0; i < n; i++) if (have[i]) base[i] = known[q++];
  for (let i = 0; i < n; i++) {
    if (have[i]) continue;
    const near = topK(i, n, (j) => S[i * n + j], 5, (j) => nodes[j].key, (j) => have[j]);
    let tot = 0;
    const p: Vec3 = [0, 0, 0];
    for (const c of near) {
      const wt = Math.max(c.s, 0) + 1e-6;
      p[0] += wt * base[c.j][0];
      p[1] += wt * base[c.j][1];
      p[2] += wt * base[c.j][2];
      tot += wt;
    }
    // Tiny deterministic offset so coincident placements don't stack exactly.
    const jitter = 0.01 * (((i * 2654435761) >>> 0) / 4294967296 - 0.5);
    base[i] = [p[0] / tot + jitter, p[1] / tot - jitter, p[2] / tot + jitter];
  }
  return { emb: base.map((p) => [p[0] * scale, p[1] * scale, p[2] * scale] as Vec3), have };
}

function runUmap(
  nodes: MapNode[],
  S: Float64Array,
  seed: number,
  init: { emb: Vec3[]; have: boolean[] } | null,
  nEpochs: number | undefined,
  minDist: number,
  learningRate: number,
  initPull: number,
): Vec3[] {
  const n = nodes.length;
  const nNeighbors = Math.min(15, n - 1);
  const dist = (i: number, j: number) => (i === j ? 0 : Math.min(2, Math.max(0, 1 - S[i * n + j])));
  // Precomputed kNN (self first, as umap's own NN-descent returns it).
  const knnIndices: number[][] = [];
  const knnDistances: number[][] = [];
  for (let i = 0; i < n; i++) {
    const near = topK(i, n, (j) => -dist(i, j), nNeighbors - 1, (j) => nodes[j].key);
    knnIndices.push([i, ...near.map((c) => c.j)]);
    knnDistances.push([0, ...near.map((c) => -c.s)]);
  }
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors,
    minDist,
    learningRate,
    random: mulberry32(seed),
    distanceFn: (x, y) => dist(x[0], y[0]),
    ...(nEpochs ? { nEpochs } : {}),
  });
  umap.setPrecomputedKNN(knnIndices, knnDistances);
  const X = nodes.map((_, i) => [i]);
  const epochs = umap.initializeFit(X);
  // umap-js has no init parameter; its random init lives in the private
  // `embedding`, which the optimizer references by identity, so we overwrite it
  // in place and (optionally) pull toward it between epochs.
  const emb = (umap as unknown as { embedding?: number[][] }).embedding;
  const canInit = !!init && Array.isArray(emb) && emb.length === n && emb[0]?.length === 3;
  if (canInit) for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) emb![i][d] = init!.emb[i][d];
  for (let e = 0; e < epochs; e++) {
    umap.step();
    if (canInit && initPull > 0) {
      for (let i = 0; i < n; i++) {
        if (!init!.have[i]) continue;
        const row = emb![i];
        const t = init!.emb[i];
        for (let d = 0; d < 3; d++) row[d] += initPull * (t[d] - row[d]);
      }
    }
  }
  return umap.getEmbedding().map((r) => [r[0], r[1], r[2]] as Vec3);
}

/** An MST edge longer than this × the median MST edge splits the layout into islands. */
export const ISLAND_CUT = 3;
/** Islands never come closer than this × the median MST edge (nearest cross pair). */
export const MIN_STRAIT = 3;

/**
 * UMAP keeps local structure and throws global distances away: once the kNN
 * graph barely links two groups (zero's Korean / Japanese and Western artists
 * share almost no language-qualified tags or listeners), it parks them as far
 * apart as its repulsion likes. This puts the gaps back on the same ruler as
 * the rest of the map. Islands (components of the layout's MST cut at
 * ISLAND_CUT × its median edge) keep their shape and only move rigidly; the
 * ruler is fit on pairs inside islands (layout distance ≈ β·(1 − sim)), and the
 * islands slide toward the center until cross pairs sit as close to
 * β·(1 − sim) as they can. Gaps are only ever closed, never widened.
 */
export function closeGaps(pts: Vec3[], S: Float64Array): Vec3[] {
  const n = pts.length;
  if (n < 4) return pts;
  const D = (i: number, j: number) => Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
  const d = (i: number, j: number) => Math.min(2, Math.max(0.02, 1 - S[i * n + j]));

  // Euclidean MST (Prim, O(n²)).
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const from = new Array<number>(n).fill(-1);
  const edges: { a: number; b: number; len: number }[] = [];
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push({ a: from[u], b: u, len: best[u] });
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const l = D(u, v);
      if (l < best[v]) {
        best[v] = l;
        from[v] = u;
      }
    }
  }
  const lens = edges.map((e) => e.len).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)];
  if (!(median > 0)) return pts;

  // Islands.
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of edges) if (e.len <= ISLAND_CUT * median) parent[find(e.a)] = find(e.b);
  const roots = [...new Set(pts.map((_, i) => find(i)))];
  if (roots.length < 2) return pts;
  const isle = pts.map((_, i) => roots.indexOf(find(i)));

  // The ruler, from pairs inside islands.
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (isle[i] !== isle[j]) continue;
      num += D(i, j) * d(i, j);
      den += d(i, j) ** 2;
    }
  if (!(den > 0)) return pts;
  const beta = num / den;

  // Contract every island's offset from the map's center by one factor λ ≤ 1:
  // islands slide straight in, so the axes that separated them stay the
  // map's main axes (the 2D plane keeps showing them side by side). λ
  // minimizes the cross-pair stress, nearer pairs weighted more (Kamada–Kawai),
  // keeping a strait of MIN_STRAIT median edges between every two islands.
  const C = roots.length;
  const size = roots.map((_, c) => isle.filter((x) => x === c).length);
  const G = mean3(pts);
  const off: Vec3[] = roots.map(() => [0, 0, 0]);
  pts.forEach((p, i) => {
    for (let k = 0; k < 3; k++) off[isle[i]][k] += p[k] / size[isle[i]];
  });
  for (const o of off) for (let k = 0; k < 3; k++) o[k] -= G[k];
  const floor = MIN_STRAIT * median;
  const placed = (lambda: number) => pts.map((p, i) => [0, 1, 2].map((k) => p[k] + (lambda - 1) * off[isle[i]][k]) as Vec3);
  let bestLambda = 1;
  let bestStress = Infinity;
  for (let step = 100; step >= 5; step--) {
    const lambda = step / 100;
    const q = placed(lambda);
    let stress = 0;
    const strait = new Map<number, number>();
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (isle[i] === isle[j]) continue;
        const l = Math.hypot(q[i][0] - q[j][0], q[i][1] - q[j][1], q[i][2] - q[j][2]);
        const target = beta * d(i, j);
        stress += (l - target) ** 2 / (target * target);
        const pair = Math.min(isle[i], isle[j]) * C + Math.max(isle[i], isle[j]);
        strait.set(pair, Math.min(strait.get(pair) ?? Infinity, l));
      }
    if ([...strait.values()].some((l) => l < floor)) break;
    if (stress < bestStress - 1e-12) {
      bestStress = stress;
      bestLambda = lambda;
    }
  }
  return bestLambda < 1 ? placed(bestLambda) : pts;
}

/**
 * D3: personal 3D layout. Weighted metric → UMAP (seeded, deterministic) →
 * positions roughly in [-1, 1]^3, plus the D5 plane and explained neighbors.
 *
 * With `init`, UMAP starts from those coordinates and the result is Procrustes-
 * aligned back onto them, so a re-solve keeps the user's mental map. Without it
 * the layout is rotated into its principal frame (canonical signs).
 */
export function solveLayout(space: FeatureSpace, opts: SolveOptions = {}): LayoutResult {
  const nodes = space.nodes;
  const n = nodes.length;
  const w = opts.weights;
  const seed = opts.seed ?? 42;
  const k = opts.k ?? 8;
  const result: LayoutResult = { positions: {}, plane2d: {}, neighbors: {} };
  if (!n) return result;

  const S = similarityMatrix(nodes, w);
  let pts: Vec3[];
  if (n < 4) {
    pts = tinyLayout(nodes, opts.init);
  } else {
    const initEmb = opts.init ? buildInit(nodes, S, opts.init, opts.initScale ?? 10) : null;
    const lr = opts.learningRate ?? (initEmb ? 0.25 : 1);
    const raw = closeGaps(runUmap(nodes, S, seed, initEmb, opts.nEpochs, opts.minDist ?? 0.1, lr, opts.initPull ?? 0.01), S);
    if (initEmb) {
      // Align back onto init's own frame, fit on the keys that had an init position.
      const src: Record<NodeKey, Vec3> = {};
      nodes.forEach((m, i) => {
        src[m.key] = raw[i];
      });
      const aligned = alignTo(src, opts.init!).positions;
      pts = nodes.map((m) => aligned[m.key]);
    } else {
      pts = canonicalFrame(normalizeUnit(raw));
    }
  }

  const positions: Record<NodeKey, Vec3> = {};
  nodes.forEach((m, i) => {
    positions[m.key] = pts[i];
  });
  return finishLayout(space, positions, { weights: w, k, explain: opts.explain, S });
}

export interface FinishOptions {
  weights?: MetricWeights;
  /** Neighbors per node (default 8). */
  k?: number;
  explain?: ExplainFn;
  /** similarityMatrix(space.nodes, weights), when the caller already has it. */
  S?: Float64Array;
  /**
   * Ghost nodes (thin.ts): never listed as anyone's neighbor (their own list is
   * kept, over the other nodes: it's where they'd go), and left out of the fit
   * of the D5 plane, which they are only projected onto.
   */
  exclude?: ReadonlySet<NodeKey>;
}

/**
 * The shared tail of every layout path (UMAP solve, user-arranged layout): given
 * final 3D positions for the space's nodes, add the D5 plane and the explained
 * kNN neighbors. Positions for keys not in `space` are ignored.
 */
export function finishLayout(
  space: FeatureSpace,
  positions: Record<NodeKey, Vec3>,
  opts: FinishOptions = {},
): LayoutResult {
  const nodes = space.nodes;
  const n = nodes.length;
  const w = opts.weights;
  const k = opts.k ?? 8;
  const S = opts.S ?? similarityMatrix(nodes, w);
  const result: LayoutResult = { positions: {}, plane2d: {}, neighbors: {} };
  for (const m of nodes) if (positions[m.key]) result.positions[m.key] = positions[m.key];
  const ex = opts.exclude;
  const core = ex?.size ? Object.fromEntries(Object.entries(result.positions).filter(([key]) => !ex.has(key))) : null;
  if (core && Object.keys(core).length) {
    const b = planeBasis(core);
    for (const [key, p] of Object.entries(result.positions)) {
      const q = toPlane(p, b);
      result.plane2d[key] = [q[0], q[1]];
    }
  } else {
    result.plane2d = projectPlane(result.positions);
  }
  for (let i = 0; i < n; i++) {
    const near = topK(i, n, (j) => S[i * n + j], k, (j) => nodes[j].key, ex?.size ? (j) => !ex.has(nodes[j].key) : undefined);
    result.neighbors[nodes[i].key] = near.map((c) => ({
      key: nodes[c.j].key,
      sim: c.s,
      why: opts.explain ? opts.explain(nodes[i], nodes[c.j]) : blockShares(nodes[i], nodes[c.j], w),
    }));
  }
  return result;
}
