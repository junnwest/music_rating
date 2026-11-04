import { describe, expect, it } from 'vitest';
import { createRearrange } from './forceLayout';
import { alignTo, closeGaps, ISLAND_CUT, MIN_STRAIT, mulberry32, placeNew, projectPlane, solveLayout, weightedSimilarity } from './layout';
import type { FeatureSpace, MapNode, Vec3 } from './types';

const DIMS = { tags: 12, text: 8, graph: 6, era: 2 };

function l2(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
}

/** `clusters` well-separated groups: each owns a disjoint slice of every block, plus noise. */
function makeSpace(perCluster: number, clusters = 3, seed = 1, noise = 0.15): FeatureSpace {
  const rng = mulberry32(seed);
  const nodes: MapNode[] = [];
  const block = (dim: number, c: number) => {
    const v = Array.from({ length: dim }, () => noise * rng());
    const span = Math.max(1, Math.floor(dim / clusters));
    for (let i = c * span; i < Math.min(dim, (c + 1) * span); i++) v[i] += 1;
    return l2(v);
  };
  for (let c = 0; c < clusters; c++) {
    for (let i = 0; i < perCluster; i++) {
      nodes.push({
        key: `a:c${c}n${i}`,
        artistId: `c${c}n${i}`,
        label: `Artist ${c}-${i}`,
        eraLabel: null,
        albumIds: [],
        ratedAlbumIds: [],
        mass: 1,
        avgScore: null,
        blocks: { tags: block(DIMS.tags, c), text: block(DIMS.text, c), graph: block(DIMS.graph, c), era: l2([1, rng()]) },
        has: { tags: true, text: true, graph: true, era: true },
      });
    }
  }
  return {
    tagDims: Array.from({ length: DIMS.tags }, (_, i) => ({ id: `t${i}`, label: `Tag ${i}` })),
    dims: DIMS,
    nodes,
  };
}

const cluster = (key: string) => key.split('c')[1].split('n')[0];
const d3 = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

function intraInter(pos: Record<string, Vec3>) {
  const keys = Object.keys(pos);
  let intra = 0, ni = 0, inter = 0, nx = 0;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const d = d3(pos[keys[i]], pos[keys[j]]);
      if (cluster(keys[i]) === cluster(keys[j])) (intra += d), ni++;
      else (inter += d), nx++;
    }
  return { intra: intra / ni, inter: inter / nx };
}

describe('weightedSimilarity', () => {
  it('ignores blocks a node lacks and honours weights', () => {
    const s = makeSpace(2);
    const [a, b] = s.nodes;
    const base = weightedSimilarity(a, b);
    expect(base).toBeGreaterThan(0.8);
    const b2 = { ...b, has: { ...b.has, text: false }, blocks: { ...b.blocks, text: new Array(8).fill(0) } };
    expect(weightedSimilarity(a, b2)).toBeGreaterThan(0.8); // not dragged down by the missing block
    const far = s.nodes[2];
    expect(weightedSimilarity(a, far)).toBeLessThan(0.4);
  });
});

