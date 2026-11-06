import { describe, expect, it } from 'vitest';
import { betweenness, buildAtlas, communities, knnGraph, regionFields, type AtlasNode } from './regions';
import type { Neighbor } from './types';

// Two tight triangles (a, b, c) and (x, y, z), joined only through c — z.
const NB: Record<string, Neighbor[]> = {
  a: [{ key: 'b', sim: 0.9, why: [] }, { key: 'c', sim: 0.8, why: [] }],
  b: [{ key: 'a', sim: 0.9, why: [] }, { key: 'c', sim: 0.8, why: [] }],
  c: [{ key: 'a', sim: 0.8, why: [] }, { key: 'z', sim: 0.3, why: [] }],
  x: [{ key: 'y', sim: 0.9, why: [] }, { key: 'z', sim: 0.8, why: [] }],
  y: [{ key: 'x', sim: 0.9, why: [] }, { key: 'z', sim: 0.8, why: [] }],
  z: [{ key: 'x', sim: 0.8, why: [] }],
  lone: [],
};
const KEYS = new Set(Object.keys(NB));

describe('regions graph', () => {
  const g = knnGraph(NB, KEYS);

  it('symmetrizes the kNN lists', () => {
    expect(g.get('z')!.get('c')).toBe(0.3);
    expect(g.get('lone')!.size).toBe(0);
  });

  it('finds the two triangles and keeps an isolated node on its own', () => {
    const c = communities(g, (k) => (k === 'x' ? 5 : 1));
    expect(c.get('a')).toBe(c.get('b'));
    expect(c.get('a')).toBe(c.get('c'));
    expect(c.get('x')).toBe(c.get('z'));
    expect(c.get('a')).not.toBe(c.get('x'));
    // Heaviest community first.
    expect(c.get('x')).toBe(0);
    expect(new Set(c.values()).size).toBe(3);
  });

  it('puts the joint nodes on the most shortest paths', () => {
    const bc = betweenness(g);
    const top = [...bc].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([k]) => k).sort();
    expect(top).toEqual(['c', 'z']);
    expect(bc.get('a')).toBe(0);
  });
});

describe('knnGraph hubness guard', () => {
  it('keeps only mutual edges for a node in nearly every list', () => {
    // h is everyone's neighbor (an evidence-poor node), but only lists p and q.
    const keys = ['h', 'p', 'q', 'r', 's', 't'];
    const nb = (...ks: string[]): Neighbor[] => ks.map((key) => ({ key, sim: 0.9, why: [] }));
    const lists: Record<string, Neighbor[]> = { h: nb('p'), p: nb('h'), q: nb('h'), r: nb('h'), s: nb('h'), t: nb('h') };
    const g = knnGraph(lists, new Set(keys));
    expect([...g.get('h')!.keys()]).toEqual(['p']);
    expect(g.get('r')!.size).toBe(0);
  });
});

describe('buildAtlas', () => {
  const nodes = [...KEYS].map((key): AtlasNode => ({
    key,
    label: key.toUpperCase(),
    mass: 1,
    mix: ('abc'.includes(key) ? { rock: 1 } : 'xyz'.includes(key) ? { rap: 0.8 } : {}) as Record<string, number>,
    groups: { g1: 1 },
  }));
  const palette = [
    { id: 'rock', label: 'Rock', hue: 20 },
    { id: 'rap', label: 'Rap', hue: 200 },
  ];
  const atlas = buildAtlas(nodes, NB, KEYS, palette, { g1: 'Group One' });

  it('names countries by their palette tag, else group', () => {
    const names = atlas.countries.map((c) => c.name).sort();
    expect(names).toEqual(['Group One', 'Rap', 'Rock']);
    expect(atlas.countries.find((c) => c.name === 'Rap')!.hue).toBe(200);
  });

  it('marks the joints as bridges and bundles the crossing edge', () => {
    expect([...atlas.bridges.keys()].sort()).toEqual(['c', 'z']);
    const c = atlas.bridges.get('c')!;
    expect(c.countries).toEqual([atlas.countryOf.get('c'), atlas.countryOf.get('z')]);
    expect(atlas.links).toHaveLength(1);
    expect(atlas.links[0].w).toBeCloseTo(0.3, 5);
  });
});

describe('regionFields', () => {
  it('splits land between two countries and leaves empty space unclaimed', () => {
    const grid = { x0: 0, y0: 0, cell: 1, nx: 11, ny: 1 };
    const [f0, f1] = regionFields(
      [
        { x: 2, y: 0, w: 1, country: 0 },
        { x: 6, y: 0, w: 1, country: 1 },
      ],
      grid,
      1,
      2,
      0.2,
    );
    expect(f0[2]).toBeGreaterThan(0);
    expect(f1[2]).toBeLessThan(0);
    expect(f1[6]).toBeGreaterThan(0);
    // The border falls halfway; far away nobody owns the land.
    expect(Math.abs(f0[4])).toBeLessThan(1e-9);
    expect(f0[10]).toBeLessThan(0);
    expect(f1[10]).toBeLessThan(0);
  });
});

describe('buildAtlas realms', () => {
  // Two rap communities (a–c, x–z) joined by one weak edge, plus a rock one.
  const keys = ['a', 'b', 'c', 'x', 'y', 'z', 'p', 'q', 'r'];
  const tri = (ks: string[], s: number) =>
    Object.fromEntries(ks.map((k) => [k, ks.filter((o) => o !== k).map((o) => ({ key: o, sim: s, why: [] }))]));
  const nb: Record<string, { key: string; sim: number; why: never[] }[]> = { ...tri(['a', 'b', 'c'], 0.9), ...tri(['x', 'y', 'z'], 0.9), ...tri(['p', 'q', 'r'], 0.9) };
  nb.c = [...nb.c, { key: 'x', sim: 0.1, why: [] }];
  nb.r = [...nb.r, { key: 'z', sim: 0.1, why: [] }];
  const nodes = keys.map((key): AtlasNode => ({
    key,
    label: key === 'b' ? 'B-Star' : key.toUpperCase(),
    mass: key === 'b' ? 3 : 1,
    mix: 'pqr'.includes(key) ? { rock: 1 } : { rap: 1 },
    groups: {},
  }));
  const palette = [
    { id: 'rock', label: 'Rock', hue: 20 },
    { id: 'rap', label: 'Rap', hue: 200 },
  ];
  const atlas = buildAtlas(nodes, nb as never, new Set(keys), palette, {});

  it('names a genre once and its communities as provinces', () => {
    const rap = atlas.realms.filter((r) => r.name === 'Rap');
    expect(rap).toHaveLength(1);
    expect(rap[0].countries).toHaveLength(2);
    const subs = rap[0].countries.map((id) => atlas.countries[id].sub);
    expect(subs).toContain('B-Star');
    expect(subs.every((x) => x)).toBe(true);
    expect(new Set(subs).size).toBe(2);
    const rock = atlas.realms.find((r) => r.name === 'Rock')!;
    expect(atlas.countries[rock.countries[0]].sub).toBeNull();
    for (const c of atlas.countries) expect(atlas.realms[c.realm].countries).toContain(c.id);
  });
});
