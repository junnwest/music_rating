/**
 * Browser client for the Taste Map write routes (contract: apiTypes.ts).
 * Every call sends the Supabase session's access token as
 * `Authorization: Bearer`, like /taste/map's GET. Errors throw a
 * `TasteMapApiError` carrying the route's `{ error }` message and status.
 */
import { supabase } from '../supabaseClient';
import type {
  EraGetResponse,
  EraPutBody,
  GroupCreateBody,
  GroupPatchBody,
  GroupsAdoptBody,
  ImportResponse,
  LayoutPutBody,
  MembersPutBody,
  MetricFitBody,
  MetricFitResponse,
  OkResponse,
  PinsPutBody,
  PlaceResponse,
  TasteMapExport,
} from './apiTypes';
import type { NodeKey, TasteMapGroup, TasteMapPayload } from './types';
import type { NearbyResponse } from './nearby';
import type { AnswerPostBody, AnswerPostResponse, NodeStatePutBody, NodeStatePutResponse, QuestionsResponse } from './ghostApi';

const BASE = '/api/taste/map';

export class TasteMapApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The parsed JSON error body, for routes that return more than `error` (place's 409 `{ key, keys }`). */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'TasteMapApiError';
  }
}

/**
 * Dev only: a stand-in bearer token for `?fixture=…&api=1`, where there is no
 * session but the write routes are intercepted (playwright). Ignored outside
 * development; a real route answers it with 401, so nothing can be written.
 */
let devToken: string | null = null;
export function setDevToken(token: string | null): void {
  devToken = process.env.NODE_ENV === 'development' ? token : null;
}

async function accessToken(): Promise<string> {
  if (devToken) return devToken;
  if (!supabase) throw new TasteMapApiError('not configured', 0);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new TasteMapApiError('signed out', 401);
  return token;
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page (proxy, crash); fall through to the status.
  }
  if (!res.ok) {
    const msg = (json as { error?: unknown } | null)?.error;
    throw new TasteMapApiError(typeof msg === 'string' && msg ? msg : `HTTP ${res.status}`, res.status, json);
  }
  return json as T;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function fetchMap(opts: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<TasteMapPayload> {
  return call('GET', opts.refresh ? '?refresh=1' : '', undefined, opts.signal);
}

// ── Phase 3: pins, layout, export/import ─────────────────────────────────────

export function savePins(body: PinsPutBody, signal?: AbortSignal): Promise<OkResponse> {
  return call('PUT', '/pins', body, signal);
}

export function saveLayout(body: LayoutPutBody, signal?: AbortSignal): Promise<OkResponse> {
  return call('PUT', '/layout', body, signal);
}

export function exportMap(signal?: AbortSignal): Promise<TasteMapExport> {
  return call('GET', '/export', undefined, signal);
}

export function importMap(body: TasteMapExport, signal?: AbortSignal): Promise<ImportResponse> {
  return call('POST', '/import', body, signal);
}

// ── Phase 4: groups ──────────────────────────────────────────────────────────

export function createGroup(body: GroupCreateBody): Promise<{ group: TasteMapGroup }> {
  return call('POST', '/groups', body);
}

export function patchGroup(id: string, body: GroupPatchBody): Promise<{ group: TasteMapGroup }> {
  return call('PATCH', `/groups/${encodeURIComponent(id)}`, body);
}

export function deleteGroup(id: string): Promise<OkResponse> {
  return call('DELETE', `/groups/${encodeURIComponent(id)}`);
}

export function putGroupMembers(id: string, body: MembersPutBody): Promise<OkResponse> {
  return call('PUT', `/groups/${encodeURIComponent(id)}/members`, body);
}

export function adoptGroups(body: GroupsAdoptBody): Promise<{ groups: TasteMapGroup[]; idMap: Record<string, string> }> {
  return call('POST', '/groups/adopt', body);
}

// ── Phase 4: eras, metric, placement ─────────────────────────────────────────

export function getEras(artistId: string): Promise<EraGetResponse> {
  return call('GET', `/eras/${encodeURIComponent(artistId)}`);
}

export function putEras(artistId: string, body: EraPutBody): Promise<OkResponse> {
  return call('PUT', `/eras/${encodeURIComponent(artistId)}`, body);
}

export function getMetric(): Promise<MetricFitResponse | { stored: null }> {
  return call('GET', '/metric');
}

export function fitMetric(body: MetricFitBody = {}): Promise<MetricFitResponse> {
  return call('POST', '/metric', body);
}

export function placeArtist(artistId: string): Promise<PlaceResponse> {
  return call('GET', `/place?artistId=${encodeURIComponent(artistId)}`);
}

/** "What's here?": unrated catalog albums near the given nodes (keys + kernel weights, focus.ts hereQuery). */
export function fetchNearby(q: { keys: NodeKey[]; w: number[] }, signal?: AbortSignal): Promise<NearbyResponse> {
  const qs = `keys=${encodeURIComponent(q.keys.join(','))}&w=${encodeURIComponent(q.w.join(','))}`;
  return call('GET', `/nearby?${qs}`, undefined, signal);
}

/**
 * Whether this page can call the map API (the rule app/(main)/taste/map/page.tsx
 * uses): not in `?mock=1` / `?fixture=` mode, unless dev `?api=1`. For views
 * that don't receive the `api` prop.
 */
export function mapApiEnabled(search: string = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  const p = new URLSearchParams(search);
  const local = p.get('mock') === '1' || (process.env.NODE_ENV === 'development' && !!p.get('fixture'));
  return !local || (process.env.NODE_ENV === 'development' && p.get('api') === '1');
}

// ── Ghost nodes (thin.ts, ghostApi.ts) ───────────────────────────────────────

export function putNodeState(body: NodeStatePutBody): Promise<NodeStatePutResponse> {
  return call('PUT', '/node-state', body);
}

export function getQuestions(signal?: AbortSignal): Promise<QuestionsResponse> {
  return call('GET', '/questions', undefined, signal);
}

export function postAnswer(body: AnswerPostBody): Promise<AnswerPostResponse> {
  return call('POST', '/questions', body);
}

// ── Export file helpers ──────────────────────────────────────────────────────

/** Client-side shape check before an import confirm (the route validates fully). */
export function parseExportFile(text: string): { ok: true; data: TasteMapExport } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const d = data as Partial<TasteMapExport> | null;
  if (!d || typeof d !== 'object' || d.kind !== 'sillajuku.tasteMap') return { ok: false, reason: 'not a taste map export' };
  if (d.version !== 1) return { ok: false, reason: `unsupported version ${String(d.version)}` };
  if (!Array.isArray(d.pins) || !Array.isArray(d.groups) || !Array.isArray(d.eras)) return { ok: false, reason: 'missing pins, groups or eras' };
  return { ok: true, data: d as TasteMapExport };
}

/** Save a JSON value as a file download. */
export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