describe('solveLayout', () => {
  const space = makeSpace(12);

  it('separates clusters in 3D, within roughly [-1,1]^3', () => {
    const r = solveLayout(space, { seed: 3 });
    const { intra, inter } = intraInter(r.positions);
    expect(intra).toBeLessThan(inter * 0.5);
    for (const p of Object.values(r.positions)) for (const x of p) expect(Math.abs(x)).toBeLessThanOrEqual(1.0001);
  });

  it('is deterministic for a seed', () => {
    const a = solveLayout(space, { seed: 5 });
    const b = solveLayout(space, { seed: 5 });
    expect(b.positions).toEqual(a.positions);
    expect(b.plane2d).toEqual(a.plane2d);
  });

  it('stays aligned to init on a re-solve with another seed', () => {
    const first = solveLayout(space, { seed: 1 });
    const again = solveLayout(space, { seed: 99, init: first.positions });
    const cold = solveLayout(space, { seed: 99 });
    const rms = (x: Record<string, Vec3>) => {
      const ks = Object.keys(first.positions);
      return Math.sqrt(ks.reduce((s, k) => s + d3(x[k], first.positions[k]) ** 2, 0) / ks.length);
    };
    const warm = rms(again.positions);
    expect(warm).toBeLessThan(0.15);
    // Cluster centroids barely move.
    for (const c of ['0', '1', '2']) {
      const ks = Object.keys(first.positions).filter((k) => cluster(k) === c);
      const cen = (P: Record<string, Vec3>) =>
        [0, 1, 2].map((d) => ks.reduce((s, k) => s + P[k][d], 0) / ks.length) as Vec3;
      expect(d3(cen(again.positions), cen(first.positions))).toBeLessThan(0.1);
    }
    // A cold solve with the same seed, even after Procrustes, moves more than the warm one.
    expect(alignTo(cold.positions, first.positions).rms).toBeGreaterThan(warm);
  });

  it('keeps unseen nodes near their cluster when init is partial', () => {
    const first = solveLayout(space, { seed: 1 });
    const init = { ...first.positions };
    delete init['a:c1n0'];
    const again = solveLayout(space, { seed: 2, init });
    const others = Object.keys(first.positions).filter((k) => cluster(k) === '1' && k !== 'a:c1n0');
    const cen = [0, 1, 2].map((d) => others.reduce((s, k) => s + again.positions[k][d], 0) / others.length) as Vec3;
    expect(d3(again.positions['a:c1n0'], cen)).toBeLessThan(0.4);
  });

  it('gives plane2d a deterministic sign independent of key order', () => {
    const r = solveLayout(space, { seed: 4 });
    const reversed = Object.fromEntries(Object.entries(r.positions).reverse());
    expect(projectPlane(reversed)).toEqual(r.plane2d);
    // A re-solve from init must not mirror the plane: each axis correlates positively.
    const again = solveLayout(space, { seed: 77, init: r.positions });
    const ks = Object.keys(r.plane2d);
    for (const d of [0, 1]) {
      const corr = ks.reduce((s, k) => s + r.plane2d[k][d] * again.plane2d[k][d], 0);
      expect(corr).toBeGreaterThan(0);
    }
  });

  it('returns explained top-k neighbors from the same cluster', () => {
    const r = solveLayout(space, { seed: 3, k: 5 });
    for (const [key, ns] of Object.entries(r.neighbors)) {
      expect(ns).toHaveLength(5);
      expect(ns.every((n) => cluster(n.key) === cluster(key))).toBe(true);
      const tot = ns[0].why.reduce((s, c) => s + c.share, 0);
      expect(tot).toBeCloseTo(1, 6);
    }
    const custom = solveLayout(space, { seed: 3, k: 1, explain: () => [{ label: 'x', share: 1 }] });
    expect(Object.values(custom.neighbors)[0][0].why).toEqual([{ label: 'x', share: 1 }]);
  });

  it('handles n < 4 without UMAP', () => {
    for (const n of [0, 1, 2, 3]) {
      const s = { ...space, nodes: space.nodes.slice(0, n) };
      const r = solveLayout(s);
      expect(Object.keys(r.positions)).toHaveLength(n);
      for (const p of Object.values(r.positions)) expect(p.every(Number.isFinite)).toBe(true);
    }
    const four = solveLayout({ ...space, nodes: [space.nodes[0], space.nodes[1], space.nodes[12], space.nodes[24]] });
    expect(Object.keys(four.positions)).toHaveLength(4);
  });

  it('runs n=300 within budget', () => {
    const big = makeSpace(100, 3, 9);
    const t0 = performance.now();
    const r = solveLayout(big, { seed: 1 });
    const ms = performance.now() - t0;
    console.log(`solveLayout n=300: ${ms.toFixed(0)} ms`);
    const t1 = performance.now();
    solveLayout(big, { seed: 2, init: r.positions });
    console.log(`solveLayout n=300 with init: ${(performance.now() - t1).toFixed(0)} ms`);
    expect(ms).toBeLessThan(15000);
    const { intra, inter } = intraInter(r.positions);
    expect(intra).toBeLessThan(inter);
  }, 30000);
});

describe('closeGaps', () => {
  // Two 3×3 grids of points (spacing 0.1) whose centers sit `gap` apart along x.
  const islands = (gap: number): Vec3[] => {
    const out: Vec3[] = [];
    for (const cx of [-gap / 2, gap / 2]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push([cx + 0.1 * i, 0.1 * j, 0]);
    return out;
  };
  // Similarity: neighbors in a grid ~0.8, across islands 0.1.
  const simOf = (pts: Vec3[]) => {
    const n = pts.length;
    const S = new Float64Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) S[i * n + j] = i === j ? 1 : (i < 9) === (j < 9) ? 1 - 2 * d3(pts[i], pts[j]) : 0.1;
    return S;
  };

  it('slides islands in rigidly, keeping a strait', () => {
    const pts = islands(10);
    const out = closeGaps(pts, simOf(pts));
    expect(d3(out[0], out[9])).toBeLessThan(d3(pts[0], pts[9]));
    // Each island keeps its shape.
    for (let i = 1; i < 9; i++) {
      expect(d3(out[0], out[i])).toBeCloseTo(d3(pts[0], pts[i]), 9);
      expect(d3(out[9], out[9 + i])).toBeCloseTo(d3(pts[9], pts[9 + i]), 9);
    }
    let strait = Infinity;
    for (let i = 0; i < 9; i++) for (let j = 9; j < 18; j++) strait = Math.min(strait, d3(out[i], out[j]));
    expect(strait).toBeGreaterThanOrEqual(MIN_STRAIT * 0.1 - 1e-9);
  });

  it('leaves one island, and islands already close, alone', () => {
    const one = islands(10).slice(0, 9);
    expect(closeGaps(one, simOf(one))).toBe(one);
    // Gap under ISLAND_CUT median edges: not islands at all.
    const near = islands(0.2 + 0.1 * ISLAND_CUT * 0.9);
    expect(closeGaps(near, simOf(near))).toBe(near);
  });
});

