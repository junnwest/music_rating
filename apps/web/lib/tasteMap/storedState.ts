/**
 * Reads a user's stored Taste Map state (era overrides, pins, layout, groups,
 * metric) for the Phase 4 metric and place routes. Every query is scoped to
 * `userId` (the routes use the service-role client, which bypasses RLS).
 * Read-only. Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GroupMembership } from './metric';
import type { MetricRow } from './metricStore';
import type { EraOverride, NodeKey, Vec3 } from './types';

/** Same lens as payload.ts LENS (kept local so this module doesn't pull in the payload builder). */
export const LENS = 'sound';

export interface StoredState {
  overrides: EraOverride[];
  pins: Map<NodeKey, Vec3>;
  /** taste_map_layouts.positions, or null when the map was never solved. */
  layout: Record<NodeKey, Vec3> | null;
  groups: GroupMembership[];
  metric: MetricRow | null;
}

export async function loadStoredState(db: SupabaseClient, userId: string): Promise<StoredState> {
  const [erasRes, pinsRes, groupsRes, layoutRes, metricRes] = await Promise.all([
    db.from('taste_map_eras').select('artist_id, split_rg_ids').eq('user_id', userId),
    db.from('taste_map_pins').select('node_key, x, y, z').eq('user_id', userId),
    db.from('taste_map_groups').select('id, taste_map_members(node_key, weight)').eq('user_id', userId),
    db.from('taste_map_layouts').select('positions').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
    db.from('taste_map_metric').select('block_w, dim_w, eval, n_triplets, fitted_at').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
  ]);
  for (const [name, r] of [
    ['eras', erasRes],
    ['pins', pinsRes],
    ['groups', groupsRes],
    ['layout', layoutRes],
    ['metric', metricRes],
  ] as const)
    if (r.error) throw new Error(`[tasteMap/storedState] ${name}: ${r.error.message}`);

  const overrides: EraOverride[] = ((erasRes.data ?? []) as { artist_id: string; split_rg_ids: string[] | null }[]).map((r) => ({
    artistId: r.artist_id,
    splitAlbumIds: r.split_rg_ids ?? [],
  }));
  const pins = new Map<NodeKey, Vec3>(
    ((pinsRes.data ?? []) as { node_key: string; x: number; y: number; z: number | null }[]).map((p) => [p.node_key, [p.x, p.y, p.z ?? 0]]),
  );
  const byKey = new Map<NodeKey, Record<string, number>>();
  for (const g of (groupsRes.data ?? []) as { id: string; taste_map_members: { node_key: string; weight: number }[] | null }[])
    for (const m of g.taste_map_members ?? []) {
      const rec = byKey.get(m.node_key) ?? {};
      rec[g.id] = m.weight;
      byKey.set(m.node_key, rec);
    }
  const positions = (layoutRes.data as { positions: unknown } | null)?.positions;
  return {
    overrides,
    pins,
    layout: positions && typeof positions === 'object' && !Array.isArray(positions) ? (positions as Record<NodeKey, Vec3>) : null,
    groups: [...byKey.entries()].map(([key, weights]) => ({ key, weights })),
    metric: (metricRes.data as MetricRow | null) ?? null,
  };
}

/** Stored layout with pins overlaid (pins win), or null without a stored layout. */
export function mapPositions(state: Pick<StoredState, 'layout' | 'pins'>): Record<NodeKey, Vec3> | null {
  if (!state.layout) return null;
  const out: Record<NodeKey, Vec3> = { ...state.layout };
  for (const [k, p] of state.pins) out[k] = p;
  return out;
}
