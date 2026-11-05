import { describe, expect, it } from 'vitest';
import { planeBasis, toPlane } from './plane';
import { simRadius } from './focus';
import {
  fitDistance,
  fromScene,
  hashDir,
  labelBudget,
  niceStep,
  orbitPosition,
  placeLabels,
  sceneFrame,
  slotBox,
  toScene,
  type LabelCandidate,
} from './scene3d';
import type { Vec3 } from './types';

const pts: Record<string, Vec3> = {
  a: [0.9, 0.1, -0.2],
  b: [-0.7, 0.3, 0.1],
  c: [0.1, -0.6, 0.4],
  d: [0.2, 0.5, -0.5],
  e: [-0.3, -0.2, 0.3],
};

describe('scene frame', () => {
  const basis = planeBasis(pts);
  const f = sceneFrame(basis, 10);

  it('maps the D5 plane to the floor: X = plane x, Y = depth, Z = −plane y', () => {
    for (const p of Object.values(pts)) {
      const out = [0, 0, 0];
      toScene(f, p, out);
      const q = toPlane(p, basis);
      expect(out[0]).toBeCloseTo(q[0] * 10, 9);
      expect(out[1]).toBeCloseTo(q[2] * 10, 9);
      expect(out[2]).toBeCloseTo(-q[1] * 10, 9);
    }
  });

  it('round-trips', () => {
    const out = new Float32Array(3);
    toScene(f, pts.c, out);
    const back = fromScene(f, out[0], out[1], out[2]);
    back.forEach((x, i) => expect(x).toBeCloseTo(pts.c[i], 5));
  });

  it('is a proper rotation (no mirror)', () => {
    const [x, y, z] = f.rows;
    const det =
      x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBeCloseTo(1, 9);
  });
});

describe('fitDistance', () => {
  it('frames every point inside the fill on both axes', () => {
    const P = new Float32Array([10, 0, 0, -10, 0, 0, 0, 2, 0, 0, 0, 4]);
    const back: [number, number, number] = [0, Math.sin(0.5), Math.cos(0.5)];
    const D = fitDistance(P, [0, 0, 0], back, [0, 1, 0], 50, 1.2, 0.8);
    const tanY = Math.tan((50 * Math.PI) / 360);
    // Point (10,0,0) is on screen x; its depth from the camera is D.
    expect(10 / D).toBeLessThanOrEqual(tanY * 1.2 * 0.8 + 1e-9);
    expect(D).toBeGreaterThan(0);
    // A narrower stage needs a farther camera.
    expect(fitDistance(P, [0, 0, 0], back, [0, 1, 0], 50, 0.5, 0.8)).toBeGreaterThan(D);
  });

  it('respects the mask', () => {
    const P = new Float32Array([1, 0, 0, 100, 0, 0]);
    const all = fitDistance(P, [0, 0, 0], [0, 0, 1], [0, 1, 0], 50, 1);
    const one = fitDistance(P, [0, 0, 0], [0, 0, 1], [0, 1, 0], 50, 1, 0.82, [1, 0]);
    expect(one).toBeLessThan(all / 50);
  });
});

describe('orbitPosition', () => {
  it('keeps the bearing and sets the radius from the true similarity', () => {
    const p = orbitPosition([1, 1, 1], [4, 1, 1], 0.4, 10, 0.1, [0, 1, 0]);
    expect(p[1]).toBeCloseTo(1);
    expect(p[2]).toBeCloseTo(1);
    expect(p[0] - 1).toBeCloseTo(simRadius(0.4) * 10, 9);
  });

  it('more similar = closer, and a star on the selection uses the fallback bearing', () => {
    const near = orbitPosition([0, 0, 0], [5, 0, 0], 0.8, 10, 0, [0, 1, 0]);
    const far = orbitPosition([0, 0, 0], [5, 0, 0], 0.1, 10, 0, [0, 1, 0]);
    expect(near[0]).toBeLessThan(far[0]);
    const on = orbitPosition([0, 0, 0], [0, 0, 0], 0.5, 10, 0, [0, 1, 0]);
    expect(on[0]).toBe(0);
    expect(on[1]).toBeGreaterThan(0);
  });

  it('hashDir is a deterministic unit vector', () => {
    const a = hashDir('a:123');
    expect(Math.hypot(...a)).toBeCloseTo(1, 9);
    expect(hashDir('a:123')).toEqual(a);
    expect(hashDir('a:124')).not.toEqual(a);
  });
});

describe('labels', () => {
  const cand = (i: number, x: number, y: number, prio: number, extra: Partial<LabelCandidate> = {}): LabelCandidate => ({
    i,
    prio,
    x,
    y,
    r: 4,
    w: 60,
    h: 14,
    force: false,
    optional: true,
    prev: -1,
    ...extra,
  });
  const stage = { w: 400, h: 300 };

  it('prefers the slot above and moves a colliding label to another slot', () => {
    const out = placeLabels([cand(0, 200, 150, 2), cand(1, 200, 150, 1)], [], stage, 10);
    expect(out.get(0)).toBe(0);
    expect(out.get(1)).toBe(1);
  });

  it('honours the budget for optional labels but always places forced ones', () => {
    const cs = [cand(0, 50, 50, 5), cand(1, 200, 50, 4), cand(2, 300, 200, 3, { force: true, optional: false })];
    const out = placeLabels(cs, [], stage, 1);
    expect(out.has(0)).toBe(true);
    expect(out.has(1)).toBe(false);
    expect(out.has(2)).toBe(true);
  });

  it('keeps labels out of reserved boxes and inside the stage', () => {
    const out = placeLabels([cand(0, 40, 34, 1)], [{ x: 0, y: 0, w: 120, h: 40 }], stage, 5);
    const s = out.get(0);
    expect(s).toBe(1);
    const b = slotBox(cand(0, 40, 34, 1), s!);
    expect(b.y).toBeGreaterThanOrEqual(40);
  });

  it('keeps the previous slot when it is still free (hysteresis)', () => {
    const out = placeLabels([cand(0, 200, 150, 1, { prev: 2 })], [], stage, 5);
    expect(out.get(0)).toBe(2);
  });

  it('avoids covering another star', () => {
    // A star right above the candidate blocks the "above" slot.
    const out = placeLabels([cand(0, 200, 150, 1)], [], stage, 5, [200, 150, 4, 200, 135, 5]);
    expect(out.get(0)).not.toBe(0);
  });

  it('budget grows with zoom and area', () => {
    expect(labelBudget(800 * 680, 1)).toBeGreaterThanOrEqual(10);
    expect(labelBudget(390 * 500, 1)).toBeLessThan(labelBudget(800 * 680, 1));
    expect(labelBudget(800 * 680, 2)).toBeGreaterThan(labelBudget(800 * 680, 1));
  });

  it('niceStep snaps to 1/2/5', () => {
    expect(niceStep(0.3)).toBeCloseTo(0.5);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(7)).toBe(10);
  });
});
