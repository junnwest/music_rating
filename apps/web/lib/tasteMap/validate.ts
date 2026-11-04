/**
 * Body validation for the Taste Map write routes (apiTypes.ts). Pure, no I/O.
 *
 * Every validator takes `unknown` (the parsed JSON body) and returns either the
 * normalized value (extra fields dropped, so a body can't smuggle `user_id` or
 * anything else through to a write) or a one-line error for a 400. Small
 * building blocks (isUuid, isNodeKey, isVec3, isHexColor, …) are exported for
 * the Phase 4 routes.
 */
import { LIMITS } from './apiTypes';
import type { ExportGroup, PinInput, TasteMapExport } from './apiTypes';
import { BLOCKS, type BlockName, type EraOverride, type NodeKey, type Vec3 } from './types';

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Validated<T> => ({ ok: false, error });

// ── building blocks ──────────────────────────────────────────────────────────

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const UUID_RE = new RegExp(`^${UUID}$`);
const NODE_KEY_RE = new RegExp(`^(?:a:${UUID}|e:${UUID}:${UUID})$`);

export const MAX_NAME_LENGTH = 60;
/** Bound on a stored metric weight (block or tag dim). Fitted weights sit around 0–5. */
export const MAX_METRIC_WEIGHT = 100;
/** Slack on "a node's memberships sum to ≤ 1" for float round-off. */
export const MEMBERSHIP_EPS = 1e-6;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** 'a:<uuid>' or 'e:<uuid>:<uuid>', 3–200 chars (the taste_map_* node_key check). */
export function isNodeKey(v: unknown): v is NodeKey {
  return typeof v === 'string' && v.length >= 3 && v.length <= 200 && NODE_KEY_RE.test(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Three finite numbers, each |c| ≤ bound (default LIMITS.coord). */
export function isVec3(v: unknown, bound: number = LIMITS.coord): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((c) => isFiniteNumber(c) && Math.abs(c) <= bound);
}

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
}

/** 1–60 characters after trimming (the taste_map_groups name check). */
export function isGroupName(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= MAX_NAME_LENGTH;
}

export function isWeight01(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

// ── pins / positions ─────────────────────────────────────────────────────────

/** A PinInput[] (PinsPutBody.pins or TasteMapExport.pins). */
export function validatePins(v: unknown): Validated<PinInput[]> {
  if (!Array.isArray(v)) return fail('pins must be an array');
  if (v.length > LIMITS.nodes) return fail(`too many pins (max ${LIMITS.nodes})`);
  const seen = new Set<string>();
  const out: PinInput[] = [];
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (!isPlainObject(p)) return fail(`pins[${i}] must be an object`);
    if (!isNodeKey(p.key)) return fail(`pins[${i}].key is not a node key`);
    if (seen.has(p.key)) return fail(`duplicate pin key ${p.key}`);
    seen.add(p.key);
    if (!isVec3(p.pos)) return fail(`pins[${i}].pos must be 3 finite numbers within ±${LIMITS.coord}`);
    if (p.softZ !== undefined && typeof p.softZ !== 'boolean') return fail(`pins[${i}].softZ must be a boolean`);
    out.push({ key: p.key, pos: [p.pos[0], p.pos[1], p.pos[2]], ...(p.softZ ? { softZ: true } : {}) });
  }
  return ok(out);
}

/** PinsPutBody. */
export function validatePinsBody(body: unknown): Validated<PinInput[]> {
  if (!isPlainObject(body)) return fail('body must be an object');
  return validatePins(body.pins);
}

/** Record<NodeKey, Vec3> (LayoutPutBody.positions or TasteMapExport.layout). */
export function validatePositions(v: unknown): Validated<Record<NodeKey, Vec3>> {
  if (!isPlainObject(v)) return fail('positions must be an object');
  const keys = Object.keys(v);
  if (keys.length > LIMITS.nodes) return fail(`too many positions (max ${LIMITS.nodes})`);
  const out: Record<NodeKey, Vec3> = {};
  for (const k of keys) {
    if (!isNodeKey(k)) return fail(`positions key ${JSON.stringify(String(k).slice(0, 80))} is not a node key`);
    const p = v[k];
    if (!isVec3(p)) return fail(`positions[${k}] must be 3 finite numbers within ±${LIMITS.coord}`);
    out[k] = [p[0], p[1], p[2]];
  }
  return ok(out);
}

/** LayoutPutBody. */
export function validateLayoutBody(body: unknown): Validated<Record<NodeKey, Vec3>> {
  if (!isPlainObject(body)) return fail('body must be an object');
  return validatePositions(body.positions);
}

