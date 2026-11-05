/**
 * The ghost classification of a user's map without the layout solve: load →
 * features (with the user's answers) → similarity → thin.ts. Same inputs and
 * metric as payload.ts, so the questions route asks about exactly the nodes
 * the map shows as thin ghosts. Server-only, read-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMapUserInput } from './load';
import { buildFeatureSpace, DEFAULT_METRIC } from './features';
import { similarityMatrix } from './layout';
import { metricFromRow } from './metricStore';
import { selectPins } from './store';
import { answersOf, loadNodeStates } from './nodeState';
import { classifyGhosts, type Ghost } from './thin';
import type { NodeState } from './ghostApi';
import type { EraOverride, FeatureSpace, MapUserInput, MetricWeights, NodeKey } from './types';

const LENS = 'sound';

export interface GhostContext {
  input: MapUserInput;
  overrides: EraOverride[];
  space: FeatureSpace;
  S: Float64Array;
  weights: MetricWeights;
  ghosts: Map<NodeKey, Ghost>;
  states: Map<NodeKey, NodeState>;
  /** false when taste_map_node_state is missing (migration not applied). */
  statesAvailable: boolean;
}

export async function loadGhostContext(db: SupabaseClient, userId: string): Promise<GhostContext> {
  const [input, erasRes, pinsRes, metricRes, nodeStates] = await Promise.all([
    loadMapUserInput(db, userId),
    db.from('taste_map_eras').select('artist_id, split_rg_ids').eq('user_id', userId),
    selectPins(db, userId),
    db.from('taste_map_metric').select('block_w, dim_w, fitted_at').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
    loadNodeStates(db, userId),
  ]);
  const overrides: EraOverride[] = ((erasRes.data ?? []) as { artist_id: string; split_rg_ids: string[] | null }[]).map((r) => ({
    artistId: r.artist_id,
    splitAlbumIds: r.split_rg_ids ?? [],
  }));
  const space = buildFeatureSpace(input, overrides, { answers: answersOf(nodeStates.data) });
  const weights: MetricWeights = metricRes.data
    ? { block: { ...DEFAULT_METRIC.block, ...(metricRes.data.block_w ?? {}) }, tagDims: metricFromRow(metricRes.data, space).tagDims }
    : DEFAULT_METRIC;
  const S = similarityMatrix(space.nodes, weights);
  const { ghosts } = classifyGhosts(space.nodes, S, {
    pinned: new Set(pinsRes.data.map((p) => p.key)),
    states: nodeStates.data,
  });
  return { input, overrides, space, S, weights, ghosts, states: nodeStates.data, statesAvailable: nodeStates.available };
}
