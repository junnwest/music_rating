import { describe, expect, it } from 'vitest';
import { assign, contourInk, dendrogram, fingerprint, hexTiles, type StyleNode } from './styles';

const node = (key: string, x: number, y: number, realm: number, country = realm, mass = 1): StyleNode => ({
  key,
  label: key.toUpperCase(),
  mass,
  avgScore: 4,
  pos: [x, y],
  realm,
  country,
});

// Two clusters of 4 along x, one realm each.
const NODES = [
  node('a', 0, 0, 0),
  node('b', 0.1, 0, 0),
  node('c', 0, 0.1, 0),
  node('d', 0.1, 0.1, 0),
  node('w', 1, 0, 1),
  node('x', 1.1, 0, 1),
  node('y', 1, 0.1, 1),
  node('z', 1.1, 0.1, 1),
];

describe('assign', () => {
  it('finds the minimum-cost matching', () => {
    expect(assign([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
  });
});

describe('hexTiles', () => {
  const t = hexTiles(NODES);
  it('gives every star its own cell', () => {
    expect(new Set(t.tiles.map((x) => `${x.q},${x.r}`)).size).toBe(NODES.length);
  });
  it('keeps the two clusters apart and each in one piece', () => {
    const at = new Map(t.tiles.map((x) => [x.key, x]));
    const mean = (ks: string[]) => ks.reduce((s, k) => s + at.get(k)!.x, 0) / ks.length;
    expect(mean(['w', 'x', 'y', 'z']) - mean(['a', 'b', 'c', 'd'])).toBeGreaterThan(2);
    // Within a cluster every tile touches another (center distance 1).
    for (const k of ['a', 'b', 'c', 'd']) {
      const near = ['a', 'b', 'c', 'd'].filter((o) => o !== k && Math.hypot(at.get(o)!.x - at.get(k)!.x, at.get(o)!.y - at.get(k)!.y) < 1.01);
      expect(near.length).toBeGreaterThan(0);
    }
  });
  it('draws coasts and no province edges inside one-country realms', () => {
    expect(t.edges.some((e) => e.kind === 'coast')).toBe(true);
    expect(t.edges.some((e) => e.kind === 'province')).toBe(false);
  });
});

describe('contourInk', () => {
  it('gives each realm a summit near its members', () => {
    const c = contourInk(NODES);
    expect(c.levels.length).toBeGreaterThan(3);
    expect(c.summits).toHaveLength(2);
    expect(c.summits[0].x).toBeLessThan(0.3);
    expect(c.summits[1].x).toBeGreaterThan(0.8);
  });
});

describe('fingerprint', () => {
  it('stays positive and leans toward the heavier side', () => {
    const heavy = NODES.map((n) => (n.realm === 1 ? { ...n, mass: 4 } : n));
    const f = fingerprint(heavy);
    for (const c of f.curves) for (const r of c.r) expect(r).toBeGreaterThan(0);
    // The heavy realm sits at +x of the mass center: lean ≈ 0 rad.
    expect(Math.abs(f.lean)).toBeLessThan(0.6);
    expect(f.harmonics[0]).toBeGreaterThan(0.2);
    expect(f.arcs[0].realm).toBe(1);
  });
});

describe('dendrogram', () => {
  it('joins each cluster before joining the two', () => {
    const sim = (a: string, b: string) => {
      const A = NODES.find((n) => n.key === a)!;
      const B = NODES.find((n) => n.key === b)!;
      return A.realm === B.realm ? 0.8 : 0.1;
    };
    const d = dendrogram(NODES, sim);
    expect(d.order).toHaveLength(8);
    expect(d.root!.height).toBeCloseTo(0.1, 5);
    expect(d.root!.children.map((c) => c.realm).sort()).toEqual([0, 1]);
    const first = new Set(d.order.slice(0, 4).map((k) => NODES.find((n) => n.key === k)!.realm));
    expect(first.size).toBe(1);
  });
});