describe('alignTo', () => {
  it('recovers a rotation + scale + translation exactly', () => {
    const rng = mulberry32(3);
    const src: Record<string, Vec3> = {};
    for (let i = 0; i < 20; i++) src[`k${i}`] = [rng(), rng(), rng()];
    const th = 0.7;
    const dst: Record<string, Vec3> = {};
    for (const [k, p] of Object.entries(src))
      dst[k] = [2 * (Math.cos(th) * p[0] - Math.sin(th) * p[1]) + 1, 2 * (Math.sin(th) * p[0] + Math.cos(th) * p[1]) - 3, 2 * p[2] + 0.5];
    const r = alignTo(src, dst, { allowReflection: false });
    expect(r.rms).toBeLessThan(1e-9);
  });

  it('handles planar and tiny inputs', () => {
    const src: Record<string, Vec3> = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], d: [1, 1, 0] };
    const dst: Record<string, Vec3> = { a: [0, 0, 0], b: [0, 1, 0], c: [-1, 0, 0], d: [-1, 1, 0] };
    expect(alignTo(src, dst).rms).toBeLessThan(1e-9);
    expect(alignTo({ a: [1, 2, 3] }, { a: [0, 0, 0] }).positions.a).toEqual([0, 0, 0]);
  });
});

describe('placeNew', () => {
  it('lands a new node near its cluster', () => {
    const space = makeSpace(10);
    const r = solveLayout(space, { seed: 2 });
    const newbie = makeSpace(1, 3, 77).nodes[1]; // a fresh cluster-1 node
    newbie.key = 'a:new';
    const { pos, anchors } = placeNew(space, r.positions, newbie);
    expect(anchors).toHaveLength(5);
    expect(anchors.every((a) => cluster(a.key) === '1')).toBe(true);
    const cen = (c: string) => {
      const ks = Object.keys(r.positions).filter((k) => cluster(k) === c);
      return [0, 1, 2].map((d) => ks.reduce((s, k) => s + r.positions[k][d], 0) / ks.length) as Vec3;
    };
    expect(d3(pos, cen('1'))).toBeLessThan(d3(pos, cen('0')));
    expect(d3(pos, cen('1'))).toBeLessThan(d3(pos, cen('2')));
  });

  it('returns the origin when nothing is placed', () => {
    const space = makeSpace(2);
    expect(placeNew(space, {}, space.nodes[0]).pos).toEqual([0, 0, 0]);
  });
});

describe('createRearrange', () => {
  const space = makeSpace(8);
  const solved = solveLayout(space, { seed: 1 });
  const nodes = space.nodes.map((m, i) => ({ key: m.key, pos: solved.positions[m.key], pinned: i % 5 === 0, size: 0.03 }));
  const links = Object.entries(solved.neighbors).flatMap(([a, ns]) => ns.slice(0, 4).map((n) => ({ a, b: n.key, sim: n.sim })));
  const groups = space.nodes.map((m) => ({ key: m.key, weights: { [`g${cluster(m.key)}`]: 0.8 } }));

  it('keeps pinned nodes exactly fixed in 3d', () => {
    const sim = createRearrange(nodes, links, groups, { seed: 1 });
    const target: Vec3 = [0.9, -0.9, 0.5];
    sim.pin(space.nodes[1].key, target);
    let ticks = 0;
    sim.on('tick', () => ticks++);
    sim.tick(150).tick(150);
    expect(ticks).toBe(2);
    const p = sim.positions();
    for (const n of nodes.filter((x) => x.pinned)) expect(p[n.key]).toEqual(n.pos);
    expect(p[space.nodes[1].key]).toEqual(target);
    for (const v of Object.values(p)) expect(v.every(Number.isFinite)).toBe(true);
    sim.unpin(space.nodes[1].key);
    sim.tick(50);
    expect(sim.isPinned(space.nodes[1].key)).toBe(false);
    expect(sim.positions()[space.nodes[1].key]).not.toEqual(target);
  });

  it('2d mode fixes x,y of pins, keeps z, and resolves overlaps', () => {
    const plane = solved.plane2d;
    const stacked = space.nodes.map((m, i) => ({
      key: m.key,
      pos: (i < 4 ? [0, 0, i * 0.1] : [plane[m.key][0], plane[m.key][1], 0.2]) as Vec3,
      pinned: i === 0,
      size: 0.05,
    }));
    const sim = createRearrange(stacked, links, [], { mode: '2d', seed: 2 });
    sim.tick(200);
    const p = sim.positions();
    expect(p[stacked[0].key]).toEqual([0, 0, 0]);
    expect(p[stacked[2].key][2]).toBeCloseTo(0.2, 12);
    for (let i = 1; i < 4; i++) expect(Math.hypot(p[stacked[i].key][0], p[stacked[i].key][1])).toBeGreaterThan(0.05);
  });

  it('is deterministic for a seed', () => {
    const a = createRearrange(nodes, links, groups, { seed: 3 }).tick(100).positions();
    const b = createRearrange(nodes, links, groups, { seed: 3 }).tick(100).positions();
    expect(b).toEqual(a);
  });
});
