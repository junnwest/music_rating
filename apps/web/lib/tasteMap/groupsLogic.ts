/**
 * Pure logic for the Taste Map group routes (TASTE_MAP_PLAN.md D7, Phase 4):
 * body parsing for create / patch / members / adopt, and the soft-membership
 * rule that a node's weights across ALL of a user's groups sum to ≤ 1.
 *
 * The routes (app/api/taste/map/groups/**) do the DB reads and writes; every
 * decision about what is allowed lives here so it is unit-testable.
 */
import type { ExportGroup, GroupCreateBody, GroupPatchBody } from './apiTypes';
import type { NodeKey } from './types';
import { MEMBERSHIP_EPS, validateGroups, validateMembers, type MemberInput } from './validate';
import { isPlainObject, parseColor, parseName, type Parsed } from './validatePhase4';

export type { MemberInput } from './validate';

/** A stored membership row (taste_map_members) for the sum check. */
export interface MemberRow {
  groupId: string;
  key: NodeKey;
  weight: number;
}

export function parseGroupCreate(body: unknown): Parsed<GroupCreateBody> {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const name = parseName(body.name);
  if (!name.ok) return name;
  const color = parseColor(body.color);
  if (!color.ok) return color;
  return { ok: true, value: { name: name.value, color: color.value } };
}

export function parseGroupPatch(body: unknown): Parsed<GroupPatchBody> {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const out: GroupPatchBody = {};
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name.ok) return name;
    out.name = name.value;
  }
  if (body.color !== undefined) {
    const color = parseColor(body.color);
    if (!color.ok) return color;
    out.color = color.value;
  }
  if (out.name === undefined && out.color === undefined) return { ok: false, error: 'nothing to update (name or color)' };
  return { ok: true, value: out };
}

/**
 * MembersPutBody. A PUT is the user's own edit, so a member without `manual`
 * is stored as manual = true (validate.ts's default, false, is for seeds/imports).
 */
export function parseMembersPut(body: unknown): Parsed<MemberInput[]> {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const res = validateMembers(body.members);
  if (!res.ok) return res;
  const raw = body.members as Record<string, unknown>[];
  return { ok: true, value: res.value.map((m, i) => ({ ...m, manual: raw[i].manual === undefined ? true : m.manual })) };
}

/**
 * Node keys whose total weight would exceed 1 (+ eps) if `groupId`'s members
 * were replaced by `next`. `existing` is every member row of the user's groups;
 * rows of `groupId` itself are ignored (they are being replaced).
 */
export function membershipOverflows(
  existing: readonly MemberRow[],
  groupId: string,
  next: readonly { key: NodeKey; weight: number }[],
): { key: NodeKey; sum: number }[] {
  const sums = new Map<NodeKey, number>();
  for (const r of existing) if (r.groupId !== groupId) sums.set(r.key, (sums.get(r.key) ?? 0) + Number(r.weight));
  const out: { key: NodeKey; sum: number }[] = [];
  for (const m of next) {
    const s = (sums.get(m.key) ?? 0) + m.weight;
    if (s > 1 + MEMBERSHIP_EPS) out.push({ key: m.key, sum: s });
  }
  return out;
}

export function overflowError(over: { key: NodeKey; sum: number }[]): string {
  const first = over
    .slice(0, 3)
    .map((o) => `${o.key} (${o.sum.toFixed(3)})`)
    .join(', ');
  return `a node's weights across your groups must sum to ≤ 1; over for ${over.length} node(s): ${first}`;
}

/**
 * GroupsAdoptBody: 1..LIMITS.groups seed groups (validate.ts validateGroups:
 * unique ids, names, colors, members, per-node sums ≤ 1 across the set). Seed
 * members keep their `manual` flag (default false: the seed assigned them).
 */
export function parseAdopt(body: unknown): Parsed<ExportGroup[]> {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const res = validateGroups(body.groups);
  if (!res.ok) return res;
  if (!res.value.length) return { ok: false, error: 'groups must not be empty' };
  return res;
}