// ── groups ───────────────────────────────────────────────────────────────────

export interface MemberInput {
  key: NodeKey;
  weight: number;
  manual: boolean;
}

/** One group's members (MembersPutBody.members / ExportGroup.members). `manual` defaults to false. */
export function validateMembers(v: unknown, where = 'members'): Validated<MemberInput[]> {
  if (!Array.isArray(v)) return fail(`${where} must be an array`);
  if (v.length > LIMITS.membersPerGroup) return fail(`${where}: too many members (max ${LIMITS.membersPerGroup})`);
  const seen = new Set<string>();
  const out: MemberInput[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = v[i];
    if (!isPlainObject(m)) return fail(`${where}[${i}] must be an object`);
    if (!isNodeKey(m.key)) return fail(`${where}[${i}].key is not a node key`);
    if (seen.has(m.key)) return fail(`${where}: duplicate member ${m.key}`);
    seen.add(m.key);
    if (!isWeight01(m.weight)) return fail(`${where}[${i}].weight must be a number from 0 to 1`);
    if (m.manual !== undefined && typeof m.manual !== 'boolean') return fail(`${where}[${i}].manual must be a boolean`);
    out.push({ key: m.key, weight: m.weight, manual: m.manual === true });
  }
  return ok(out);
}

/** Node keys whose summed weight across the given membership lists exceeds 1 (+eps). */
export function overweightNodes(lists: { key: NodeKey; weight: number }[][]): NodeKey[] {
  const sum = new Map<NodeKey, number>();
  for (const list of lists) for (const m of list) sum.set(m.key, (sum.get(m.key) ?? 0) + m.weight);
  return [...sum.entries()].filter(([, s]) => s > 1 + MEMBERSHIP_EPS).map(([k]) => k);
}

/**
 * ExportGroup[] (TasteMapExport.groups, GroupsAdoptBody.groups). `id` is any
 * 1–100 char string, unique in the list (an old uuid or a seed 'w:<world>' id;
 * callers map it to a fresh uuid). Names are trimmed. Checks the per-node sum.
 */
export function validateGroups(v: unknown): Validated<ExportGroup[]> {
  if (!Array.isArray(v)) return fail('groups must be an array');
  if (v.length > LIMITS.groups) return fail(`too many groups (max ${LIMITS.groups})`);
  const ids = new Set<string>();
  const out: ExportGroup[] = [];
  for (let i = 0; i < v.length; i++) {
    const g = v[i];
    if (!isPlainObject(g)) return fail(`groups[${i}] must be an object`);
    if (typeof g.id !== 'string' || g.id.length < 1 || g.id.length > 100) return fail(`groups[${i}].id must be a string of 1–100 characters`);
    if (ids.has(g.id)) return fail(`duplicate group id ${g.id}`);
    ids.add(g.id);
    if (!isGroupName(g.name)) return fail(`groups[${i}].name must be 1–${MAX_NAME_LENGTH} characters`);
    if (!isHexColor(g.color)) return fail(`groups[${i}].color must be #RRGGBB`);
    if (g.seedWorld !== null && g.seedWorld !== undefined && (typeof g.seedWorld !== 'string' || g.seedWorld.length > 100))
      return fail(`groups[${i}].seedWorld must be a string or null`);
    const members = validateMembers(g.members, `groups[${i}].members`);
    if (!members.ok) return members;
    out.push({
      id: g.id,
      name: g.name.trim(),
      color: g.color,
      seedWorld: typeof g.seedWorld === 'string' ? g.seedWorld : null,
      members: members.value,
    });
  }
  const over = overweightNodes(out.map((g) => g.members));
  if (over.length) return fail(`memberships of ${over[0]} sum to more than 1${over.length > 1 ? ` (and ${over.length - 1} more)` : ''}`);
  return ok(out);
}

// ── eras / metric ────────────────────────────────────────────────────────────

/** Split-before album ids for one artist: uuids, unique, ≤ LIMITS.splitsPerArtist. */
export function validateSplitIds(v: unknown, where = 'splitAlbumIds'): Validated<string[]> {
  if (!Array.isArray(v)) return fail(`${where} must be an array`);
  if (v.length > LIMITS.splitsPerArtist) return fail(`${where}: too many splits (max ${LIMITS.splitsPerArtist})`);
  if (!v.every(isUuid)) return fail(`${where} must contain only uuids`);
  if (new Set(v).size !== v.length) return fail(`${where} has duplicates`);
  return ok([...v]);
}

