import { describe, expect, it } from 'vitest';
import { dragImpact } from './dragImpact';
import type { HerePoint } from './focus';

// Two clusters: rock on the left (x ≈ 0), jazz on the right (x ≈ 10).
const points: HerePoint[] = [
  { key: 'r1', x: 0, y: 0, mass: 4, mix: { rock: 1 } },
  { key: 'r2', x: 0.5, y: 0.2, mass: 4, mix: { rock: 1 } },
  { key: 'r3', x: -0.4, y: 0.5, mass: 4, mix: { rock: 0.8, pop: 0.2 } },
  { key: 'j1', x: 10, y: 0, mass: 4, mix: { jazz: 1 } },
  { key: 'j2', x: 10.5, y: 0.3, mass: 4, mix: { jazz: 1 } },
  { key: 'j3', x: 9.6, y: -0.4, mass: 4, mix: { jazz: 0.9, pop: 0.1 } },
  { key: 'me', x: 0.2, y: -0.3, mass: 2, mix: { rock: 1 } },
];
const sims: Record<string, number> = { r1: 0.9, r2: 0.85, r3: 0.8, j1: 0.1, j2: 0.12, j3: 0.15 };
const base = {
  key: 'me',
  start: [0.2, -0.3] as [number, number],
  points,
  trueNeighbors: ['r1', 'r2', 'r3', 'j3', 'j2'],
  simTo: (o: string) => sims[o] ?? null,
  span: 10,
  bandwidth: 1,
  k: 3,
};

describe('dragImpact', () => {
  it('no move: nothing changes, full fit', () => {
    const d = dragImpact({ ...base, now: base.start });
    expect(d.moved).toBe(0);
    expect(d.sound).toEqual([]);
    expect(d.joined).toEqual([]);
    expect(d.left).toEqual([]);
    expect(d.keptBefore).toBe(3);
    expect(d.keptAfter).toBe(3);
    expect(d.nearAfter).not.toContain('me');
  });

  it('moving into the jazz cluster: jazz up, rock down, neighbors swap, fit drops', () => {
    const d = dragImpact({ ...base, now: [10.1, 0] });
    expect(d.movedPct).toBeCloseTo(Math.hypot(9.9, 0.3) / 10, 5);
    expect(d.sound[0].id === 'jazz' || d.sound[0].id === 'rock').toBe(true);
    const jazz = d.sound.find((s) => s.id === 'jazz')!;
    const rock = d.sound.find((s) => s.id === 'rock')!;
    expect(jazz.delta).toBeGreaterThan(0.5);
    expect(rock.delta).toBeLessThan(-0.5);
    expect(new Set(d.joined)).toEqual(new Set(['j1', 'j2', 'j3']));
    expect(new Set(d.left)).toEqual(new Set(['r1', 'r2', 'r3']));
    expect(d.keptAfter).toBe(0);
    expect(d.simAfter!).toBeLessThan(d.simBefore!);
  });

  it('ignores true neighbors that are not on the map', () => {
    const d = dragImpact({ ...base, trueNeighbors: ['gone', 'r1'], now: base.start });
    expect(d.k).toBe(1);
    expect(d.keptBefore).toBe(1);
  });
});
