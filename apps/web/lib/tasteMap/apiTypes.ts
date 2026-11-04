/**
 * Request/response contract for the Taste Map write routes (TASTE_MAP_PLAN.md
 * Phases 3–4). Shared by the route handlers (app/api/taste/map/**) and the
 * browser client (lib/tasteMap/client.ts). Every route is authed with the
 * `Authorization: Bearer <access token>` header, scoped to that user, and
 * validates its body before any write. Errors are `{ error: string }` with a
 * 4xx/5xx status.
 *
 * Node keys follow types.ts: 'a:<artists.id>' or 'e:<artists.id>:<first rg id>'.
 */
import type { BlockName, EraOverride, Neighbor, NodeKey, Vec3 } from './types';

/** Upper bounds the validators enforce (a map has ~50–500 nodes). */
export const LIMITS = {
  nodes: 2000,
  groups: 40,
  membersPerGroup: 2000,
  splitsPerArtist: 50,
  /** |coordinate| bound for any saved position (layout is ~[-1, 1]^3). */
  coord: 100,
} as const;

// ── Phase 3: pins + layout ───────────────────────────────────────────────────

/**
 * A pinned node. `softZ`: pinned from the 2D view, so only its position in the
 * D5 plane is fixed and its depth along the plane normal stays free (D5).
 * `pos` is always the full 3D world position at pin time.
 */
export interface PinInput {
  key: NodeKey;
  pos: Vec3;
  softZ?: boolean;
}

/** PUT /api/taste/map/pins — replaces the user's whole pin set. → { ok: true, count } */
export interface PinsPutBody {
  pins: PinInput[];
}

/**
 * PUT /api/taste/map/layout — saves client-arranged positions (after a
 * Re-arrange or drag). The server then treats the stored layout as
 * user-arranged: later loads keep these positions instead of re-running UMAP,
 * placing only new nodes (kNN barycentre). → { ok: true, count }
 */
export interface LayoutPutBody {
  positions: Record<NodeKey, Vec3>;
}

export interface OkResponse {
  ok: true;
  count?: number;
}

// ── Phase 3: export / import ─────────────────────────────────────────────────

export interface ExportGroup {
  /** The id in the exporting account; import maps it to a fresh uuid. */
  id: string;
  name: string;
  color: string;
  seedWorld: string | null;
  members: { key: NodeKey; weight: number; manual: boolean }[];
}

/** GET /api/taste/map/export → this. POST /api/taste/map/import takes it back. */
export interface TasteMapExport {
  kind: 'sillajuku.tasteMap';
  version: 1;
  exportedAt: string;
  lens: string;
  pins: PinInput[];
  groups: ExportGroup[];
  eras: EraOverride[];
  /** Tag weights keyed by tag-dim id (stable across feature rebuilds), null = unit. */
  metric: { block: Record<BlockName, number>; tagDims: Record<string, number> | null } | null;
  /** The stored layout, if any. */
  layout: Record<NodeKey, Vec3> | null;
}

/** POST /api/taste/map/import → counts of what was written (replace semantics). */
export interface ImportResponse {
  ok: true;
  counts: { pins: number; groups: number; members: number; eras: number; metric: number; layout: number };
}

// ── Phase 4: groups ──────────────────────────────────────────────────────────

/** POST /api/taste/map/groups → { group: TasteMapGroup } */
export interface GroupCreateBody {
  name: string;
  /** '#RRGGBB'. */
  color: string;
}

/** PATCH /api/taste/map/groups/[id] → { group: TasteMapGroup }. DELETE /api/taste/map/groups/[id] → OkResponse. */
export interface GroupPatchBody {
  name?: string;
  color?: string;
}

/**
 * PUT /api/taste/map/groups/[id]/members — replaces that group's members.
 * Weights are 0–1; a node's weights across all groups must sum to ≤ 1 (the
 * route checks against the user's other groups). → OkResponse
 */
export interface MembersPutBody {
  members: { key: NodeKey; weight: number; manual?: boolean }[];
}

/**
 * POST /api/taste/map/groups/adopt — turns the seeded (world) groups into stored
 * groups. Only allowed while the user has no stored groups; the client calls it
 * before the first group edit so the seeds don't vanish.
 * → { groups: TasteMapGroup[]; idMap: Record<string, string> } (seed id → new uuid)
 */
export interface GroupsAdoptBody {
  /** `id` is the seed id ('w:<world>'), echoed back in idMap. */
  groups: ExportGroup[];
}

// ── Phase 4: era overrides ───────────────────────────────────────────────────

export interface EraAlbum {
  id: string;
  title: string;
  year: number | null;
  rated: boolean;
  coverUrl: string | null;
  /** False for albums eras skip (compilations etc., see eras.ts countsForMap). */
  counts: boolean;
}

/** GET /api/taste/map/eras/[artistId] */
export interface EraGetResponse {
  artistId: string;
  /** Chronological, as eras.ts orders them. */
  albums: EraAlbum[];
  /** The stored override, null = automatic. */
  override: string[] | null;
  /** What the automatic detector would do (split-before album ids). */
  auto: string[];
}

/**
 * PUT /api/taste/map/eras/[artistId] — `splitAlbumIds: []` merges the artist into
 * one node; `null` deletes the override (back to automatic). → OkResponse
 */
export interface EraPutBody {
  splitAlbumIds: string[] | null;
}

// ── Phase 4: personal metric ─────────────────────────────────────────────────

export interface MetricSummary {
  block: Record<BlockName, number>;
  /** Largest and smallest learned tag weights by label, for the "Your map weights" panel. */
  topTags: { id: string; label: string; w: number }[];
  bottomTags: { id: string; label: string; w: number }[];
}

/**
 * POST /api/taste/map/metric — fits on the stored layout + pins (or `positions`
 * if sent), runs leave-one-pin-out, and stores the learned weights only when
 * they beat the default weights (features.ts DEFAULT_METRIC, era 0.5) on ≥ 3
 * pins; otherwise it stores the default weights. `kept: 'unit'` means "the
 * default weights" (named before era 0.5 was decided). → MetricFitResponse
 * GET /api/taste/map/metric → MetricFitResponse | { stored: null }
 */
export interface MetricFitBody {
  positions?: Record<NodeKey, Vec3>;
}

export interface MetricFitResponse {
  /** Which weights are now in use. */
  kept: 'learned' | 'unit';
  /** One-line, user-facing reason ("Learned weights place your pins 18% closer…" / "…didn't beat the default weights, so the map keeps them"). */
  reason: string;
  eval: { errBaseline: number; errLearned: number; n: number };
  nTriplets: number;
  learned: MetricSummary;
  fittedAt: string;
}

// ── Phase 4: add artist (ghost placement) ────────────────────────────────────

/**
 * GET /api/taste/map/place?artistId=<uuid> — where an artist the user hasn't
 * rated would land: the kNN barycentre of its nearest nodes in the user's
 * metric (layout.ts placeNew). Read-only; nothing is stored.
 */
export interface PlaceResponse {
  artistId: string;
  /** The placed node's key (whole artist, or its era with the most albums). */
  key: NodeKey;
  label: string;
  pos: Vec3;
  anchors: Neighbor[];
  /** One sentence: "Placed between X, Y and Z: shares J-Rock and listeners with them." */
  explanation: string;
}
