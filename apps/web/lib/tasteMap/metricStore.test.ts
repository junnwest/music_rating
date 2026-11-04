import { describe, expect, it } from 'vitest';
import { buildFeatureSpace, DEFAULT_BLOCK_WEIGHTS, DEFAULT_METRIC, explain } from './features';
import { solveLayout } from './layout';
import { leaveOnePinOut } from './metric';
import {
  decideMetric,
  decisionToResponse,
  decisionToRow,
  MIN_EVAL_PINS,
  metricFromRow,
  metricSummary,
  metricToRow,
  responseFromRow,
} from './metricStore';
import { mergedInput } from './phase4Fixtures';
import type { MetricWeights, NodeKey, Vec3 } from './types';

const input = mergedInput();
const space = buildFeatureSpace(input);
const layout = solveLayout(space, { weights: DEFAULT_METRIC, explain: (a, b) => explain(a, b, space, DEFAULT_METRIC) });

describe('metricFromRow / metricToRow', () => {
  it('no row → the default metric', () => {
    expect(metricFromRow(null, space)).toEqual(DEFAULT_METRIC);
    expect(metricFromRow({ block_w: {}, dim_w: null }, space)).toEqual(DEFAULT_METRIC);
  });

  it('round-trips via tag-dim ids, not indices', () => {
    const w: MetricWeights = {
      block: { tags: 1.5, text: 0.8, graph: 2, era: 0.25 },
      tagDims: space.tagDims.map((_, i) => 0.5 + (i % 7) / 10),
    };
    const row = metricToRow(w, space);
    expect(Object.keys(row.dim_w!)).toEqual(space.tagDims.map((d) => d.id));
    const back = metricFromRow(row, space);
    expect(back.block).toEqual(w.block);
    back.tagDims!.forEach((v, i) => expect(v).toBeCloseTo(w.tagDims![i], 6));

    // A rebuilt space with the tag dims in another order still gets each genre its own weight.
    const shuffled = { ...space, tagDims: [...space.tagDims].reverse() };
    const again = metricFromRow(row, shuffled);
    shuffled.tagDims.forEach((d, j) => expect(again.tagDims![j]).toBeCloseTo(row.dim_w![d.id], 6));
  });

  it('unknown ids are ignored, missing ids are 1, index arrays and bad values are not trusted', () => {
    const id0 = space.tagDims[0].id;
    const w = metricFromRow({ block_w: { tags: -1, graph: 'x', text: 3 }, dim_w: { [id0]: 2, 'no-such-tag': 9 } }, space);
    expect(w.block).toEqual({ ...DEFAULT_BLOCK_WEIGHTS, text: 3 });
    expect(w.tagDims![0]).toBe(2);
    expect(w.tagDims!.slice(1).every((v) => v === 1)).toBe(true);
    expect(metricFromRow({ block_w: {}, dim_w: [2, 2, 2] }, space).tagDims).toBeNull();
  });
});

describe('decideMetric on the real fixtures', () => {
  const keys = space.nodes.map((n) => n.key).sort();

  it('keeps the default weights (era 0.5, not w = 1) with fewer than MIN_EVAL_PINS pins', () => {
    const d = decideMetric({ space, positions: layout.positions, pinnedKeys: keys.slice(0, MIN_EVAL_PINS - 1), groups: [] });
    expect(d.kept).toBe('unit');
    expect(d.weights).toEqual({ block: { ...DEFAULT_BLOCK_WEIGHTS }, tagDims: null });
    expect(d.weights.block.era).toBe(0.5);
    expect(d.reason).toMatch(/at least 3 needed/);
    const row = decisionToRow(d, space, '2026-11-03T00:00:00.000Z');
    expect(row.block_w).toEqual(DEFAULT_BLOCK_WEIGHTS);
    expect(row.dim_w).toBeNull();
  });

  it('keeps learned weights exactly when they beat the default on leave-one-pin-out', () => {
    // A user-corrected map: drag every other node toward the origin.
    const positions: Record<NodeKey, Vec3> = { ...layout.positions };
    const pinned = keys.filter((_, i) => i % 3 === 0);
    for (const k of pinned) positions[k] = positions[k].map((c) => c * 0.4) as Vec3;
    const d = decideMetric({ space, positions, pinnedKeys: pinned, groups: [] });
    expect(d.nTriplets).toBeGreaterThan(0);
    expect(d.eval.n).toBe(pinned.length);
    const wins = d.eval.errLearned < d.eval.errBaseline;
    expect(d.kept).toBe(wins ? 'learned' : 'unit');
    expect(d.weights).toEqual(wins ? d.learned : { block: { ...DEFAULT_BLOCK_WEIGHTS }, tagDims: null });
    expect(d.reason).toMatch(wins ? /closer than the default weights/ : /didn’t beat the default weights \(\d+\.\d{2,3} vs \d+\.\d{2,3} map units\)/);
    // The baseline is the default metric, not unit weights.
    const ev = leaveOnePinOut(space, positions, pinned, d.learned, { baseline: DEFAULT_METRIC });
    expect(d.eval).toEqual(ev);
  });

  it('response and stored eval agree; GET rebuilds the same response from the row', () => {
    const pinned = keys.slice(0, 6);
    const d = decideMetric({ space, positions: layout.positions, pinnedKeys: pinned, groups: [] });
    const at = '2026-11-03T12:00:00.000Z';
    const res = decisionToResponse(d, space, at);
    const row = decisionToRow(d, space, at);
    expect(responseFromRow(row)).toEqual(res);
    expect(res.learned).toEqual(metricSummary(d.learned, space));
  });

  it('a row without eval (imported) still reads', () => {
    const r = responseFromRow({ block_w: { tags: 2 }, dim_w: { rock: 1.5 }, n_triplets: 0, fitted_at: 'x' });
    expect(r.kept).toBe('learned');
    expect(r.learned.block.tags).toBe(2);
    expect(r.learned.topTags[0]).toEqual({ id: 'rock', label: 'rock', w: 1.5 });
    expect(responseFromRow({ block_w: {}, dim_w: null }).kept).toBe('unit');
  });
});
