/**
 * D6 personal metric: diagonal weights learned from triplets sampled off the
 * user's pinned/grouped layout. Learns the 4 block weights plus per-dimension
 * weights on the (named) tags block.
 *
 *   loss = mean_t max(0, m + d_w(A,B) − d_w(A,C)) + λ·(‖w_block − w₀‖² + ‖w_tags − w₀‖²),
 *   w₀ = the starting weights (opts.init, else 1),
 *   d_w = 1 − sim_w, projected gradient so every weight stays ≥ 0.
 *
 * Eval (leave-one-pin-out): predict each pinned node from the others by kNN
 * barycentre (placeNew) with w = 1 and w = learned; the caller keeps w = 1
 * unless errLearned < errBaseline.
 */
import { mulberry32, placeNew, unitWeights } from './layout';
import { BLOCKS, type BlockName, type FeatureSpace, type MapNode, type MetricWeights, type NodeKey, type Vec3 } from './types';

export interface Triplet {
  /** Anchor. */
  a: NodeKey;
  /** Positive: close to A on the map, or co-member of a group. */
  b: NodeKey;
  /** Negative: far from A on the map. */
  c: NodeKey;
  source: 'map' | 'group';
}

export interface GroupMembership {
  key: NodeKey;
  weights: Record<string, number>;
}

export interface SampleOptions {
  seed?: number;
  /** Max triplets (default 400). */
  n?: number;
  /** Close radius on the map (default: 10th percentile of pairwise map distances). */
  r?: number;
  /** Far radius (default: median pairwise map distance). */
  R?: number;
  /** Min membership for two nodes to count as co-members (default 0.5). */
  groupThreshold?: number;
}

const dist3 = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Triplets from the current (user-corrected) layout. Anchors are the pinned and
 * grouped nodes (all nodes if there are none); B is within `r` of A on the map
 * or shares a group with A; C is beyond `R` and shares no group with A.
 * Deterministic for a given seed.
 */
