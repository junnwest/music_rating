/**
 * Builds a user's TasteMapPayload: load → features → layout → groups, shared by
 * GET /api/taste/map and scripts/dump-taste-map-layout.ts (so a map can be
 * inspected for any user without their session).
 *
 * The solved positions are stored in taste_map_layouts and fed back as the next
 * solve's init, so the map doesn't reshuffle when one rating changes. Pins
 * override solved positions.
 *
 * taste_map_layouts.version says where the stored positions came from (no extra
 * column; Phase 3 decision):
 *   1 = LAYOUT_SOLVED   UMAP output, a cache. Re-solved (warm-started from it)
 *                       whenever the input hash changes.
 *   2 = LAYOUT_ARRANGED Saved by the user (PUT /api/taste/map/layout, or an
 *                       import). Never re-solved and never overwritten by a UMAP
 *                       solve: nodes keep their stored position, and new nodes
 *                       are placed by kNN barycentre (layout.ts placeNew) over
 *                       the stored ones (assembleArrangedLayout). Its version and
 *                       solved_at are in the input hash, so saving a layout
 *                       invalidates the cached payload.
 * Anything added to the payload must be covered by the input hash, because the
 * Redis cache is keyed by it (pins incl. softZ, groups + members, eras, metric
 * fitted_at, block weights, and an arranged layout's version + solved_at).
 *
 * Groups: until the user edits groups (Phase 4), they are SEEDED from the Taste
 * tab's worlds (lib/taste/worlds.ts placeAlbum) — a node's membership is the
 * share of its rated albums placed in each world. Seed groups aren't stored.
 *
 * Server-only.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { placeAlbum } from '../taste/worlds';
import { qualifiedInfo } from '../genres/language';
import { artistInputFor, loadArtistPriors } from '../taste/artistPrior';
import { loadMapUserInput } from './load';
import { buildFeatureSpace, explain, DEFAULT_METRIC } from './features';
import { finishLayout, placeNew, similarityMatrix, solveLayout, type ExplainFn } from './layout';
import { metricFromRow } from './metricStore';
import { buildPalette } from './palette';
import { selectPins, type StoredPin } from './store';
import type {
  EraOverride,
  FeatureSpace,
  LayoutResult,
  MapUserInput,
  MetricWeights,
  NodeKey,
  TasteMapGroup,
  TasteMapPayload,
  Vec3,
} from './types';

export const LENS = 'sound';
/** taste_map_layouts.version values (see the header). */
export const LAYOUT_SOLVED = 1;
export const LAYOUT_ARRANGED = 2;
/** Same 9-world ceiling as the Taste map; distinct hues readable on light and dark. */
const GROUP_COLORS = ['#E4572E', '#4C9F70', '#3E7CB1', '#F2A541', '#9B5DE5', '#00A6A6', '#D7263D', '#7A9E3B', '#C17C74'];
export const MIN_RATED_ALBUMS = 5;

export type BuildResult =
  | { kind: 'too-few'; needed: number; have: number }
  | { kind: 'ok'; payload: TasteMapPayload; inputHash: string; cached: boolean };

export interface BuildOptions {
  /** Store the solved positions as the next init (the route does; dump scripts don't). */
  persist?: boolean;
  /** Return a cached payload for this input hash, if any — skips the solve. */
  cached?: (inputHash: string) => Promise<TasteMapPayload | null>;
  /** Block-weight overrides on top of the stored/default metric (tuning experiments). */
  blockWeights?: Partial<MetricWeights['block']>;
}

interface StoredLayoutRow {
  positions: Record<NodeKey, Vec3> | null;
  input_hash: string | null;
  version: number | null;
  solved_at: string | null;
}

