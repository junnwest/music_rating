/**
 * Pure halves of GET /api/taste/map/export and POST /api/taste/map/import
 * (apiTypes.ts TasteMapExport): DB rows → export, and a validated export → the
 * rows to write. No I/O, so the remapping and scoping are unit-testable.
 *
 * Metric tag weights: taste_map_metric.dim_w is keyed by tag-dim id (see
 * metricStore.ts), so it is exported as-is. A legacy index-aligned array can't
 * be mapped to ids without rebuilding the feature space, and metricFromRow
 * ignores arrays anyway, so it exports as `tagDims: null` (unit).
 */
import type { ExportGroup, PinInput, TasteMapExport } from './apiTypes';
import { DEFAULT_BLOCK_WEIGHTS } from './features';
import { BLOCKS, type BlockName, type EraOverride, type NodeKey, type Vec3 } from './types';
import type { StoredPin } from './store';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface ExportRows {
  lens: string;
  exportedAt: string;
  pins: StoredPin[];
  groups: {
    id: string;
    name: string;
    color: string;
    seed_world: string | null;
    taste_map_members: { node_key: string; weight: number; manual: boolean | null }[] | null;
  }[];
  eras: { artist_id: string; split_rg_ids: string[] | null }[];
  metric: { block_w?: unknown; dim_w?: unknown } | null;
  layout: Record<NodeKey, Vec3> | null;
}

export function buildExport(rows: ExportRows): TasteMapExport {
  const pins: PinInput[] = rows.pins.map((p) => ({ key: p.key, pos: [p.pos[0], p.pos[1], p.pos[2]], ...(p.softZ ? { softZ: true } : {}) }));
  const groups: ExportGroup[] = rows.groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    seedWorld: g.seed_world ?? null,
    members: (g.taste_map_members ?? [])
      .map((m) => ({ key: m.node_key, weight: m.weight, manual: m.manual === true }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  }));
  const eras: EraOverride[] = rows.eras.map((e) => ({ artistId: e.artist_id, splitAlbumIds: e.split_rg_ids ?? [] }));

  let metric: TasteMapExport['metric'] = null;
  if (rows.metric) {
    const block = { ...DEFAULT_BLOCK_WEIGHTS } as Record<BlockName, number>;
    const bw = rows.metric.block_w;
    if (isObj(bw)) for (const b of BLOCKS) if (finite(bw[b]) && bw[b] >= 0) block[b] = bw[b];
    let tagDims: Record<string, number> | null = null;
    if (isObj(rows.metric.dim_w)) {
      tagDims = {};
      for (const [id, w] of Object.entries(rows.metric.dim_w)) if (finite(w) && w >= 0) tagDims[id] = w;
    }
    metric = { block, tagDims };
  }

  let layout: Record<NodeKey, Vec3> | null = null;
  if (isObj(rows.layout)) {
    layout = {};
    for (const [k, p] of Object.entries(rows.layout))
      if (Array.isArray(p) && p.length === 3 && p.every(finite)) layout[k] = [p[0], p[1], p[2]];
  }

  return { kind: 'sillajuku.tasteMap', version: 1, exportedAt: rows.exportedAt, lens: rows.lens, pins, groups, eras, metric, layout };
}

export interface ImportPlan {
  /** Export group id → the fresh uuid it is stored under. */
  idMap: Record<string, string>;
  groups: { id: string; user_id: string; name: string; color: string; seed_world: string | null }[];
  members: { group_id: string; node_key: NodeKey; weight: number; manual: boolean }[];
  eras: { user_id: string; artist_id: string; split_rg_ids: string[]; manual: true; updated_at: string }[];
  metric: {
    user_id: string;
    lens: string;
    block_w: Record<BlockName, number>;
    dim_w: Record<string, number> | null;
    eval: null;
    n_triplets: 0;
    fitted_at: string;
  } | null;
  layout: Record<NodeKey, Vec3> | null;
}

/**
 * The rows an import writes for `userId` (every row carries it, or belongs to a
 * group that does). Group ids are always fresh, so an export from another
 * account can't touch that account's groups.
 */
export function planImport(userId: string, exp: TasteMapExport, lens: string, newId: () => string, now: string): ImportPlan {
  const idMap: Record<string, string> = {};
  for (const g of exp.groups) idMap[g.id] = newId();
  return {
    idMap,
    groups: exp.groups.map((g) => ({ id: idMap[g.id], user_id: userId, name: g.name, color: g.color, seed_world: g.seedWorld })),
    members: exp.groups.flatMap((g) =>
      g.members.map((m) => ({ group_id: idMap[g.id], node_key: m.key, weight: m.weight, manual: m.manual })),
    ),
    eras: exp.eras.map((e) => ({ user_id: userId, artist_id: e.artistId, split_rg_ids: e.splitAlbumIds, manual: true, updated_at: now })),
    metric: exp.metric
      ? { user_id: userId, lens, block_w: exp.metric.block, dim_w: exp.metric.tagDims, eval: null, n_triplets: 0, fitted_at: now }
      : null,
    layout: exp.layout && Object.keys(exp.layout).length ? exp.layout : null,
  };
}
