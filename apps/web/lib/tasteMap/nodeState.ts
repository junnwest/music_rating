/**
 * taste_map_node_state (migration 20261105000000): what the user decided for a
 * ghost node (ghostApi.ts). Every query takes the authed user id and filters on
 * it: the routes use the service-role client, which bypasses RLS.
 *
 * The table may not exist yet (migration not applied): reads then return no
 * states (`available: false`) and the map is classified from data alone;
 * writes return a 503-style error the routes pass on. Logged once.
 *
 * Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NODE_STATE_VALUES, type NodeAnswer, type NodeState, type NodeStateValue } from './ghostApi';
import type { NodeKey } from './types';

export const NODE_STATE_TABLE = 'taste_map_node_state';

interface DbError {
  code?: string;
  message?: string;
}

/** PostgREST PGRST205 / Postgres 42P01: the table isn't there (migration not applied). */
export function isMissingTableError(error: DbError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|relation .* does not exist/i.test(error.message ?? '')
  );
}

let warned = false;
function warnMissing(): void {
  if (warned) return;
  warned = true;
  console.warn(`[taste-map] ${NODE_STATE_TABLE} is missing (migration 20261105000000 not applied); ghost choices are not stored`);
}
/** Test hook. */
export function _resetNodeStateWarning(): void {
  warned = false;
}

function parseAnswer(raw: unknown): NodeAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const at = typeof o.at === 'string' ? o.at : '';
  if (typeof o.genreId === 'string' && o.genreId) {
    const ids = Array.isArray(o.catalogRgIds) ? o.catalogRgIds.filter((x): x is string => typeof x === 'string') : undefined;
    return { genreId: o.genreId, at, ...(ids?.length ? { catalogRgIds: ids } : {}) };
  }
  if (o.none === true) return { none: true, at };
  return null;
}

function parseState(raw: unknown): NodeStateValue | null {
  return typeof raw === 'string' && (NODE_STATE_VALUES as readonly string[]).includes(raw) ? (raw as NodeStateValue) : null;
}

/** The user's node states by key. Never throws: a missing table or a read error → empty. */
export async function loadNodeStates(
  db: SupabaseClient,
  userId: string,
): Promise<{ data: Map<NodeKey, NodeState>; available: boolean }> {
  const { data, error } = await db.from(NODE_STATE_TABLE).select('node_key, state, answer').eq('user_id', userId);
  if (error) {
    if (isMissingTableError(error)) warnMissing();
    else console.error('[taste-map] node state read failed:', error.message);
    return { data: new Map(), available: !isMissingTableError(error) };
  }
  const out = new Map<NodeKey, NodeState>();
  for (const r of (data ?? []) as { node_key: string; state: unknown; answer: unknown }[]) {
    const st: NodeState = { state: parseState(r.state), answer: parseAnswer(r.answer) };
    if (st.state || st.answer) out.set(r.node_key, st);
  }
  return { data: out, available: true };
}

export type WriteResult = { ok: true } | { ok: false; missing: boolean; message: string };

function fail(error: DbError): WriteResult {
  const missing = isMissingTableError(error);
  if (missing) warnMissing();
  return { ok: false, missing, message: error.message ?? 'error' };
}

async function readRow(db: SupabaseClient, userId: string, key: NodeKey) {
  return db.from(NODE_STATE_TABLE).select('state, answer').eq('user_id', userId).eq('node_key', key).maybeSingle();
}

/**
 * Set (or with null, clear) the user's choice for a node, keeping its answer.
 * A row left with neither a state nor an answer is deleted.
 */
export async function setNodeState(db: SupabaseClient, userId: string, key: NodeKey, state: NodeStateValue | null): Promise<WriteResult> {
  if (state === null) {
    const cur = await readRow(db, userId, key);
    if (cur.error) return fail(cur.error);
    const answer = parseAnswer((cur.data as { answer?: unknown } | null)?.answer);
    if (!cur.data) return { ok: true };
    const { error } = answer
      ? await db
          .from(NODE_STATE_TABLE)
          .update({ state: null, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('node_key', key)
      : await db.from(NODE_STATE_TABLE).delete().eq('user_id', userId).eq('node_key', key);
    return error ? fail(error) : { ok: true };
  }
  const { error } = await db
    .from(NODE_STATE_TABLE)
    .upsert({ user_id: userId, node_key: key, state, updated_at: new Date().toISOString() }, { onConflict: 'user_id,node_key' });
  return error ? fail(error) : { ok: true };
}

/** The user's current answer for a node (to find catalog rows a re-answer may replace). */
export async function getNodeAnswer(db: SupabaseClient, userId: string, key: NodeKey): Promise<{ answer: NodeAnswer | null; error: WriteResult | null }> {
  const cur = await readRow(db, userId, key);
  if (cur.error) return { answer: null, error: fail(cur.error) };
  return { answer: parseAnswer((cur.data as { answer?: unknown } | null)?.answer), error: null };
}

/** Store the user's answer for a node, keeping its state. */
export async function setNodeAnswer(db: SupabaseClient, userId: string, key: NodeKey, answer: NodeAnswer): Promise<WriteResult> {
  const { error } = await db
    .from(NODE_STATE_TABLE)
    .upsert({ user_id: userId, node_key: key, answer, updated_at: new Date().toISOString() }, { onConflict: 'user_id,node_key' });
  return error ? fail(error) : { ok: true };
}

/** Stable digest input for the payload hash: [key, state, answer id / 'none'] sorted. */
export function nodeStateHashPart(states: ReadonlyMap<NodeKey, NodeState>): [string, string | null, string | null][] {
  return [...states.entries()]
    .map(([k, s]): [string, string | null, string | null] => [
      k,
      s.state,
      s.answer ? ('genreId' in s.answer ? s.answer.genreId : 'none') : null,
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** node key → answered genre id (FeatureOptions.answers). */
export function answersOf(states: ReadonlyMap<NodeKey, NodeState>): Record<NodeKey, string> {
  const out: Record<NodeKey, string> = {};
  for (const [k, s] of states) if (s.answer && 'genreId' in s.answer) out[k] = s.answer.genreId;
  return out;
}
