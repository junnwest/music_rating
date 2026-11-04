import { describe, expect, it } from 'vitest';
import type { Atlas } from './regions';
import { schematicLayout, shellCapacity, type SchematicNode } from './schematic';
import type { Neighbor, NodeKey, Vec2 } from './types';

const nb = (pairs: [string, number][]): Neighbor[] => pairs.map(([key, sim]) => ({ key, sim, why: [] }));

/** An atlas from country member lists and inter-country link weights. */
function atlasOf(members: NodeKey[][], links: [number, number, number][] = []): Atlas {
  const countryOf = new Map<NodeKey, number>();
  members.forEach((ks, id) => ks.forEach((k) => countryOf.set(k, id)));
  return {
    countryOf,
    countries: members.map((ks, id) => ({ id, name: `c${id}`, hue: null, members: ks, mass: ks.length })),
    bridges: new Map(),
    links: links.map(([a, b, w]) => ({ a, b, w })),
  };
}

/** A clique per country (sim 0.8), laid out around `at` on the true plane. */
function world(spec: { n: number; at: Vec2 }[]) {
  const members: NodeKey[][] = [];
  const nodes: SchematicNode[] = [];
  const neighbors: Record<NodeKey, Neighbor[]> = {};
  spec.forEach(({ n, at }, c) => {
    const ks = Array.from({ length: n }, (_, i) => `c${c}n${i}`);
    members.push(ks);
    ks.forEach((k, i) => {
      const a = (i / n) * Math.PI * 2;
      nodes.push({ key: k, pos2d: [at[0] + 0.1 * Math.cos(a), at[1] + 0.1 * Math.sin(a)], mass: 1 });
      neighbors[k] = nb(ks.filter((o) => o !== k).map((o) => [o, 0.8] as [string, number]));
    });
  });
  return { members, nodes, neighbors };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('schematicLayout', () => {
  it('fills shells 1, 6, 12 … around a capital', () => {
    expect([0, 1, 2, 3].map(shellCapacity)).toEqual([1, 6, 12, 18]);
    const { members, nodes, neighbors } = world([{ n: 10, at: [0, 0] }]);
    const s = schematicLayout(nodes, atlasOf(members), neighbors);
    expect(s.pos.size).toBe(10);
    expect(s.nucleus).toBeNull();
    const c = s.countries[0];
    expect(c.shells).toHaveLength(2);
    const radii = [...s.pos.values()].map((q) => dist(q, c.center)).sort((a, b) => a - b);
    expect(radii[0]).toBeCloseTo(0, 6);
    expect(radii.slice(1, 7).every((r) => Math.abs(r - 1) < 1e-6)).toBe(true);
    expect(radii.slice(7).every((r) => Math.abs(r - 2) < 1e-6)).toBe(true);
  });

  it('puts the most central member at the capital', () => {
    const { members, nodes, neighbors } = world([{ n: 5, at: [0, 0] }]);
    // c0n3 is everyone's strongest neighbor.
    for (const k of members[0]) if (k !== 'c0n3') neighbors[k] = nb([['c0n3', 0.99], ...members[0].filter((o) => o !== k && o !== 'c0n3').map((o) => [o, 0.3] as [string, number])]);
    neighbors.c0n3 = nb(members[0].filter((o) => o !== 'c0n3').map((o) => [o, 0.99] as [string, number]));
    const s = schematicLayout(nodes, atlasOf(members), neighbors);
    expect(dist(s.pos.get('c0n3')!, s.countries[0].center)).toBeCloseTo(0, 9);
  });

  it('keeps every node about a slot apart and discs apart (VSEPR spacing)', () => {
    const { members, nodes, neighbors } = world([
      { n: 14, at: [-1, 0] },
      { n: 3, at: [1, 0.5] },
      { n: 7, at: [0.5, -1] },
      { n: 1, at: [1.5, -0.2] },
    ]);
    const s = schematicLayout(nodes, atlasOf(members, [[0, 1, 1], [1, 2, 0.5]]), neighbors);
    const ps = [...s.pos.values()];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(dist(ps[i], ps[j])).toBeGreaterThan(0.95);
    const cs = s.countries;
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) expect(dist(cs[i].center, cs[j].center)).toBeGreaterThanOrEqual(cs[i].radius + cs[j].radius);
    // The nucleus stays clear of every disc.
    for (const c of cs) expect(dist(c.center, s.nucleus!)).toBeGreaterThan(c.radius);
  });

  it('sets two countries opposite each other, oriented like the true map', () => {
    const { members, nodes, neighbors } = world([
      { n: 4, at: [-1, 0] },
      { n: 4, at: [1, 0] },
    ]);
    const s = schematicLayout(nodes, atlasOf(members), neighbors);
    const [a, b] = s.countries;
    expect(a.center[0]).toBeLessThan(s.nucleus![0]);
    expect(b.center[0]).toBeGreaterThan(s.nucleus![0]);
    expect(Math.abs(a.center[1] - b.center[1])).toBeLessThan(1e-6);
  });

  it('seats linked countries side by side', () => {
    // True angles alternate 0, 2, 1, 3 around the circle; links say 0–1 and 2–3.
    const at: Vec2[] = [[1, 0], [-1, 0.05], [0, 1], [0.05, -1]];
    const { members, nodes, neighbors } = world(at.map((p) => ({ n: 3, at: p })));
    const s = schematicLayout(nodes, atlasOf(members, [[0, 1, 1], [2, 3, 1]]), neighbors);
    const ang = s.countries.map((c) => Math.atan2(c.center[1] - s.nucleus![1], c.center[0] - s.nucleus![0]));
    const sep = (i: number, j: number) => Math.abs(Math.atan2(Math.sin(ang[i] - ang[j]), Math.cos(ang[i] - ang[j])));
    expect(sep(0, 1)).toBeLessThan(Math.PI * 0.75);
    expect(sep(2, 3)).toBeLessThan(Math.PI * 0.75);
  });

  it('turns a bridge toward the country it links to', () => {
    const { members, nodes, neighbors } = world([
      { n: 7, at: [-1, 0] },
      { n: 7, at: [1, 0] },
    ]);
    // c0n2 also likes country 1.
    neighbors.c0n2 = [...neighbors.c0n2, ...nb([['c1n0', 0.9], ['c1n1', 0.9]])];
    const s = schematicLayout(nodes, atlasOf(members, [[0, 1, 1]]), neighbors);
    const [home, away] = s.countries;
    const q = s.pos.get('c0n2')!;
    const toAway = [away.center[0] - home.center[0], away.center[1] - home.center[1]];
    const toQ = [q[0] - home.center[0], q[1] - home.center[1]];
    expect(toAway[0] * toQ[0] + toAway[1] * toQ[1]).toBeGreaterThan(0);
  });

  it('centers the discs, stretches to the stage aspect, and is deterministic', () => {
    const { members, nodes, neighbors } = world([
      { n: 9, at: [-2, 0] },
      { n: 5, at: [2, 0.4] },
      { n: 2, at: [0, 0.8] },
    ]);
    const atlas = atlasOf(members, [[0, 2, 1]]);
    const box = (sc: ReturnType<typeof schematicLayout>) => {
      const lo = [Math.min(...sc.countries.map((c) => c.center[0] - c.radius)), Math.min(...sc.countries.map((c) => c.center[1] - c.radius))];
      const hi = [Math.max(...sc.countries.map((c) => c.center[0] + c.radius)), Math.max(...sc.countries.map((c) => c.center[1] + c.radius))];
      return { lo, hi };
    };
    const s = schematicLayout(nodes, atlas, neighbors, 1);
    const { lo, hi } = box(s);
    expect(lo[0] + hi[0]).toBeCloseTo(0, 9);
    expect(lo[1] + hi[1]).toBeCloseTo(0, 9);
    expect(s.extent[0]).toBeCloseTo(hi[0] - lo[0], 9);
    const wide = schematicLayout(nodes, atlas, neighbors, 1.8);
    const tall = schematicLayout(nodes, atlas, neighbors, 1 / 1.8);
    expect(wide.extent[0] / wide.extent[1]).toBeGreaterThan(s.extent[0] / s.extent[1]);
    expect(tall.extent[0] / tall.extent[1]).toBeLessThan(s.extent[0] / s.extent[1]);
    expect([...schematicLayout(nodes, atlas, neighbors, 1).pos]).toEqual([...s.pos]);
  });

  it('skips nodes outside the atlas', () => {
    const { members, nodes, neighbors } = world([{ n: 3, at: [0, 0] }]);
    const s = schematicLayout([...nodes, { key: 'hidden', pos2d: [5, 5], mass: 1 }], atlasOf(members), neighbors);
    expect(s.pos.has('hidden')).toBe(false);
    expect(schematicLayout([], atlasOf([]), {}).pos.size).toBe(0);
  });
});
