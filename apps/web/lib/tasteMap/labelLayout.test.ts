import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  createGroupLayoutScratch,
  DEFAULT_GROUP_LAYOUT,
  ensureBoxes,
  hitsAny,
  labelBoard,
  layoutGroupLabels,
} from '../../components/sj/tasteMap/labelLayout';

interface L {
  x: number;
  y: number;
  w: number;
  h: number;
  active?: boolean;
}

function run(
  labels: L[],
  opts?: { prev?: number[]; obstacles?: number[]; viewW?: number; order?: number[]; layout?: Partial<typeof DEFAULT_GROUP_LAYOUT> },
) {
  const n = labels.length;
  const f = (k: keyof L) => Float32Array.from(labels.map((l) => Number(l[k] ?? 0)));
  const active = Uint8Array.from(labels.map((l) => (l.active === false ? 0 : 1)));
  const prev = Float32Array.from(opts?.prev ?? labels.map(() => Number.NaN));
  const order = Int32Array.from(opts?.order ?? labels.map((_, i) => i));
  const obstacles = Float32Array.from(opts?.obstacles ?? []);
  const out = new Float32Array(n);
  const outX = new Float32Array(n);
  const scratch = createGroupLayoutScratch(n, obstacles.length / 4);
  layoutGroupLabels(
    f('x'),
    f('y'),
    f('w'),
    f('h'),
    active,
    prev,
    order,
    obstacles,
    obstacles.length / 4,
    opts?.viewW ?? 10000,
    out,
    outX,
    scratch,
    { ...DEFAULT_GROUP_LAYOUT, ...opts?.layout },
  );
  const boxes = labels.map((l, i) =>
    Number.isFinite(out[i]) ? [l.x + outX[i] - l.w / 2, l.y + out[i] - l.h, l.w, l.h] : null,
  );
  return { out: Array.from(out), outX: Array.from(outX), boxes };
}

function noOverlaps(boxes: (number[] | null)[], gap = 0) {
  const b = boxes.filter((x): x is number[] => !!x);
  for (let i = 0; i < b.length; i += 1)
    for (let j = i + 1; j < b.length; j += 1)
      expect(boxesOverlap(b[i][0], b[i][1], b[i][2], b[i][3], b[j][0], b[j][1], b[j][2], b[j][3], gap - 0.02)).toBe(false);
}

