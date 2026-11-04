/**
 * The personal metric's storage format and fit decision (TASTE_MAP_PLAN.md D6).
 *
 * Storage (taste_map_metric): `block_w` = { tags, text, graph, era }, `dim_w` =
 * tag weights keyed by TAG-DIM ID ({ "<qualified taxonomy id>": w }), null =
 * unit. MetricWeights.tagDims is index-aligned with FeatureSpace.tagDims, and
 * tagDims are rebuilt (and re-ordered) on every buildFeatureSpace, so a stored
 * index array would silently attach weights to the wrong genres after any new
 * rating. Always convert through metricFromRow / metricToRow with the CURRENT
 * space:
 *
 *   const space = buildFeatureSpace(input, overrides);
 *   const weights = metricFromRow(metricRow, space);   // id-keyed → index-aligned
 *
 * "Baseline" / "unit" here means DEFAULT_METRIC (features.ts: era 0.5, no tag
 * weights), the metric the map uses when nothing is learned — not literal w = 1.
 *
 * Pure: no DB.
 */
import type { MetricFitResponse, MetricSummary } from './apiTypes';
import { DEFAULT_BLOCK_WEIGHTS, DEFAULT_METRIC } from './features';
import { fitMetric, leaveOnePinOut, sampleTriplets, type GroupMembership } from './metric';
import { BLOCKS, type BlockName, type FeatureSpace, type MetricWeights, type NodeKey, type Vec3 } from './types';

/**
 * Fewest pinned nodes the leave-one-pin-out eval needs before learned weights
 * may replace the default. With 1–2 pins the "mean error" is one or two kNN
 * guesses, which a random reweighting beats about half the time.
 */
export const MIN_EVAL_PINS = 3;
/** Fixed seed so a re-fit on unchanged input stores the same weights. */
export const FIT_SEED = 7;
/** Tags shown in the "Your map weights" panel, each side. */
export const SUMMARY_TAGS = 5;

export interface MetricRow {
  block_w?: unknown;
  dim_w?: unknown;
  eval?: unknown;
  n_triplets?: number | null;
  fitted_at?: string | null;
}

const finiteNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Stored row → weights index-aligned with `space.tagDims`. Missing row / bad values → DEFAULT_METRIC's. */
export function metricFromRow(row: MetricRow | null | undefined, space: FeatureSpace): MetricWeights {
  const block = { ...DEFAULT_BLOCK_WEIGHTS } as Record<BlockName, number>;
  if (row && isObj(row.block_w)) for (const b of BLOCKS) if (finiteNonNeg(row.block_w[b])) block[b] = row.block_w[b];
  // An index array (pre-metricStore format) can't be mapped to ids safely: ignore it.
  let tagDims: number[] | null = null;
  if (row && isObj(row.dim_w)) {
    const dw = row.dim_w;
    tagDims = space.tagDims.map((d) => (finiteNonNeg(dw[d.id]) ? (dw[d.id] as number) : 1));
  }
  return { block, tagDims };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Weights (index-aligned with `space`) → { block_w, dim_w } keyed by tag-dim id. */
export function metricToRow(w: MetricWeights, space: FeatureSpace): { block_w: Record<BlockName, number>; dim_w: Record<string, number> | null } {
  const block_w = {} as Record<BlockName, number>;
  for (const b of BLOCKS) block_w[b] = round6(w.block[b] ?? DEFAULT_BLOCK_WEIGHTS[b]);
  const dim_w = w.tagDims ? Object.fromEntries(space.tagDims.map((d, i) => [d.id, round6(w.tagDims![i] ?? 1)])) : null;
  return { block_w, dim_w };
}

/** Block weights plus the most up- and down-weighted tags by label. */
export function metricSummary(w: MetricWeights, space: FeatureSpace, top = SUMMARY_TAGS): MetricSummary {
  const tags = (w.tagDims ?? []).map((v, i) => ({ id: space.tagDims[i]?.id ?? `tag${i}`, label: space.tagDims[i]?.label ?? `tag ${i}`, w: round6(v) }));
  return {
    block: { ...w.block },
    topTags: tags.filter((t) => t.w > 1 + 1e-3).sort((a, b) => b.w - a.w || a.id.localeCompare(b.id)).slice(0, top),
    bottomTags: tags.filter((t) => t.w < 1 - 1e-3).sort((a, b) => a.w - b.w || a.id.localeCompare(b.id)).slice(0, top),
  };
}

export interface FitInput {
  space: FeatureSpace;
  positions: Record<NodeKey, Vec3>;
  pinnedKeys: Iterable<NodeKey>;
  groups: GroupMembership[];
}

export interface FitDecision {
  kept: 'learned' | 'unit';
  reason: string;
  /** What to store: the learned weights, or DEFAULT_METRIC. */
  weights: MetricWeights;
  learned: MetricWeights;
  eval: { errBaseline: number; errLearned: number; n: number };
  nTriplets: number;
}

/**
 * D6 fit + eval: sample triplets off the arranged map, fit, and leave-one-pin-out
 * against DEFAULT_METRIC. Keeps the learned weights only when there are
 * triplets, ≥ MIN_EVAL_PINS evaluable pins, and errLearned < errBaseline.
 */
export function decideMetric({ space, positions, pinnedKeys, groups }: FitInput): FitDecision {
  const pins = [...new Set(pinnedKeys)];
  const triplets = sampleTriplets(space, positions, pins, groups, { seed: FIT_SEED });
  const learned = fitMetric(space, triplets, { init: DEFAULT_METRIC });
  const ev = leaveOnePinOut(space, positions, pins, learned, { baseline: DEFAULT_METRIC });
  const fallback = { block: { ...DEFAULT_METRIC.block }, tagDims: null };
  const base = { learned, eval: ev, nTriplets: triplets.length };

  if (!triplets.length)
    return {
      ...base,
      kept: 'unit',
      weights: fallback,
      reason: 'There isn’t enough arranged map to learn from yet, so the map keeps the default weights.',
    };
  if (ev.n < MIN_EVAL_PINS)
    return {
      ...base,
      kept: 'unit',
      weights: fallback,
      reason: `Only ${ev.n} pinned node${ev.n === 1 ? '' : 's'} to test learned weights on (at least ${MIN_EVAL_PINS} needed), so the map keeps the default weights. Pin a few more nodes and re-arrange.`,
    };
  if (ev.errLearned < ev.errBaseline) {
    const pct = Math.max(1, Math.round((1 - ev.errLearned / ev.errBaseline) * 100));
    return {
      ...base,
      kept: 'learned',
      weights: learned,
      reason: `Learned weights place your pins ${pct}% closer than the default weights, so the map now uses them.`,
    };
  }
  return {
    ...base,
    kept: 'unit',
    weights: fallback,
    reason: `Learned weights didn’t beat the default weights (${errPair(ev.errLearned, ev.errBaseline)} map units), so the map keeps the default weights.`,
  };
}

/** "0.31 vs 0.29", with a third decimal when two would tie. */
function errPair(a: number, b: number): string {
  const d = a.toFixed(2) === b.toFixed(2) ? 3 : 2;
  return `${a.toFixed(d)} vs ${b.toFixed(d)}`;
}

/** The `eval` jsonb stored with a fit — everything GET needs to answer without re-fitting. */
export interface StoredEval {
  errBaseline: number;
  errLearned: number;
  n: number;
  kept: 'learned' | 'unit';
  reason: string;
  learned: MetricSummary;
  minPins: number;
}

/** Row to upsert into taste_map_metric for a decision (lens/user_id added by the caller). */
export function decisionToRow(d: FitDecision, space: FeatureSpace, fittedAt: string) {
  const stored: StoredEval = { ...d.eval, kept: d.kept, reason: d.reason, learned: metricSummary(d.learned, space), minPins: MIN_EVAL_PINS };
  return { ...metricToRow(d.weights, space), eval: stored, n_triplets: d.nTriplets, fitted_at: fittedAt };
}

export function decisionToResponse(d: FitDecision, space: FeatureSpace, fittedAt: string): MetricFitResponse {
  return {
    kept: d.kept,
    reason: d.reason,
    eval: { ...d.eval },
    nTriplets: d.nTriplets,
    learned: metricSummary(d.learned, space),
    fittedAt,
  };
}

/**
 * A stored row → MetricFitResponse. Rows written by a fit carry their eval; a
 * row without one (e.g. from an import) is reported from its weights alone.
 */
export function responseFromRow(row: MetricRow): MetricFitResponse {
  const ev = isObj(row.eval) ? (row.eval as Partial<StoredEval>) : null;
  const fittedAt = row.fitted_at ?? new Date(0).toISOString();
  const nTriplets = row.n_triplets ?? 0;
  if (ev && (ev.kept === 'learned' || ev.kept === 'unit') && typeof ev.reason === 'string' && isObj(ev.learned)) {
    return {
      kept: ev.kept,
      reason: ev.reason,
      eval: { errBaseline: Number(ev.errBaseline ?? 0), errLearned: Number(ev.errLearned ?? 0), n: Number(ev.n ?? 0) },
      nTriplets,
      learned: ev.learned as MetricSummary,
      fittedAt,
    };
  }
  const block = { ...DEFAULT_BLOCK_WEIGHTS } as Record<BlockName, number>;
  if (isObj(row.block_w)) for (const b of BLOCKS) if (finiteNonNeg(row.block_w[b])) block[b] = row.block_w[b];
  const tags = isObj(row.dim_w)
    ? Object.entries(row.dim_w)
        .filter((e): e is [string, number] => finiteNonNeg(e[1]))
        .map(([id, w]) => ({ id, label: id, w }))
    : [];
  const isDefault = BLOCKS.every((b) => block[b] === DEFAULT_BLOCK_WEIGHTS[b]) && tags.every((t) => t.w === 1);
  return {
    kept: isDefault ? 'unit' : 'learned',
    reason: 'These weights were imported, not fitted on this map, so there is no evaluation for them yet. Re-fit to check them.',
    eval: { errBaseline: 0, errLearned: 0, n: 0 },
    nTriplets,
    learned: {
      block,
      topTags: tags.filter((t) => t.w > 1 + 1e-3).sort((a, b) => b.w - a.w).slice(0, SUMMARY_TAGS),
      bottomTags: tags.filter((t) => t.w < 1 - 1e-3).sort((a, b) => a.w - b.w).slice(0, SUMMARY_TAGS),
    },
    fittedAt,
  };
}
