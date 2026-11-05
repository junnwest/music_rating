/**
 * Ghost nodes (README TODO "missing genre data", TASTE_MAP_PLAN.md): which
 * nodes the map shouldn't force into place.
 *
 *   thin    too little evidence to place: no listener graph and tags that are
 *           only store genres (iTunes / Deezer), or nothing but the era block.
 *   misfit  well enough described, but like nothing else on this map: its best
 *           similarity to any other node is far below the map's typical
 *           nearest-neighbor similarity.
 *
 * A ghost is drawn hollow and faint, left out of density fields / countries /
 * honesty and of other nodes' neighbor lists, and positioned by kNN barycentre
 * instead of pulling the UMAP solve (payload.ts). The user can place it (pin),
 * answer a question about it (thin), leave it out, or include it anyway
 * (taste_map_node_state); any of those but "leave it out" makes it normal.
 *
 * Evidence (0–1) is the confidence-weighted share of the blocks that say what a
 * node sounds like (evidence.ts confidences; the era block says nothing, so it
 * isn't counted):
 *
 *   evidence = Σ_b W_b · has_b · conf_b,   W = tags 0.45, graph 0.35, text 0.20
 *
 * Calibration (zero / junnwest / one, 2026-11-05, 30 / 30 / 22 nodes):
 *   - THIN_MAX 0.35: a node is thin exactly when it has no similar-artist graph
 *     AND its tags are store genres only (store tags 0.45·0.35 + text
 *     0.20·0.675 = 0.29). Graph alone (0.35), trusted tags alone (0.45) or store
 *     tags + graph (0.51) are enough to place. Thin on the real maps:
 *     zero → 이상순 (0.16: one iTunes-tagged album, no graph, no embedding),
 *     junnwest → CAMO (0.29: iTunes-only tags, no graph); one → none.
 *   - MISFIT: nearest-neighbor similarity < MISFIT_RATIO × the map's median
 *     nearest-neighbor similarity AND < MISFIT_ABS. Medians after the
 *     evidence fix: zero 0.55, junnwest 0.55, one 0.37. The loneliest nodes
 *     sit at 0.60 (zero: Avicii & Fred again.., each other's nearest), 0.48
 *     (junnwest: Fred again.. & NewJeans, also a pair), 0.51 (junnwest: 유재하)
 *     and 0.40 / 0.49 (one: ヨルシカ, the only J-pop on a hip-hop map, and
 *     落日飛車) of their map's median. 0.45 takes only ヨルシカ.
 *     The absolute cap keeps a tight map (median 0.7) from ghosting a node that
 *     is still 0.4 similar to something.
 *   - MAX_GHOST_SHARE 0.15: never more than 15% of the map (4 of 30), weakest
 *     first, whatever the data looks like.
 *
 * Pure: no DB.
 */
import type { NodeAnswer, NodeState } from './ghostApi';
import { blockConf } from './evidence';
import type { MapNode, NodeKey, TasteMapPayloadNode } from './types';

export type Ghost = NonNullable<TasteMapPayloadNode['ghost']>;

export const EVIDENCE_WEIGHTS = { tags: 0.45, graph: 0.35, text: 0.2 } as const;
export const THIN_MAX = 0.35;
export const MISFIT_RATIO = 0.45;
export const MISFIT_ABS = 0.3;
/** Misfits need a map to misfit: below this many placeable nodes none are called. */
export const MISFIT_MIN_NODES = 8;
/** At most this share of the map (at least one node) is ghosted from data alone. */
export const MAX_GHOST_SHARE = 0.15;

/** How much the node's data says about its sound, 0–1 (see the header). */
export function nodeEvidence(n: MapNode): number {
  let e = 0;
  for (const b of ['tags', 'graph', 'text'] as const) if (n.has[b]) e += EVIDENCE_WEIGHTS[b] * blockConf(n, b);
  return Math.round(e * 1000) / 1000;
}