export async function buildTasteMapPayload(db: SupabaseClient, userId: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const [input, erasRes, pinsRes, groupsRes, metricRes, layoutRes] = await Promise.all([
    loadMapUserInput(db, userId),
    db.from('taste_map_eras').select('artist_id, split_rg_ids').eq('user_id', userId),
    selectPins(db, userId),
    db.from('taste_map_groups').select('id, name, color, seed_world, taste_map_members(node_key, weight)').eq('user_id', userId),
    db.from('taste_map_metric').select('block_w, dim_w, fitted_at').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
    db.from('taste_map_layouts').select('positions, input_hash, version, solved_at').eq('user_id', userId).eq('lens', LENS).maybeSingle(),
  ]);

  const ratedAlbums = input.artists.flatMap((a) => a.albums.filter((al) => al.rated));
  if (ratedAlbums.length < MIN_RATED_ALBUMS) return { kind: 'too-few', needed: MIN_RATED_ALBUMS, have: ratedAlbums.length };

  const overrides: EraOverride[] = (erasRes.data ?? []).map((r) => ({ artistId: r.artist_id, splitAlbumIds: r.split_rg_ids ?? [] }));
  if (pinsRes.error) console.error('[taste-map] pins read failed:', pinsRes.error.message);
  const pins = new Map<NodeKey, StoredPin>(pinsRes.data.map((p) => [p.key, p]));
  // Tag-dim weights (dim_w, keyed by tag id) are resolved against the space below.
  const base: MetricWeights = metricRes.data
    ? { block: { ...DEFAULT_METRIC.block, ...(metricRes.data.block_w ?? {}) }, tagDims: null }
    : DEFAULT_METRIC;
  const blockWeights = opts.blockWeights ? { ...base.block, ...opts.blockWeights } : base.block;
  const stored = (layoutRes.data ?? null) as StoredLayoutRow | null;
  const arranged = stored?.version === LAYOUT_ARRANGED;

  const inputHash = createHash('sha1')
    .update(
      JSON.stringify([
        ratedAlbums.map((a) => [a.id, a.score]).sort(),
        input.artists.map((a) => [a.id, a.similar.map((s) => s.items.length)]),
        overrides,
        [...pins.values()].map((p) => [p.key, p.pos, p.softZ ? 1 : 0]).sort(),
        metricRes.data?.fitted_at ?? null,
        groupsRes.data ?? [],
        blockWeights,
        // A saved (user-arranged) layout is an input; a solved one is only a cache.
        arranged ? [stored!.version, stored!.solved_at] : null,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  const hit = await opts.cached?.(inputHash);
  if (hit) return { kind: 'ok', payload: hit, inputHash, cached: true };

  const space = buildFeatureSpace(input, overrides);
  const weights: MetricWeights = {
    block: blockWeights,
    tagDims: metricRes.data ? metricFromRow(metricRes.data, space).tagDims : null,
  };
  const explainFn: ExplainFn = (a, b) => explain(a, b, space, weights);
  const prev = stored?.positions ?? null;
  const fromArranged = arranged && prev ? assembleArrangedLayout(space, prev, { weights, explain: explainFn }) : null;
  const layout = fromArranged?.layout ?? solveLayout(space, { weights, init: prev ?? undefined, explain: explainFn });

  // ── groups ──
  const albumWorld = await worldsOf(db, input);
  let groups: TasteMapGroup[];
  const memberships = new Map<NodeKey, Record<string, number>>();
  const storedGroups = groupsRes.data ?? [];
  if (storedGroups.length > 0) {
    groups = storedGroups.map((g) => ({ id: g.id, name: g.name, color: g.color, seedWorld: g.seed_world }));
    for (const g of storedGroups)
      for (const m of (g.taste_map_members ?? []) as { node_key: string; weight: number }[]) {
        const rec = memberships.get(m.node_key) ?? {};
        rec[g.id] = m.weight;
        memberships.set(m.node_key, rec);
      }
  } else {
    const mass = new Map<string, number>();
    for (const node of space.nodes) {
      const rec: Record<string, number> = {};
      for (const id of node.ratedAlbumIds) {
        const w = albumWorld.get(id);
        if (!w) continue;
        rec[`w:${w}`] = (rec[`w:${w}`] ?? 0) + 1 / node.ratedAlbumIds.length;
        mass.set(w, (mass.get(w) ?? 0) + 1);
      }
      memberships.set(node.key, rec);
    }
    groups = [...mass.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GROUP_COLORS.length)
      .map(([w], i) => ({ id: `w:${w}`, name: qualifiedInfo(w)?.display.en ?? w, color: GROUP_COLORS[i], seedWorld: w }));
    const shown = new Set(groups.map((g) => g.id));
    for (const rec of memberships.values()) for (const k of Object.keys(rec)) if (!shown.has(k)) delete rec[k];
  }

  // ── assemble ──
  const albumsById = new Map(input.artists.flatMap((a) => a.albums.map((al) => [al.id, al] as const)));
  const positions = { ...layout.positions };
  for (const [k, p] of pins) if (positions[k]) positions[k] = p.pos;
  const trails = new Map<string, NodeKey[]>();
  for (const node of space.nodes) {
    if (!node.key.startsWith('e:')) continue;
    trails.set(node.artistId, [...(trails.get(node.artistId) ?? []), node.key]);
  }

  const palette = buildPalette(space);
  const payload: TasteMapPayload = {
    version: 1,
    nodes: space.nodes.map((n) => ({
      key: n.key,
      artistId: n.artistId,
      label: n.label,
      eraLabel: n.eraLabel,
      mass: n.mass,
      avgScore: n.avgScore,
      covers: n.ratedAlbumIds.map((id) => {
        const al = albumsById.get(id);
        return { id, title: al?.title ?? '', coverUrl: al?.coverUrl ?? null };
      }),
      groups: memberships.get(n.key) ?? {},
      pos: positions[n.key],
      pos2d: layout.plane2d[n.key],
      pinned: pins.has(n.key),
      ...(pins.get(n.key)?.softZ ? { softZ: true } : {}),
      mix: palette.mix[n.key] ?? {},
    })),
    groups,
    palette: palette.hues,
    // space.nodes keeps each artist's eras in chronological order.
    trails: [...trails.entries()].filter(([, keys]) => keys.length > 1).map(([artistId, keys]) => ({ artistId, keys })),
    neighbors: layout.neighbors,
  };

  if (opts.persist) await persistLayout(db, userId, stored, layout, fromArranged, inputHash);
  return { kind: 'ok', payload, inputHash, cached: false };
}

/**
 * Store the layout for next time. A user-arranged layout (version 2) is never
 * replaced by a UMAP solve: only newly placed nodes are added to it, with the
 * same version and solved_at, so the input hash (and the cache) stay put. The
 * placement is deterministic, so the payload is the same either way.
 */
async function persistLayout(
  db: SupabaseClient,
  userId: string,
  stored: StoredLayoutRow | null,
  layout: LayoutResult,
  fromArranged: ArrangedResult | null,
  inputHash: string,
): Promise<void> {
  if (stored?.version === LAYOUT_ARRANGED) {
    if (!fromArranged || !Object.keys(fromArranged.placed).length) return;
    const { error } = await db
      .from('taste_map_layouts')
      .update({ positions: { ...(stored.positions ?? {}), ...fromArranged.placed } })
      .eq('user_id', userId)
      .eq('lens', LENS)
      .eq('version', LAYOUT_ARRANGED);
    if (error) console.error('[taste-map] arranged layout update failed:', error.message);
    return;
  }
  if (stored?.input_hash === inputHash) return;
  const row = {
    user_id: userId,
    lens: LENS,
    positions: layout.positions,
    dims: 3,
    version: LAYOUT_SOLVED,
    input_hash: inputHash,
    solved_at: new Date().toISOString(),
  };
  // If the user saved a layout while this solve ran, keep theirs: an existing row
  // is only updated while it is still a solve, and a new row never replaces one.
  const { error } = stored
    ? await db.from('taste_map_layouts').update(row).eq('user_id', userId).eq('lens', LENS).neq('version', LAYOUT_ARRANGED)
    : await db.from('taste_map_layouts').upsert(row, { onConflict: 'user_id,lens', ignoreDuplicates: true });
  if (error) console.error('[taste-map] layout save failed:', error.message);
}

// ── user-arranged layouts (pure; unit-tested in payload.test.ts) ─────────────

export interface ArrangedResult {
  layout: LayoutResult;
  /** Nodes that weren't in the stored layout, with where they were placed. */
  placed: Record<NodeKey, Vec3>;
}

/** Small deterministic per-key offset (±0.01) so new nodes with the same anchors don't stack. */
function jitterFor(key: string): Vec3 {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const f = (salt: number) => ((Math.imul(h ^ salt, 2654435761) >>> 0) / 4294967296 - 0.5) * 0.02;
  return [f(1), f(2), f(3)];
}

const isVec3 = (p: unknown): p is Vec3 =>
  Array.isArray(p) && p.length === 3 && p.every((c) => typeof c === 'number' && Number.isFinite(c));

/**
 * A user-arranged layout (version 2) for the current feature space: the stored
 * position for every node that still has one, a kNN barycentre (current metric)
 * over those for every node that doesn't, then the same plane + neighbors tail
 * as solveLayout (layout.ts finishLayout), so the two paths can't drift.
 * Null when fewer than min(3, n) current nodes have a stored position: nothing
 * is left to anchor to, so the caller solves instead (without persisting).
 */
export function assembleArrangedLayout(
  space: FeatureSpace,
  stored: Record<NodeKey, Vec3>,
  opts: { weights?: MetricWeights; explain?: ExplainFn; k?: number } = {},
): ArrangedResult | null {
  const kept: Record<NodeKey, Vec3> = {};
  for (const m of space.nodes) {
    const p = stored[m.key];
    if (isVec3(p)) kept[m.key] = [p[0], p[1], p[2]];
  }
  const n = space.nodes.length;
  if (!n || Object.keys(kept).length < Math.min(3, n)) return null;

  const placed: Record<NodeKey, Vec3> = {};
  for (const m of space.nodes) {
    if (kept[m.key]) continue;
    // Anchored on the stored positions only, so the order of new nodes doesn't matter.
    const { pos } = placeNew(space, kept, m, { weights: opts.weights });
    const j = jitterFor(m.key);
    placed[m.key] = [pos[0] + j[0], pos[1] + j[1], pos[2] + j[2]];
  }
  const layout = finishLayout(
    space,
    { ...kept, ...placed },
    { weights: opts.weights, explain: opts.explain, k: opts.k, S: similarityMatrix(space.nodes, opts.weights) },
  );
  return { layout, placed };
}

/** Rated album id → its Taste-tab world, placed exactly as /api/taste/profile places it. */
async function worldsOf(db: SupabaseClient, input: MapUserInput): Promise<Map<string, string>> {
  const priors = await loadArtistPriors(db, input.artists.map((a) => a.id));
  const out = new Map<string, string>();
  for (const artist of input.artists)
    for (const al of artist.albums) {
      if (!al.rated) continue;
      const placed = placeAlbum({
        genres: al.genres,
        title: al.title,
        nativeTitle: null,
        artistCountry: artist.country,
        artistNativeLanguage: null,
        titleLanguage: al.titleLanguage,
        artistName: artist.name,
        ...artistInputFor(priors, artist.id, al.id, artist.country),
      });
      if (placed.world) out.set(al.id, placed.world);
    }
  return out;
}