export function sampleTriplets(
  space: FeatureSpace,
  positions: Record<NodeKey, Vec3>,
  pinnedKeys: Iterable<NodeKey>,
  groups: GroupMembership[] = [],
  opts: SampleOptions = {},
): Triplet[] {
  const keys = space.nodes
    .map((m) => m.key)
    .filter((k) => positions[k])
    .sort();
  if (keys.length < 3) return [];
  const max = opts.n ?? 400;
  const thr = opts.groupThreshold ?? 0.5;
  const rng = mulberry32(opts.seed ?? 7);

  const gm = new Map<NodeKey, Set<string>>();
  for (const g of groups) {
    const s = new Set(Object.entries(g.weights).filter(([, w]) => w >= thr).map(([id]) => id));
    if (s.size) gm.set(g.key, s);
  }
  const share = (a: NodeKey, b: NodeKey) => {
    const sa = gm.get(a);
    const sb = gm.get(b);
    if (!sa || !sb) return false;
    for (const g of sa) if (sb.has(g)) return true;
    return false;
  };

  let r = opts.r;
  let R = opts.R;
  if (r == null || R == null) {
    const ds: number[] = [];
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) ds.push(dist3(positions[keys[i]], positions[keys[j]]));
    ds.sort((x, y) => x - y);
    r ??= quantile(ds, 0.1);
    R ??= quantile(ds, 0.5);
  }

  const keySet = new Set(keys);
  const pinned = new Set([...pinnedKeys].filter((k) => keySet.has(k)));
  let anchors = keys.filter((k) => pinned.has(k) || gm.has(k));
  if (!anchors.length) anchors = keys;

  const pools = anchors.map((a) => {
    const pa = positions[a];
    const close: [NodeKey, 'map' | 'group'][] = [];
    const far: NodeKey[] = [];
    for (const k of keys) {
      if (k === a) continue;
      const d = dist3(pa, positions[k]);
      const sh = share(a, k);
      if (sh) close.push([k, 'group']);
      else if (d < r!) close.push([k, 'map']);
      else if (d > R!) far.push(k);
    }
    return { a, close, far };
  }).filter((p) => p.close.length && p.far.length);
  if (!pools.length) return [];

  const out: Triplet[] = [];
  const seen = new Set<string>();
  const perAnchor = Math.ceil(max / pools.length);
  const capacity = pools.reduce((s, p) => s + Math.min(perAnchor, p.close.length * p.far.length), 0);
  const target = Math.min(max, capacity);
  let guard = 0;
  while (out.length < target && guard < target * 20) {
    for (const p of pools) {
      if (out.length >= target) break;
      guard++;
      const [b, source] = p.close[Math.floor(rng() * p.close.length)];
      const c = p.far[Math.floor(rng() * p.far.length)];
      const id = `${p.a}|${b}|${c}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ a: p.a, b, c, source });
    }
  }
  return out;
}

export interface FitOptions {
  /** Hinge margin (default 0.1). */
  margin?: number;
  /** Pull toward the starting weights (`init`, else w = 1) (default 0.01). */
  lambda?: number;
  /** Learning rate (default 2). */
  lr?: number;
  /** Full-batch iterations (default 300). */
  iters?: number;
  /** Learn per-dim tag weights (default true). */
  learnTags?: boolean;
  init?: MetricWeights;
}

/** Precomputed per-pair statistics so each iteration is O(blocks + nnz(tags)). */
interface PairStats {
  /** Unweighted dot per non-tag block (NaN if not both has). */
  dot: Record<BlockName, number>;
  both: Record<BlockName, boolean>;
  /** Nonzero tag products a_k·b_k. */
  tagIdx: number[];
  tagProd: number[];
}

function pairStats(a: MapNode, b: MapNode): PairStats {
  const dot = { tags: 0, text: 0, graph: 0, era: 0 } as Record<BlockName, number>;
  const both = { tags: false, text: false, graph: false, era: false } as Record<BlockName, boolean>;
  const tagIdx: number[] = [];
  const tagProd: number[] = [];
  for (const blk of BLOCKS) {
    if (!a.has[blk] || !b.has[blk]) continue;
    both[blk] = true;
    const x = a.blocks[blk];
    const y = b.blocks[blk];
    const n = Math.min(x.length, y.length);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = x[i] * y[i];
      if (p === 0) continue;
      s += p;
      if (blk === 'tags') {
        tagIdx.push(i);
        tagProd.push(p);
      }
    }
    dot[blk] = s;
  }
  return { dot, both, tagIdx, tagProd };
}

/** sim and its gradient wrt block weights and tag weights (accumulated with factor g). */
function simAndGrad(
  ps: PairStats,
  wb: Record<BlockName, number>,
  wt: Float64Array,
  learnTags: boolean,
  g: number,
  gb: Record<BlockName, number> | null,
  gt: Float64Array | null,
): number {
  let denom = 0;
  for (const blk of BLOCKS) if (ps.both[blk]) denom += wb[blk];
  if (denom <= 1e-12) return 0;
  const s: Record<BlockName, number> = { tags: 0, text: 0, graph: 0, era: 0 };
  for (const blk of BLOCKS) {
    if (!ps.both[blk]) continue;
    if (blk === 'tags') {
      let t = 0;
      for (let i = 0; i < ps.tagIdx.length; i++) t += wt[ps.tagIdx[i]] * ps.tagProd[i];
      s.tags = t;
    } else {
      s[blk] = ps.dot[blk];
    }
  }
  let num = 0;
  for (const blk of BLOCKS) if (ps.both[blk]) num += wb[blk] * s[blk];
  const sim = num / denom;
  if (gb) {
    for (const blk of BLOCKS) if (ps.both[blk]) gb[blk] += (g * (s[blk] - sim)) / denom;
  }
  if (gt && learnTags && ps.both.tags) {
    const f = (g * wb.tags) / denom;
    for (let i = 0; i < ps.tagIdx.length; i++) gt[ps.tagIdx[i]] += f * ps.tagProd[i];
  }
  return sim;
}

/** Fit block weights (+ tag per-dim weights) to the triplets. Returns unit weights when there are none. */
export function fitMetric(space: FeatureSpace, triplets: Triplet[], opts: FitOptions = {}): MetricWeights {
  const margin = opts.margin ?? 0.1;
  const lambda = opts.lambda ?? 0.01;
  const lr = opts.lr ?? 2;
  const iters = opts.iters ?? 300;
  const learnTags = opts.learnTags ?? true;
  const nTags = space.dims.tags ?? space.tagDims.length;

  const wb = { ...(opts.init?.block ?? unitWeights().block) } as Record<BlockName, number>;
  const wt = new Float64Array(nTags).fill(1);
  if (opts.init?.tagDims) opts.init.tagDims.forEach((v, i) => i < nTags && (wt[i] = v));
  // The regularizer pulls toward where the fit started (e.g. DEFAULT_METRIC's era 0.5), not toward 1.
  const priorB = { ...wb };
  const priorT = Float64Array.from(wt);

  const byKey = new Map(space.nodes.map((m) => [m.key, m]));
  const pairs: { ab: PairStats; ac: PairStats }[] = [];
  for (const t of triplets) {
    const a = byKey.get(t.a);
    const b = byKey.get(t.b);
    const c = byKey.get(t.c);
    if (!a || !b || !c) continue;
    pairs.push({ ab: pairStats(a, b), ac: pairStats(a, c) });
  }
  if (!pairs.length) return { block: wb, tagDims: learnTags ? Array.from(wt) : opts.init?.tagDims ?? null };

  const T = pairs.length;
  for (let it = 0; it < iters; it++) {
    const gb: Record<BlockName, number> = { tags: 0, text: 0, graph: 0, era: 0 };
    const gt = learnTags ? new Float64Array(nTags) : null;
    for (const p of pairs) {
      const sAB = simAndGrad(p.ab, wb, wt, learnTags, 0, null, null);
      const sAC = simAndGrad(p.ac, wb, wt, learnTags, 0, null, null);
      // hinge on m + (1 − sAB) − (1 − sAC) = m − sAB + sAC
      if (margin - sAB + sAC <= 0) continue;
      simAndGrad(p.ab, wb, wt, learnTags, -1 / T, gb, gt);
      simAndGrad(p.ac, wb, wt, learnTags, 1 / T, gb, gt);
    }
    for (const blk of BLOCKS) {
      gb[blk] += 2 * lambda * (wb[blk] - priorB[blk]);
      wb[blk] = Math.max(0, wb[blk] - lr * gb[blk]);
    }
    if (gt) {
      for (let k = 0; k < nTags; k++) {
        const grad = gt[k] + 2 * lambda * (wt[k] - priorT[k]);
        wt[k] = Math.max(0, wt[k] - lr * grad);
      }
    }
  }
  return { block: wb, tagDims: learnTags ? Array.from(wt) : opts.init?.tagDims ?? null };
}

/**
 * Leave-one-pin-out: for each pinned node, predict its position from every other
 * placed node with placeNew (kNN barycentre) under the baseline weights and under
 * `w`. Errors are mean Euclidean distances in map units.
 *
 * `baseline` defaults to unit weights (w = 1). The route passes DEFAULT_METRIC
 * (features.ts) instead, so "baseline" means the metric the map actually uses
 * when nothing is learned.
 */
export function leaveOnePinOut(
  space: FeatureSpace,
  positions: Record<NodeKey, Vec3>,
  pinnedKeys: Iterable<NodeKey>,
  w: MetricWeights,
  opts: { k?: number; baseline?: MetricWeights } = {},
): { errBaseline: number; errLearned: number; n: number } {
  const byKey = new Map(space.nodes.map((m) => [m.key, m]));
  const pins = [...new Set(pinnedKeys)].filter((k) => positions[k] && byKey.has(k)).sort();
  let eb = 0;
  let el = 0;
  let n = 0;
  const unit = opts.baseline ?? unitWeights();
  for (const key of pins) {
    const others = { ...positions };
    delete others[key];
    if (!Object.keys(others).length) continue;
    const node = byKey.get(key)!;
    const truth = positions[key];
    eb += dist3(placeNew(space, others, node, { weights: unit, k: opts.k }).pos, truth);
    el += dist3(placeNew(space, others, node, { weights: w, k: opts.k }).pos, truth);
    n++;
  }
  return n ? { errBaseline: eb / n, errLearned: el / n, n } : { errBaseline: 0, errLearned: 0, n: 0 };
}
