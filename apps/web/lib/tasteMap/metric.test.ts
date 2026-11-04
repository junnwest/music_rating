import { describe, expect, it } from 'vitest';
import { mulberry32, unitWeights } from './layout';
import { fitMetric, leaveOnePinOut, sampleTriplets } from './metric';
import type { FeatureSpace, MapNode, Vec3 } from './types';

function l2(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
}

const G = 5; // graph clusters (what the user's layout respects)
const T = 5; // tag clusters (independent of the layout)

/**
 * Two independent partitions: tags cluster = i % T, graph cluster = ⌊i / T⌋ % G.
 * The layout places nodes by graph cluster only, so a metric that respects the
 * user's map has to up-weight `graph` and down-weight `tags`.
 */
function makeSpace(perCell = 2, seed = 1): { space: FeatureSpace; positions: Record<string, Vec3> } {
  const rng = mulberry32(seed);
  const nodes: MapNode[] = [];
  const positions: Record<string, Vec3> = {};
  const oneHotish = (dim: number, c: number, per: number) => {
    const v = Array.from({ length: dim }, () => 0.1 * rng());
    for (let i = c * per; i < (c + 1) * per; i++) v[i] += 1;
    return l2(v);
  };
  let i = 0;
  for (let g = 0; g < G; g++)
    for (let t = 0; t < T; t++)
      for (let r = 0; r < perCell; r++, i++) {
        const key = `a:g${g}t${t}r${r}`;
        nodes.push({
          key,
          artistId: key,
          label: key,
          eraLabel: null,
          albumIds: [],
          ratedAlbumIds: [],
          mass: 1,
          avgScore: null,
          blocks: { tags: oneHotish(2 * T, t, 2), text: [0, 0], graph: oneHotish(2 * G, g, 2), era: [0, 0] },
          has: { tags: true, text: false, graph: true, era: false },
        });
        const a = (2 * Math.PI * g) / G;
        positions[key] = [0.8 * Math.cos(a) + 0.05 * (rng() - 0.5), 0.8 * Math.sin(a) + 0.05 * (rng() - 0.5), 0.05 * (rng() - 0.5)];
      }
  return {
    space: {
      tagDims: Array.from({ length: 2 * T }, (_, k) => ({ id: `t${k}`, label: `Tag ${k}` })),
      dims: { tags: 2 * T, text: 2, graph: 2 * G, era: 2 },
      nodes,
    },
    positions,
  };
}

const gOf = (k: string) => k.split('g')[1][0];

describe('sampleTriplets', () => {
  const { space, positions } = makeSpace();
  const pinned = space.nodes.filter((_, i) => i % 2 === 0).map((m) => m.key);

  it('samples close/far triplets from the map, deterministically', () => {
    const a = sampleTriplets(space, positions, pinned, [], { seed: 3, n: 200 });
    const b = sampleTriplets(space, positions, pinned, [], { seed: 3, n: 200 });
    expect(a).toEqual(b);
    expect(a.length).toBe(200);
    const pin = new Set(pinned);
    for (const t of a) {
      expect(pin.has(t.a)).toBe(true);
      expect(gOf(t.b)).toBe(gOf(t.a)); // close on the map = same graph cluster here
      expect(gOf(t.c)).not.toBe(gOf(t.a));
    }
    expect(sampleTriplets(space, positions, pinned, [], { seed: 4, n: 200 })).not.toEqual(a);
  });

  it('uses group co-membership as positives', () => {
    const key0 = space.nodes[0].key;
    const farKey = space.nodes.find((m) => gOf(m.key) === '2')!.key;
    const groups = [
      { key: key0, weights: { mine: 0.9 } },
      { key: farKey, weights: { mine: 0.7 } },
    ];
    const ts = sampleTriplets(space, positions, [], groups, { seed: 1, n: 300 });
    const g = ts.filter((t) => t.source === 'group');
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((t) => (t.a === key0 && t.b === farKey) || (t.a === farKey && t.b === key0))).toBe(true);
    expect(ts.every((t) => t.c !== farKey || t.a !== key0)).toBe(true);
  });

  it('returns nothing for tiny inputs', () => {
    expect(sampleTriplets({ ...space, nodes: space.nodes.slice(0, 2) }, positions, [], [])).toEqual([]);
  });
});

describe('fitMetric + leaveOnePinOut', () => {
  const { space, positions } = makeSpace();
  const pinned = space.nodes.map((m) => m.key);
  const triplets = sampleTriplets(space, positions, pinned, [], { seed: 11, n: 400 });

  it('recovers the block the layout respects', () => {
    const w = fitMetric(space, triplets);
    expect(w.block.graph).toBeGreaterThan(1.2 * w.block.tags);
    expect(w.block.graph).toBeGreaterThan(1);
    expect(w.block.tags).toBeLessThan(1);
    for (const v of Object.values(w.block)) expect(v).toBeGreaterThanOrEqual(0);
    expect(w.tagDims).toHaveLength(2 * T);
    for (const v of w.tagDims!) expect(v).toBeGreaterThanOrEqual(0);
    // Unused blocks stay at their prior.
    expect(w.block.text).toBe(1);
    expect(w.block.era).toBe(1);
  });

  it('learned weights beat unit weights on leave-one-pin-out', () => {
    const w = fitMetric(space, triplets);
    const res = leaveOnePinOut(space, positions, pinned, w);
    expect(res.n).toBe(space.nodes.length);
    expect(res.errLearned).toBeLessThan(res.errBaseline);
    expect(res.errLearned).toBeLessThan(0.5 * res.errBaseline);
  });

  it('is a no-op without triplets and with learnTags=false keeps tagDims null', () => {
    expect(fitMetric(space, [], { learnTags: false })).toEqual(unitWeights());
    const w = fitMetric(space, triplets, { learnTags: false });
    expect(w.tagDims).toBeNull();
    expect(w.block.graph).toBeGreaterThan(w.block.tags);
  });

  it('is deterministic', () => {
    expect(fitMetric(space, triplets)).toEqual(fitMetric(space, triplets));
  });

  it('leaveOnePinOut takes an optional baseline (default: unit weights)', () => {
    const w = fitMetric(space, triplets);
    const unit = leaveOnePinOut(space, positions, pinned, w);
    expect(leaveOnePinOut(space, positions, pinned, w, { baseline: unitWeights() })).toEqual(unit);
    // Baseline = the learned weights themselves → identical errors.
    const self = leaveOnePinOut(space, positions, pinned, w, { baseline: w });
    expect(self.errBaseline).toBe(self.errLearned);
    expect(self.errLearned).toBe(unit.errLearned);
    // A graph-only baseline already respects this layout, so it beats unit weights.
    const graphOnly = leaveOnePinOut(space, positions, pinned, w, { baseline: { block: { tags: 0, text: 0, graph: 1, era: 0 }, tagDims: null } });
    expect(graphOnly.errBaseline).toBeLessThan(unit.errBaseline);
  });
});
