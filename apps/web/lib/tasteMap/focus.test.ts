import { describe, expect, it } from 'vitest';
import { egoLayout, principal, relaxAlong, relaxBearings, RINGS, simRadius, whatsHere, type EgoNode, type HerePoint } from './focus';

const node = (key: string, x: number, y: number, z = 0, mix?: Record<string, number>): EgoNode => ({ key, x, y, z, mass: 1, mix });

describe('simRadius', () => {
  it('is 0 at sim 1, 1 at sim 0, and monotone decreasing', () => {
    expect(simRadius(1)).toBeCloseTo(0, 9);
    expect(simRadius(0)).toBeCloseTo(1, 9);
    let prev = Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const r = simRadius(s);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('spreads the low similarities this map actually has', () => {
    // Linear 1 − s would put 0.1…0.4 in the outer 40%; the log scale gives them the middle.
    expect(simRadius(0.4)).toBeLessThan(0.3);
    expect(simRadius(0.1)).toBeGreaterThan(0.5);
    expect(simRadius(0.1)).toBeLessThan(0.65);
  });
});

describe('egoLayout', () => {
  const nodes = [node('s', 1, 1, 0), node('a', 2, 1, 1), node('b', 1, 3, -1), node('c', 0, 1, 2), node('d', 1, 0.5, 0)];
  const sim = new Map([
    ['a', 0.8],
    ['b', 0.4],
    ['c', 0.1],
    ['d', 0],
  ]);

  it('distance: keeps the selection put, radius from similarity, bearing from the view', () => {
    const L = egoLayout({ nodes, selected: 's', sim, mode: 'distance', R: 2, minSep: 0.01 });
    expect(L.pos.get('s')).toEqual([1, 1]);
    for (const k of ['a', 'b', 'c', 'd']) {
      const [x, y] = L.pos.get(k)!;
      expect(Math.hypot(x - 1, y - 1)).toBeCloseTo(Math.max(0.011, simRadius(sim.get(k)!) * 2), 6);
    }
    // Bearings: a was east, b north, c west, d south.
    const bearing = (k: string) => {
      const [x, y] = L.pos.get(k)!;
      return Math.atan2(y - 1, x - 1);
    };
    expect(bearing('a')).toBeCloseTo(0, 6);
    expect(bearing('b')).toBeCloseTo(Math.PI / 2, 6);
    expect(Math.abs(bearing('c'))).toBeCloseTo(Math.PI, 6);
    expect(bearing('d')).toBeCloseTo(-Math.PI / 2, 6);
    expect(L.rings.map((r) => r.sim)).toEqual([...RINGS]);
    // Nearest first in the stagger.
    expect(L.order.get('a')).toBe(0);
    expect(L.order.get('d')).toBe(1);
  });

  it('distance: collisions slide along the ring, radius stays exact', () => {
    const crowd = [node('s', 0, 0), ...Array.from({ length: 8 }, (_, i) => node(`n${i}`, 1, 0.001 * i))];
    const s2 = new Map(crowd.slice(1).map((n) => [n.key, 0.3]));
    const L = egoLayout({ nodes: crowd, selected: 's', sim: s2, mode: 'distance', R: 1, minSep: 0.1 });
    const r = simRadius(0.3);
    const pts = crowd.slice(1).map((n) => L.pos.get(n.key)!);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(r, 6);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])).toBeGreaterThan(0.095);
  });

  it('vector: x follows similarity, y the strongest other sound direction, labelled by tag', () => {
    const palette = [
      { id: 'rock', label: 'Rock', hue: 0 },
      { id: 'pop', label: 'Pop', hue: 120 },
      { id: 'jazz', label: 'Jazz', hue: 240 },
    ];
    const ns = [
      node('s', 0, 0, 0, { rock: 1 }),
      node('a', 1, 0, 0, { rock: 0.5, pop: 0.5 }),
      node('b', 1, 1, 0, { rock: 0.5, jazz: 0.5 }),
      node('c', 2, 0, 0, { pop: 1 }),
      node('d', 2, 1, 0, { jazz: 1 }),
    ];
    const s3 = new Map([
      ['a', 0.6],
      ['b', 0.6],
      ['c', 0.1],
      ['d', 0.1],
    ]);
    const L = egoLayout({ nodes: ns, selected: 's', sim: s3, mode: 'vector', R: 1, minSep: 0.001, palette });
    const x = (k: string) => L.pos.get(k)![0];
    const y = (k: string) => L.pos.get(k)![1];
    expect(x('s')).toBe(0);
    expect(x('a')).toBeLessThan(0);
    expect(x('c')).toBeLessThan(x('a'));
    // Pop vs Jazz is the contrast left once Rock (the selection) is removed.
    expect(new Set([L.axis?.pos, L.axis?.neg])).toEqual(new Set(['Pop', 'Jazz']));
    const up = L.axis!.pos === 'Pop' ? 'c' : 'd';
    const down = up === 'c' ? 'd' : 'c';
    expect(y(up)).toBeGreaterThan(0);
    expect(y(down)).toBeLessThan(0);
  });

  it('vector: falls back to similarity rows without a palette, labelled by artist', () => {
    const ns = [node('s', 0, 0), node('a', 1, 0), node('b', 1, 1), node('c', 2, 0)];
    const all: Record<string, number> = { 'a|b': 0.9, 'a|c': 0.05, 'b|c': 0.1 };
    const simOf = (p: string, q: string) => all[[p, q].sort().join('|')] ?? null;
    const L = egoLayout({
      nodes: ns,
      selected: 's',
      sim: new Map([['a', 0.5], ['b', 0.5], ['c', 0.5]]),
      simOf,
      mode: 'vector',
      R: 1,
      minSep: 0.001,
      labelOf: (k) => k.toUpperCase(),
    });
    expect(L.axis).not.toBeNull();
    // a and b are alike, c is the odd one: c ends up at one end, a/b at the other.
    const y = (k: string) => L.pos.get(k)![1];
    expect(Math.sign(y('a'))).toBe(Math.sign(y('b')));
    expect(Math.sign(y('c'))).toBe(-Math.sign(y('a')));
  });

  it('depth: front goes up, behind goes down, x keeps the in-plane offset', () => {
    const L = egoLayout({ nodes, selected: 's', sim, mode: 'depth', R: 2, minSep: 0.001 });
    const [ax, ay] = L.pos.get('a')!;
    const [, by] = L.pos.get('b')!;
    const [cx, cy] = L.pos.get('c')!;
    expect(ay).toBeGreaterThan(1);
    expect(by).toBeLessThan(1);
    expect(cy).toBeGreaterThan(ay);
    expect(ax).toBeGreaterThan(1);
    expect(cx).toBeLessThan(1);
    expect(L.zUnit).toBeGreaterThan(0);
  });
});

