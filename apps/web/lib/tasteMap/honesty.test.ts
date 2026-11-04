import { describe, expect, it } from 'vitest';
import { neighborHonesty } from './honesty';
import { distortionRgb } from './color';
import type { Neighbor } from './types';

const nb = (...keys: string[]): Neighbor[] => keys.map((key, i) => ({ key, sim: 0.9 - 0.1 * i, why: [] }));

describe('neighborHonesty', () => {
  // Truth: a~b, c~d. The map keeps a/b together but puts c next to a, d far off.
  const neighbors = { a: nb('b'), b: nb('a'), c: nb('d'), d: nb('c') };
  const coords = new Map<string, number[]>([
    ['a', [0, 0]],
    ['b', [0.3, 0]],
    ['c', [0, 0.6]],
    ['d', [10, 10]],
  ]);
  const h = neighborHonesty(coords, neighbors, 1);

  it('scores kept and torn neighborhoods', () => {
    expect(h.byKey.get('a')).toMatchObject({ recall: 1, k: 1, torn: [], intruders: [] });
    expect(h.byKey.get('c')).toMatchObject({ recall: 0, torn: ['d'], intruders: ['a'] });
    // d is far from everything, but c is still the nearest thing to it.
    expect(h.byKey.get('d')!.recall).toBe(1);
    expect(h.mean).toBeCloseTo(0.75, 5);
  });

  it('ignores neighbors that are not on the map and nodes with none', () => {
    const only = neighborHonesty(new Map([['a', [0, 0]], ['c', [1, 1]]]), neighbors, 3);
    expect(only.byKey.size).toBe(0);
    expect(only.mean).toBe(1);
  });

  it('works in 3D and caps k at the neighbor list', () => {
    const h3 = neighborHonesty(
      new Map<string, number[]>([
        ['a', [0, 0, 0]],
        ['b', [0, 0, 1]],
        ['c', [5, 5, 5]],
      ]),
      { a: nb('b', 'c'), b: nb('a'), c: nb('a') },
      5,
    );
    expect(h3.byKey.get('a')).toMatchObject({ recall: 1, k: 2 });
    expect(h3.byKey.get('c')).toMatchObject({ recall: 0, k: 1, torn: ['a'], intruders: ['b'] });
  });
});

describe('distortionRgb', () => {
  it('runs teal (kept) → ember (torn) through a grayer middle', () => {
    const kept = distortionRgb(1, 0.72);
    const torn = distortionRgb(0, 0.72);
    const mid = distortionRgb(0.5, 0.72);
    expect(kept[2]).toBeGreaterThan(kept[0]);
    expect(torn[0]).toBeGreaterThan(torn[2]);
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(mid)).toBeLessThan(Math.min(spread(kept), spread(torn)));
  });
});
