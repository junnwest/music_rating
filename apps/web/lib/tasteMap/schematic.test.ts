import { describe, expect, it } from 'vitest';
import { neighborHonesty } from './honesty';
import { schematicLayout, type SchematicNode } from './schematic';
import type { Neighbor, NodeKey, Vec2 } from './types';

const nb = (pairs: [string, number][]): Neighbor[] => pairs.map(([key, sim]) => ({ key, sim, why: [] }));

/** A clique per cluster (sim 0.8), its members in a small ring around `at` on the true plane. */
function world(spec: { n: number; at: Vec2; r?: number }[]) {
  const nodes: SchematicNode[] = [];
  const neighbors: Record<NodeKey, Neighbor[]> = {};
  spec.forEach(({ n, at, r = 0.1 }, c) => {
    const ks = Array.from({ length: n }, (_, i) => `c${c}n${i}`);
    ks.forEach((k, i) => {
      const a = (i / n) * Math.PI * 2;
      nodes.push({ key: k, pos2d: [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)], mass: 1 });
      neighbors[k] = nb(ks.filter((o) => o !== k).map((o) => [o, 0.8] as [string, number]));
    });
  });
  return { nodes, neighbors };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearest = (ps: Vec2[]) => ps.map((p, i) => Math.min(...ps.filter((_, j) => j !== i).map((q) => dist(p, q))));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('schematicLayout', () => {
  it('keeps tiny maps as they are', () => {
    const { nodes, neighbors } = world([{ n: 2, at: [0, 0] }]);
    const s = schematicLayout(nodes, neighbors);
    expect(s.nucleus).toBeNull();
    for (const n of nodes) expect(s.pos.get(n.key)).toEqual(n.pos2d);
    expect(schematicLayout([], {}).pos.size).toBe(0);
  });

  it('fans two islands out around you (VSEPR)', () => {
    // True map: two tight islands, left and right, so every bearing is 0 or π.
    const { nodes, neighbors } = world([
      { n: 8, at: [-1, 0] },
      { n: 8, at: [1, 0] },
    ]);
    const s = schematicLayout(nodes, neighbors);
    const o = s.nucleus!;
    const bearings = [...s.pos.values()].map((q) => Math.atan2(q[1] - o[1], q[0] - o[0])).sort((a, b) => a - b);
    const gaps = bearings.map((a, i) => (i + 1 < bearings.length ? bearings[i + 1] - a : bearings[0] + 2 * Math.PI - a));
    // To scale the largest gap is π; fanned out, well under it.
    expect(Math.max(...gaps)).toBeLessThan((2 * Math.PI) / 3);
    // Still oriented like the true map: island 0 left of island 1.
    const cx = (c: number) => nodes.filter((n) => n.key.startsWith(`c${c}`)).reduce((t, n) => t + s.pos.get(n.key)![0], 0);
    expect(cx(0)).toBeLessThan(cx(1));
  });

  it('spreads stars evenly instead of stacking them', () => {
    const { nodes, neighbors } = world([
      { n: 10, at: [0, 0], r: 0.01 },
      { n: 4, at: [2, 1], r: 0.5 },
    ]);
    const ps = nodes.map((n) => schematicLayout(nodes, neighbors).pos.get(n.key)!);
    const nn = nearest(ps);
    expect(Math.min(...nn)).toBeGreaterThan(0.5 * median(nn));
  });

  it('puts a crossover between the sounds it links', () => {
    const { nodes, neighbors } = world([
      { n: 7, at: [-1, 0] },
      { n: 7, at: [1, 0] },
    ]);
    // x: true position on island 0's far side, but liked equally by both.
    nodes.push({ key: 'x', pos2d: [-1.15, 0.05], mass: 1 });
    neighbors.x = nb([['c0n0', 0.7], ['c0n1', 0.7], ['c1n0', 0.7], ['c1n1', 0.7]]);
    const s = schematicLayout(nodes, neighbors);
    const centroid = (c: number) => {
      const qs = nodes.filter((n) => n.key.startsWith(`c${c}`)).map((n) => s.pos.get(n.key)!);
      return [qs.reduce((t, q) => t + q[0], 0) / qs.length, qs.reduce((t, q) => t + q[1], 0) / qs.length] as Vec2;
    };
    const [a, b] = [centroid(0), centroid(1)];
    const x = s.pos.get('x')!;
    expect(dist(x, b)).toBeLessThan(dist(a, b));
  });

  it('keeps real neighborhoods together', () => {
    const { nodes, neighbors } = world([
      { n: 6, at: [-1, 0], r: 0.2 },
      { n: 6, at: [1, 0.2], r: 0.2 },
      { n: 6, at: [0, 1.2], r: 0.2 },
    ]);
    const s = schematicLayout(nodes, neighbors);
    expect(neighborHonesty(s.pos, neighbors).mean).toBeGreaterThan(0.9);
  });

  it('fits the true box, stays deterministic, and ignores input order', () => {
    const { nodes, neighbors } = world([
      { n: 9, at: [-2, 0] },
      { n: 5, at: [2, 0.4] },
      { n: 2, at: [0, 0.8] },
    ]);
    const s = schematicLayout(nodes, neighbors);
    const xs = nodes.map((n) => n.pos2d[0]);
    for (const q of s.pos.values()) {
      expect(q[0]).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
      expect(q[0]).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
    }
    expect([...schematicLayout(nodes, neighbors).pos]).toEqual([...s.pos]);
    const shuffled = schematicLayout([...nodes].reverse(), neighbors);
    for (const [k, q] of s.pos) expect(shuffled.pos.get(k)).toEqual(q);
  });
});
