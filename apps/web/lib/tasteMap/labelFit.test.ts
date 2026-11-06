import { describe, expect, it } from 'vitest';
import { fitName, labelRoom } from './labelFit';

// Monospace stand-in: each char is 0.6 wide at size 1, plus tracking.
const width = (line: string, t: number) => line.length * (0.6 + t);

describe('labelRoom', () => {
  it('measures to the nearer border along and across the axis', () => {
    // A 10 × 4 rectangle centered at the origin, point 1 right of center.
    const edge: [number, number][] = [];
    for (let i = -50; i <= 50; i++) edge.push([i / 10, 2], [i / 10, -2]);
    for (let i = -20; i <= 20; i++) edge.push([5, i / 10], [-5, i / 10]);
    const r = labelRoom(edge, 1, 0, 0, 0.15);
    expect(r.len).toBeCloseTo(8, 5);
    expect(r.thick).toBeCloseTo(4, 5);
  });
});

describe('fitName', () => {
  it('keeps the cap and wide tracking when there is room', () => {
    const f = fitName('ROCK', 1000, 100, 24, 10, width);
    expect(f).toEqual({ lines: ['ROCK'], size: 24, spacing: 0.32 * 24 });
  });

  it('tightens tracking before shrinking', () => {
    // At 0.32 tracking 'ROCK' is 3.68 wide per px of size; at 24px → 88; give 80.
    const f = fitName('ROCK', 80, 100, 24, 10, width);
    expect(f.spacing / f.size).toBeLessThan(0.32);
    expect(f.lines).toEqual(['ROCK']);
  });

  it('breaks a long name into two balanced lines in a tall, narrow territory', () => {
    const f = fitName('KOREAN HIP-HOP', 120, 80, 24, 9, width);
    expect(f.lines).toEqual(['KOREAN', 'HIP-HOP']);
  });

  it('never goes under the floor', () => {
    const f = fitName('ALTERNATIVE R&B', 5, 5, 24, 10, width);
    expect(f.size).toBe(10);
  });
});
