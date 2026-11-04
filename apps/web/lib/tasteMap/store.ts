/**
 * Server-side DB helpers shared by the Taste Map routes and payload.ts.
 *
 * The routes use the service-role client, which bypasses RLS, so every query
 * here takes the authed user id and filters on it: that filter IS the security.
 *
 * soft_z (migration 20261104000000) may not be applied yet. Pin reads and writes
 * try it first and, on an undefined-column error, retry without it and drop
 * softZ (soft pins become hard pins until the migration lands). Logged once.
 *
 * Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PinInput } from './apiTypes';
import type { NodeKey, Vec3 } from './types';

interface DbError {
  code?: string;
  message?: string;
}

/** Chunk size for `.in()` filters, which go in the URL (keys are ~40–80 chars). */
export const IN_CHUNK = 50;

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Postgres 42703 (undefined column) on a select/filter, or PostgREST PGRST204
 * ("Could not find the 'x' column of 't' in the schema cache") on a write.
 * With `column`, the message must name it when it names any column.
 */
export function isMissingColumnError(error: DbError | null | undefined, column?: string): boolean {
  if (!error) return false;
  const msg = error.message ?? '';
  const looks =
    error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(msg);
  if (!looks) return false;
  return !column || !msg || msg.includes(column);
}

let warnedSoftZ = false;
function warnSoftZ(): void {
  if (warnedSoftZ) return;
  warnedSoftZ = true;
  console.warn('[taste-map] taste_map_pins.soft_z is missing (migration 20261104000000 not applied); softZ is dropped');
}
/** Test hook. */
export function _resetSoftZWarning(): void {
  warnedSoftZ = false;
}

export interface StoredPin {
  key: NodeKey;
  pos: Vec3;
  softZ: boolean;
}

/** The user's pins, with softZ when the column exists (false otherwise). */
export async function selectPins(
  db: SupabaseClient,
  userId: string,
): Promise<{ data: StoredPin[]; error: DbError | null; softZSupported: boolean }> {
  type Row = { node_key: string; x: number; y: number; z: number | null; soft_z?: boolean | null };
  const toPin = (r: Row): StoredPin => ({ key: r.node_key, pos: [r.x, r.y, r.z ?? 0], softZ: r.soft_z === true });
  const first = await db.from('taste_map_pins').select('node_key, x, y, z, soft_z').eq('user_id', userId);
  if (!first.error) return { data: ((first.data ?? []) as Row[]).map(toPin), error: null, softZSupported: true };
  if (!isMissingColumnError(first.error, 'soft_z')) return { data: [], error: first.error, softZSupported: true };
  warnSoftZ();
  const second = await db.from('taste_map_pins').select('node_key, x, y, z').eq('user_id', userId);
  return { data: ((second.data ?? []) as Row[]).map(toPin), error: second.error ?? null, softZSupported: false };
}

/** Delete `table` rows of this user whose `column` is in `values` (chunked). */
export async function deleteUserRowsIn(
  db: SupabaseClient,
  table: string,
  userId: string,
  column: string,
  values: string[],
): Promise<DbError | null> {
  for (const part of chunk(values, IN_CHUNK)) {
    const { error } = await db.from(table).delete().eq('user_id', userId).in(column, part);
    if (error) return error;
  }
  return null;
}

/**
 * Replace the user's whole pin set: delete their pins not in `pins`, then upsert
 * the rest. Every row and filter carries `userId`.
 */
export async function replacePins(
  db: SupabaseClient,
  userId: string,
  pins: PinInput[],
): Promise<{ error: DbError | null; softZDropped: boolean }> {
  const existing = await db.from('taste_map_pins').select('node_key').eq('user_id', userId);
  if (existing.error) return { error: existing.error, softZDropped: false };
  const keep = new Set(pins.map((p) => p.key));
  const stale = ((existing.data ?? []) as { node_key: string }[]).map((r) => r.node_key).filter((k) => !keep.has(k));
  const delErr = await deleteUserRowsIn(db, 'taste_map_pins', userId, 'node_key', stale);
  if (delErr) return { error: delErr, softZDropped: false };
  if (!pins.length) return { error: null, softZDropped: false };

  const now = new Date().toISOString();
  const rows = pins.map((p) => ({
    user_id: userId,
    node_key: p.key,
    x: p.pos[0],
    y: p.pos[1],
    z: p.pos[2],
    soft_z: p.softZ === true,
    pinned_at: now,
  }));
  const first = await db.from('taste_map_pins').upsert(rows, { onConflict: 'user_id,node_key' });
  if (!first.error) return { error: null, softZDropped: false };
  if (!isMissingColumnError(first.error, 'soft_z')) return { error: first.error, softZDropped: false };
  warnSoftZ();
  const legacy = rows.map(({ soft_z: _drop, ...r }) => r);
  const second = await db.from('taste_map_pins').upsert(legacy, { onConflict: 'user_id,node_key' });
  return { error: second.error ?? null, softZDropped: pins.some((p) => p.softZ) };
}

/** Upsert the user's layout for `lens` as user-arranged (version 2, see payload.ts). */
export async function saveArrangedLayout(
  db: SupabaseClient,
  userId: string,
  lens: string,
  positions: Record<NodeKey, Vec3>,
): Promise<DbError | null> {
  const { error } = await db.from('taste_map_layouts').upsert(
    {
      user_id: userId,
      lens,
      positions,
      dims: 3,
      version: 2,
      input_hash: null,
      solved_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,lens' },
  );
  return error ?? null;
}

// ── request bodies ───────────────────────────────────────────────────────────

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

/** Read a JSON body, refusing anything over `maxBytes` (Content-Length first, then the actual size). */
export async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, error: 'body too large' };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: 'could not read body' };
  }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: 'body too large' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'body is not valid JSON' };
  }
}