describe('boxesOverlap / hitsAny', () => {
  it('detects overlap and respects padding', () => {
    expect(boxesOverlap(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
    expect(boxesOverlap(0, 0, 10, 10, 10, 0, 10, 10)).toBe(false);
    expect(boxesOverlap(0, 0, 10, 10, 12, 0, 10, 10, 3)).toBe(true);
    expect(hitsAny([0, 0, 10, 10, 50, 50, 10, 10], 2, 52, 52, 2, 2)).toBe(true);
    expect(hitsAny([0, 0, 10, 10, 50, 50, 10, 10], 1, 52, 52, 2, 2)).toBe(false);
  });
});

describe('layoutGroupLabels', () => {
  it('leaves non-colliding labels at home', () => {
    const r = run([
      { x: 100, y: 100, w: 80, h: 20 },
      { x: 300, y: 100, w: 80, h: 20 },
    ]);
    expect(r.out).toEqual([0, 0]);
  });

  it('stacks a pile of labels upward without overlap, highest priority stays home', () => {
    const labels = Array.from({ length: 6 }, (_, i) => ({ x: 200 + i * 7, y: 300 + i * 3, w: 120, h: 24 }));
    const r = run(labels);
    expect(r.out[0]).toBe(0);
    expect(r.out.every((s) => Number.isFinite(s))).toBe(true);
    expect(r.out.slice(1).every((s) => s <= DEFAULT_GROUP_LAYOUT.maxDown)).toBe(true);
    noOverlaps(r.boxes, DEFAULT_GROUP_LAYOUT.gap);
  });

  it('drops the lowest-priority labels when there is no room within maxUp', () => {
    const labels = Array.from({ length: 20 }, () => ({ x: 200, y: 400, w: 120, h: 30 }));
    const r = run(labels);
    const placed = r.out.filter((s) => Number.isFinite(s)).length;
    expect(placed).toBeGreaterThan(3);
    expect(placed).toBeLessThan(20);
    expect(Number.isFinite(r.out[0])).toBe(true);
    expect(Number.isFinite(r.out[19])).toBe(false);
    noOverlaps(r.boxes, DEFAULT_GROUP_LAYOUT.gap);
  });

  it('respects the priority order', () => {
    const labels = [
      { x: 200, y: 300, w: 100, h: 20 },
      { x: 200, y: 300, w: 100, h: 20 },
    ];
    expect(run(labels, { order: [1, 0] }).out[1]).toBe(0);
    expect(run(labels, { order: [1, 0] }).out[0]).toBeLessThan(0);
  });

  it('skips inactive labels', () => {
    const r = run([
      { x: 200, y: 300, w: 100, h: 20, active: false },
      { x: 200, y: 300, w: 100, h: 20 },
    ]);
    expect(Number.isNaN(r.out[0])).toBe(true);
    expect(r.out[1]).toBe(0);
  });

  it('steers around fixed obstacles (pinned node labels)', () => {
    const r = run([{ x: 200, y: 300, w: 100, h: 20 }], { obstacles: [160, 270, 80, 40] });
    noOverlaps([...r.boxes, [160, 270, 80, 40]], DEFAULT_GROUP_LAYOUT.gap);
    expect(r.out[0]).toBeLessThan(0);
  });

  it('is sticky: between equally good slots it keeps the previous one', () => {
    const labels = [
      { x: 200, y: 300, w: 100, h: 20 },
      { x: 200, y: 300, w: 100, h: 20 },
    ];
    const layout = { downCost: 1, maxDown: 100 };
    const up = run(labels, { prev: [0, -23], layout }).out[1];
    const down = run(labels, { prev: [0, 23], layout }).out[1];
    expect(up).toBeLessThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it('returns home once home is free again', () => {
    expect(run([{ x: 200, y: 300, w: 100, h: 20 }], { prev: [-30] }).out[0]).toBe(0);
  });

  it('settles: feeding the result back as prev is a fixed point (no orbit jitter)', () => {
    const labels = Array.from({ length: 5 }, (_, i) => ({ x: 200 + i * 15, y: 300 - i * 4, w: 110, h: 22 }));
    const a = run(labels);
    const b = run(labels, { prev: a.out });
    expect(b.out).toEqual(a.out);
    // A small camera move keeps every slot within a few px.
    const moved = labels.map((l) => ({ ...l, x: l.x + 2, y: l.y + 1 }));
    const c = run(moved, { prev: a.out });
    c.out.forEach((s, i) => expect(Math.abs(s - a.out[i])).toBeLessThanOrEqual(2));
  });

  it('keeps labels inside the viewport horizontally', () => {
    const r = run([{ x: 790, y: 300, w: 100, h: 20 }], { viewW: 800 });
    const [x, , w] = r.boxes[0]!;
    expect(x + w).toBeLessThanOrEqual(800 - DEFAULT_GROUP_LAYOUT.margin + 1e-3);
    expect(r.outX[0]).toBeLessThan(0);
  });
});

describe('labelBoard / ensureBoxes', () => {
  it('returns one board per key', () => {
    const k1 = {};
    const k2 = {};
    expect(labelBoard(k1)).toBe(labelBoard(k1));
    expect(labelBoard(k1)).not.toBe(labelBoard(k2));
  });
  it('grows box storage and keeps contents', () => {
    const a = Float32Array.from([1, 2, 3, 4]);
    const b = ensureBoxes(a, 3);
    expect(b.length).toBeGreaterThanOrEqual(12);
    expect(Array.from(b.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(ensureBoxes(b, 2)).toBe(b);
  });
});
