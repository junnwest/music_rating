import { describe, expect, it } from 'vitest';
import { createRearrange, type RearrangeNode } from './forceLayout';
import { fromPlane, planeBasis, projectPlane, toPlane } from './plane';
import type { Vec3 } from './types';

/** Seeded points on a tilted, noisy slab, so the D5 plane is far from axis-aligned. */
function tiltedCloud(n: number, seed = 7): Record<string, Vec3> {
  let a = seed;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296 - 0.5;
  };
  const out: Record<string, Vec3> = {};
  for (let i = 0; i < n; i++) {
    const x = rnd() * 2;
    const y = rnd() * 1.2;
    const z = rnd() * 0.25;
    // Rotate the slab ~35° about (1, 1, 0) and shift it.
    out[`a:${String(i).padStart(3, '0')}`] = [0.3 + 0.82 * x + 0.18 * y + 0.4 * z, -0.2 + 0.18 * x + 0.82 * y - 0.4 * z, 0.1 - 0.4 * x + 0.4 * y + 0.65 * z];
  }
  return out;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('planeBasis', () => {
  const pos = tiltedCloud(40);
  const b = planeBasis(pos);

  it('is orthonormal and right-handed', () => {
    for (const [p, q, want] of [
      [b.u, b.u, 1],
      [b.v, b.v, 1],
      [b.n, b.n, 1],
      [b.u, b.v, 0],
      [b.u, b.n, 0],
      [b.v, b.n, 0],
    ] as [Vec3, Vec3, number][]) {
      expect(dot(p, q)).toBeCloseTo(want, 10);
    }
    const cross: Vec3 = [b.u[1] * b.v[2] - b.u[2] * b.v[1], b.u[2] * b.v[0] - b.u[0] * b.v[2], b.u[0] * b.v[1] - b.u[1] * b.v[0]];
    expect(dot(cross, b.n)).toBeCloseTo(1, 10);
  });

  it('reproduces projectPlane, and toPlane/fromPlane round-trip', () => {
    const plane = projectPlane(pos);
    for (const [k, p] of Object.entries(pos)) {
      const q = toPlane(p, b);
      expect(q[0]).toBeCloseTo(plane[k][0], 12);
      expect(q[1]).toBeCloseTo(plane[k][1], 12);
      const back = fromPlane(q, b);
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(p[i], 12);
    }
  });

  it('ignores key insertion order', () => {
    const rev = Object.fromEntries(Object.entries(pos).reverse());
    expect(planeBasis(rev)).toEqual(b);
  });

  it('handles an empty layout', () => {
    expect(planeBasis({})).toEqual({ mu: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] });
  });
});

describe('createRearrange partial pins (D5)', () => {
  const pos = tiltedCloud(40);
  const b = planeBasis(pos);
  const keys = Object.keys(pos).sort();
  const links = keys.flatMap((k, i) => [1, 2, 5].map((d) => ({ a: k, b: keys[(i + d) % keys.length], sim: 0.4 + 0.1 * d })));
  const groups = keys.map((k, i) => ({ key: k, weights: { [`g${i % 3}`]: 0.7 } }));
  const mk = (pinned: (i: number) => RearrangeNode['pinned']): RearrangeNode[] =>
    keys.map((k, i) => ({ key: k, pos: pos[k], pinned: pinned(i), size: 0.03 }));

  it("an 'xy' pin keeps its plane coords exactly and lets its depth move", () => {
    const nodes = mk((i) => (i === 0 ? 'xy' : i === 1 ? true : false));
    // Push node 0's depth off its anchor so the forces have something to resolve.
    const start = toPlane(pos[keys[0]], b);
    nodes[0] = { ...nodes[0], pos: fromPlane([start[0], start[1], start[2] + 0.6], b) };
    const sim = createRearrange(nodes, links, groups, { seed: 1, basis: b, anchorStrength: 0.05 });
    sim.tick(200);
    const p = sim.positions();
    const q0 = toPlane(p[keys[0]], b);
    expect(q0[0]).toBeCloseTo(start[0], 9);
    expect(q0[1]).toBeCloseTo(start[1], 9);
    // Depth relaxed back toward the slab (links + groups + its own anchor at the pushed depth).
    expect(Math.abs(q0[2] - (start[2] + 0.6))).toBeGreaterThan(1e-3);
    // Full pin: every component fixed.
    for (let i = 0; i < 3; i++) expect(p[keys[1]][i]).toBeCloseTo(pos[keys[1]][i], 9);
    expect(sim.pinMode(keys[0])).toBe('xy');
    expect(sim.isPinned(keys[0])).toBe(true);
    for (const v of Object.values(p)) expect(v.every(Number.isFinite)).toBe(true);
  });

  it("without a basis an 'xy' pin would drift in the tilted plane (why the rotation matters)", () => {
    const nodes = mk((i) => (i === 0 ? 'xy' : false));
    const start = toPlane(pos[keys[0]], b);
    nodes[0] = { ...nodes[0], pos: fromPlane([start[0], start[1], start[2] + 0.6], b) };
    const p = createRearrange(nodes, links, groups, { seed: 1, anchorStrength: 0.05 }).tick(200).positions();
    const q0 = toPlane(p[keys[0]], b);
    expect(Math.hypot(q0[0] - start[0], q0[1] - start[1])).toBeGreaterThan(1e-3);
  });

  it("pin(key, pos, 'xy') fixes the plane coords of a moved node", () => {
    const sim = createRearrange(mk(() => false), links, groups, { seed: 2, basis: b });
    const target = fromPlane([0.5, -0.3, 0.2], b);
    sim.pin(keys[3], target, 'xy');
    sim.tick(150);
    const q = toPlane(sim.positions()[keys[3]], b);
    expect(q[0]).toBeCloseTo(0.5, 9);
    expect(q[1]).toBeCloseTo(-0.3, 9);
    sim.unpin(keys[3]);
    expect(sim.pinMode(keys[3])).toBe(false);
  });

  it('a basis is only a change of frame: unpinned results match the world-frame run', () => {
    const nodes = mk((i) => i % 7 === 0);
    const a = createRearrange(nodes, links, groups, { seed: 4 }).tick(80).positions();
    const c = createRearrange(nodes, links, groups, { seed: 4, basis: b }).tick(80).positions();
    for (const k of keys) for (let i = 0; i < 3; i++) expect(c[k][i]).toBeCloseTo(a[k][i], 6);
  });

  it("2d mode treats 'xy' like a full pin and ignores the basis", () => {
    const plane = projectPlane(pos);
    const nodes = keys.map((k, i) => ({ key: k, pos: [plane[k][0], plane[k][1], 0.1] as Vec3, pinned: i === 0 ? ('xy' as const) : false, size: 0.05 }));
    const p = createRearrange(nodes, [], [], { mode: '2d', seed: 3, basis: b }).tick(100).positions();
    expect(p[keys[0]]).toEqual(nodes[0].pos);
  });
});