export function hasAnswer(a: NodeAnswer | null | undefined): a is Extract<NodeAnswer, { genreId: string }> {
  return !!a && 'genreId' in a && typeof a.genreId === 'string' && a.genreId.length > 0;
}

export interface ClassifyOptions {
  /** Pinned nodes are placed by the user: never ghosts. */
  pinned?: ReadonlySet<NodeKey>;
  /** taste_map_node_state rows by node key. */
  states?: ReadonlyMap<NodeKey, NodeState>;
}

export interface Classification {
  ghosts: Map<NodeKey, Ghost>;
  /** Every node's evidence (diagnostics, dump script). */
  evidence: Map<NodeKey, number>;
  /** Nearest-neighbor similarity among non-thin nodes, and its median (diagnostics). */
  nn: Map<NodeKey, number>;
  nnMedian: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Classify a map's nodes. `S` is similarityMatrix(nodes, weights) (row-major,
 * index-aligned with `nodes`).
 */
export function classifyGhosts(nodes: readonly MapNode[], S: Float64Array, opts: ClassifyOptions = {}): Classification {
  const n = nodes.length;
  const evidence = new Map<NodeKey, number>();
  const ghosts = new Map<NodeKey, Ghost>();
  const nn = new Map<NodeKey, number>();
  if (!n) return { ghosts, evidence, nn, nnMedian: 0 };

  const stateOf = (k: NodeKey) => opts.states?.get(k) ?? null;
  // Placed, included, answered or pinned: the user has spoken, it's a normal node.
  const settled = (k: NodeKey) => {
    const st = stateOf(k);
    return !!opts.pinned?.has(k) || st?.state === 'placed' || st?.state === 'included' || hasAnswer(st?.answer);
  };

  const thin = new Set<number>();
  nodes.forEach((m, i) => {
    const e = nodeEvidence(m);
    evidence.set(m.key, e);
    if (e < THIN_MAX) thin.add(i);
  });

  // Nearest neighbor among nodes that have enough evidence to be placed.
  const placeable = nodes.map((_, i) => i).filter((i) => !thin.has(i) || settled(nodes[i].key));
  for (const i of placeable) {
    let best = -Infinity;
    for (const j of placeable) if (j !== i && S[i * n + j] > best) best = S[i * n + j];
    if (Number.isFinite(best)) nn.set(nodes[i].key, best);
  }
  const nnMedian = median([...nn.values()]);

  const candidates: { key: NodeKey; ghost: Ghost; rank: number }[] = [];
  nodes.forEach((m, i) => {
    if (settled(m.key)) return;
    const e = evidence.get(m.key)!;
    if (thin.has(i)) {
      candidates.push({ key: m.key, ghost: { reason: 'thin', evidence: e }, rank: e });
      return;
    }
    const s = nn.get(m.key);
    if (placeable.length < MISFIT_MIN_NODES || s == null || !(nnMedian > 0)) return;
    if (s < MISFIT_RATIO * nnMedian && s < MISFIT_ABS) {
      // Ranked after every thin node, loneliest first.
      candidates.push({ key: m.key, ghost: { reason: 'misfit', evidence: e }, rank: 1 + s / nnMedian });
    }
  });
  const cap = Math.max(1, Math.floor(MAX_GHOST_SHARE * n));
  candidates
    .sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : 1))
    .slice(0, cap)
    .forEach((c) => ghosts.set(c.key, c.ghost));

  // "Leave it out" always holds (the user's choice, not capped).
  nodes.forEach((m) => {
    if (stateOf(m.key)?.state !== 'hidden' || opts.pinned?.has(m.key)) return;
    const e = evidence.get(m.key)!;
    const g = ghosts.get(m.key) ?? { reason: e < THIN_MAX ? ('thin' as const) : ('misfit' as const), evidence: e };
    ghosts.set(m.key, { ...g, hidden: true });
  });

  return { ghosts, evidence, nn, nnMedian };
}
