import { describe, expect, it } from 'vitest';
import { approach, coverAmount, coverThumb, labelBudget, magnify, parallaxShift, separate } from './lens2d';

describe('parallaxShift', () => {
  it('moves near stars against the cursor, far stars with it, mid-depth not at all', () => {
    expect(parallaxShift(1, 1, 0, 7)).toEqual([-7, -0]);
    expect(parallaxShift(-1, 1, 0, 7)[0]).toBe(7);
    expect(parallaxShift(0, 1, 1, 7).map(Math.abs)).toEqual([0, 0]);
    // Clamped depth.
    expect(parallaxShift(10, 1, 0, 7)[0]).toBe(-17.5);
  });
});

describe('magnify', () => {
  it('pushes nearby points out, leaves far ones and the center alone', () => {
    const c = magnify(100, 100, 100, 100, 1);
    expect([c.x, c.y]).toEqual([100, 100]);
    expect(c.grow).toBeGreaterThan(1.3);
    const near = magnify(130, 100, 100, 100, 1);
    expect(near.x).toBeGreaterThan(130);
    const far = magnify(1000, 100, 100, 100, 1);
    expect(far.x).toBeCloseTo(1000, 6);
    expect(far.grow).toBeCloseTo(1, 6);
    expect(magnify(130, 100, 100, 100, 0)).toEqual({ x: 130, y: 100, grow: 1 });
  });
  it('is monotone: points never swap order along a ray', () => {
    let prev = -Infinity;
    for (let r = 0; r < 400; r += 2) {
      const x = magnify(r, 0, 0, 0, 1).x;
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });
});

describe('separate', () => {
  it('clears overlaps up to the cap and leaves loners still', () => {
    const pts = [
      { x: 0, y: 0, r: 10 },
      { x: 5, y: 0, r: 10 },
      { x: 500, y: 500, r: 10 },
    ];
    const off = separate(pts, 2, 6, 50);
    const ax = pts[0].x + off[0];
    const bx = pts[1].x + off[2];
    expect(bx - ax).toBeGreaterThan(21.5);
    expect(off[4]).toBe(0);
    expect(off[5]).toBe(0);
  });
  it('caps each shift', () => {
    const off = separate(
      [
        { x: 0, y: 0, r: 100 },
        { x: 1, y: 0, r: 100 },
      ],
      0,
      3,
      5,
    );
    expect(Math.hypot(off[0], off[1])).toBeLessThanOrEqual(5.0001);
  });
});

describe('approach / zoom helpers', () => {
  it('approach converges and is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 2; i++) a = approach(a, 1, 8, 100);
    const b = approach(0, 1, 16, 100);
    expect(a).toBeCloseTo(b, 9);
    expect(approach(0, 1, 5, 0)).toBe(1);
  });
  it('labels and covers grow with zoom', () => {
    expect(labelBudget(0.5, 300)).toBeLessThan(labelBudget(3, 300));
    expect(labelBudget(10, 30)).toBe(30);
    expect(coverAmount(1)).toBe(0);
    expect(coverAmount(10)).toBe(1);
  });
  it('asks cover hosts for thumbnails', () => {
    expect(coverThumb('https://is1-ssl.mzstatic.com/image/thumb/x/5055946702438.png/600x600bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/x/5055946702438.png/160x160bb.jpg',
    );
    expect(coverThumb('https://coverartarchive.org/release-group/83567f3b/front-500')).toBe('https://coverartarchive.org/release-group/83567f3b/front-250');
    expect(coverThumb('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });
});