/** EraOverride[]: one per artist. */
export function validateEras(v: unknown): Validated<EraOverride[]> {
  if (!Array.isArray(v)) return fail('eras must be an array');
  if (v.length > LIMITS.nodes) return fail(`too many era overrides (max ${LIMITS.nodes})`);
  const seen = new Set<string>();
  const out: EraOverride[] = [];
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (!isPlainObject(e)) return fail(`eras[${i}] must be an object`);
    if (!isUuid(e.artistId)) return fail(`eras[${i}].artistId must be a uuid`);
    if (seen.has(e.artistId)) return fail(`duplicate era override for ${e.artistId}`);
    seen.add(e.artistId);
    const splits = validateSplitIds(e.splitAlbumIds, `eras[${i}].splitAlbumIds`);
    if (!splits.ok) return splits;
    out.push({ artistId: e.artistId, splitAlbumIds: splits.value });
  }
  return ok(out);
}

export type ExportMetric = NonNullable<TasteMapExport['metric']>;

/** TasteMapExport.metric: block weights for every block, tag weights keyed by tag-dim id (or null). */
export function validateMetric(v: unknown): Validated<ExportMetric | null> {
  if (v === null || v === undefined) return ok(null);
  if (!isPlainObject(v)) return fail('metric must be an object or null');
  if (!isPlainObject(v.block)) return fail('metric.block must be an object');
  const block = {} as Record<BlockName, number>;
  for (const b of BLOCKS) {
    const w = v.block[b];
    if (!isFiniteNumber(w) || w < 0 || w > MAX_METRIC_WEIGHT) return fail(`metric.block.${b} must be a number from 0 to ${MAX_METRIC_WEIGHT}`);
    block[b] = w;
  }
  const extra = Object.keys(v.block).find((k) => !(BLOCKS as readonly string[]).includes(k));
  if (extra) return fail(`metric.block has an unknown block ${JSON.stringify(extra.slice(0, 40))}`);
  let tagDims: Record<string, number> | null = null;
  if (v.tagDims !== null && v.tagDims !== undefined) {
    if (!isPlainObject(v.tagDims)) return fail('metric.tagDims must be an object keyed by tag id, or null');
    const keys = Object.keys(v.tagDims);
    if (keys.length > 20000) return fail('metric.tagDims has too many entries');
    tagDims = {};
    for (const k of keys) {
      const w = v.tagDims[k];
      if (k.length < 1 || k.length > 200) return fail('metric.tagDims keys must be 1–200 characters');
      if (!isFiniteNumber(w) || w < 0 || w > MAX_METRIC_WEIGHT) return fail(`metric.tagDims[${JSON.stringify(k.slice(0, 40))}] must be a number from 0 to ${MAX_METRIC_WEIGHT}`);
      tagDims[k] = w;
    }
  }
  return ok({ block, tagDims });
}

// ── whole export ─────────────────────────────────────────────────────────────

/** A TasteMapExport, validated in full. `lens` must equal `expectedLens` when given. */
export function validateExport(body: unknown, expectedLens?: string): Validated<TasteMapExport> {
  if (!isPlainObject(body)) return fail('body must be an object');
  if (body.kind !== 'sillajuku.tasteMap') return fail('not a taste map export (kind)');
  if (body.version !== 1) return fail(`unsupported export version ${JSON.stringify(body.version)}`);
  if (typeof body.lens !== 'string') return fail('lens must be a string');
  if (expectedLens !== undefined && body.lens !== expectedLens) return fail(`unsupported lens ${JSON.stringify(body.lens.slice(0, 40))}`);
  const pins = validatePins(body.pins);
  if (!pins.ok) return pins;
  const groups = validateGroups(body.groups);
  if (!groups.ok) return groups;
  const eras = validateEras(body.eras);
  if (!eras.ok) return eras;
  const metric = validateMetric(body.metric);
  if (!metric.ok) return metric;
  let layout: Record<NodeKey, Vec3> | null = null;
  if (body.layout !== null && body.layout !== undefined) {
    const l = validatePositions(body.layout);
    if (!l.ok) return fail(`layout: ${l.error}`);
    layout = l.value;
  }
  return ok({
    kind: 'sillajuku.tasteMap',
    version: 1,
    exportedAt: typeof body.exportedAt === 'string' ? body.exportedAt.slice(0, 64) : '',
    lens: body.lens,
    pins: pins.value,
    groups: groups.value,
    eras: eras.value,
    metric: metric.value,
    layout,
  });
}