describe('relax helpers', () => {
  it('relaxAlong only moves the free axis', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
      { x: 0.02, y: 0.01 },
    ];
    relaxAlong(pts, 0.1, 'y');
    expect(pts.map((p) => p.x)).toEqual([0, 0.01, 0.02]);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.099);
  });

  it('relaxBearings leaves separated stars alone', () => {
    const pts = [
      { r: 1, th: 0 },
      { r: 1, th: Math.PI },
    ];
    relaxBearings(pts, 0.1);
    expect(pts).toEqual([
      { r: 1, th: 0 },
      { r: 1, th: Math.PI },
    ]);
  });

  it('principal finds the spread axis', () => {
    const pc = principal(
      [
        [0, 0],
        [1, 0.01],
        [2, 0],
        [3, -0.01],
      ],
      [1, 1, 1, 1],
    )!;
    expect(Math.abs(pc.dir[0])).toBeGreaterThan(0.99);
  });
});

describe('whatsHere', () => {
  const pts: HerePoint[] = [
    { key: 'a', x: 0, y: 0, mass: 1, mix: { rock: 1 } },
    { key: 'b', x: 1, y: 0, mass: 1, mix: { pop: 1 } },
    { key: 'c', x: 10, y: 0, mass: 1, mix: { jazz: 1 } },
  ];
  it('mixes nearby stars by kernel weight and lists the nearest', () => {
    const h = whatsHere(pts, [0.25, 0], 0.5);
    expect(h.mix[0].id).toBe('rock');
    expect(h.mix[1].id).toBe('pop');
    expect(h.mix.find((m) => m.id === 'jazz')).toBeUndefined();
    expect(h.mix[0].share + h.mix[1].share).toBeCloseTo(1, 6);
    expect(h.nearest.map((n) => n.key)).toEqual(['a', 'b', 'c']);
    expect(h.density).toBeGreaterThan(0);
  });
  it('is empty sky far away', () => {
    const h = whatsHere(pts, [100, 100], 0.5);
    expect(h.mix).toEqual([]);
    expect(h.density).toBe(0);
  });
});
