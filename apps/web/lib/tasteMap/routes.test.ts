/**
 * Route-handler tests for the Phase 3 Taste Map write routes, against a fake
 * Supabase client (fakeDb.testutil.ts). Nothing here reaches a real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeDb, hasFilter, isWrite, rowsOf, type FakeCall, type Responder } from './fakeDb.testutil';
import { LIMITS, type ImportResponse, type TasteMapExport } from './apiTypes';
import { validateExport } from './validate';
import { _resetSoftZWarning } from './store';

const state = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }));
vi.mock('../supabaseServer', () => ({ createServerClient: () => state.db }));
vi.mock('../authGuard', () => ({ getAuthedUserId: async () => state.userId }));
vi.mock('../rateLimit', () => ({ rateLimit: async () => null }));
vi.mock('../cache', () => ({ cacheGet: async () => null, cacheSet: async () => undefined, cacheDel: async () => undefined }));

import { PUT as putPins } from '../../app/api/taste/map/pins/route';
import { PUT as putLayout } from '../../app/api/taste/map/layout/route';
import { GET as getExport } from '../../app/api/taste/map/export/route';
import { POST as postImport } from '../../app/api/taste/map/import/route';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const A3 = '33333333-3333-4333-8333-333333333333';
const R1 = '44444444-4444-4444-8444-444444444444';
const k1 = `a:${A1}`;
const k2 = `a:${A2}`;
const k3 = `a:${A3}`;
const kE = `e:${A1}:${R1}`;

let calls: FakeCall[] = [];
function useDb(respond?: Responder): void {
  const f = fakeDb(respond);
  state.db = f.db as SupabaseClient;
  calls = f.calls;
}

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { Authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
    body: text,
  });
}

/** Every query touching a user table is scoped to USER; members belong to `groupIds`. */
function expectScoped(groupIds: Set<string> = new Set()): void {
  for (const c of calls) {
    if (c.table === 'artists') {
      expect(c.op).toBe('select');
      continue;
    }
    if (c.op === 'insert' || c.op === 'upsert') {
      for (const row of rowsOf(c)) {
        if (c.table === 'taste_map_members') expect(groupIds.has(row.group_id as string)).toBe(true);
        else expect(row.user_id).toBe(USER);
      }
    } else {
      expect(hasFilter(c, 'eq', 'user_id', USER), `${c.op} ${c.table} not scoped`).toBe(true);
    }
  }
  expect(JSON.stringify(calls)).not.toContain(OTHER);
}

beforeEach(() => {
  state.userId = USER;
  useDb();
  _resetSoftZWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ── pins ─────────────────────────────────────────────────────────────────────

describe('PUT /api/taste/map/pins', () => {
  it('401 without a user, before touching the db', async () => {
    state.userId = null;
    const res = await putPins(req('/api/taste/map/pins', 'PUT', { pins: [] }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['not JSON', '{nope'],
    ['no pins', {}],
    ['pins not an array', { pins: {} }],
    ['bad key', { pins: [{ key: 'a:123', pos: [0, 0, 0] }] }],
    ['short pos', { pins: [{ key: k1, pos: [0, 0] }] }],
    ['huge coord', { pins: [{ key: k1, pos: [0, 0, 1000] }] }],
    ['non-number coord', { pins: [{ key: k1, pos: [0, 0, null] }] }],
    ['softZ not boolean', { pins: [{ key: k1, pos: [0, 0, 0], softZ: 1 }] }],
    ['duplicate keys', { pins: [{ key: k1, pos: [0, 0, 0] }, { key: k1, pos: [1, 1, 1] }] }],
    ['too many', { pins: Array.from({ length: LIMITS.nodes + 1 }, () => ({ key: k1, pos: [0, 0, 0] })) }],
  ])('400 on %s, with no db calls', async (_name, body) => {
    const res = await putPins(req('/api/taste/map/pins', 'PUT', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('413 on an oversized body', async () => {
    const res = await putPins(req('/api/taste/map/pins', 'PUT', { pins: [] }, { 'content-length': '5000000' }));
    expect(res.status).toBe(413);
  });

  it('replaces the pin set, scoped to the authed user', async () => {
    useDb((c) =>
      c.table === 'taste_map_pins' && c.op === 'select' ? { data: [{ node_key: k1 }, { node_key: k2 }, { node_key: k3 }] } : undefined,
    );
    const body = {
      user_id: OTHER,
      pins: [
        { key: k2, pos: [0.1, 0.2, 0.3], user_id: OTHER },
        { key: kE, pos: [1, 1, 1], softZ: true },
      ],
    };
    const res = await putPins(req('/api/taste/map/pins', 'PUT', body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2 });

    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('taste_map_pins');
    expect(del.filters).toContainEqual(['in', 'node_key', [k1, k3]]);
    const up = calls.find((c) => c.op === 'upsert')!;
    expect(rowsOf(up).map((r) => [r.node_key, r.x, r.y, r.z, r.soft_z])).toEqual([
      [k2, 0.1, 0.2, 0.3, false],
      [kE, 1, 1, 1, true],
    ]);
    // Order: prune first, then upsert.
    expect(calls.indexOf(del)).toBeLessThan(calls.indexOf(up));
    expectScoped();
  });

  it('an empty set deletes every pin and upserts nothing', async () => {
    useDb((c) => (c.op === 'select' ? { data: [{ node_key: k1 }] } : undefined));
    const res = await putPins(req('/api/taste/map/pins', 'PUT', { pins: [] }));
    expect(res.status).toBe(200);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
    expect(calls.find((c) => c.op === 'delete')!.filters).toContainEqual(['in', 'node_key', [k1]]);
    expectScoped();
  });

  it('falls back without soft_z when the column is missing (PGRST204)', async () => {
    useDb((c) => {
      if (c.op === 'upsert' && rowsOf(c).some((r) => 'soft_z' in r))
        return { error: { code: 'PGRST204', message: "Could not find the 'soft_z' column of 'taste_map_pins' in the schema cache" } };
      return undefined;
    });
    const res = await putPins(req('/api/taste/map/pins', 'PUT', { pins: [{ key: k1, pos: [0, 0, 0], softZ: true }] }));
    expect(res.status).toBe(200);
    const ups = calls.filter((c) => c.op === 'upsert');
    expect(ups).toHaveLength(2);
    expect(rowsOf(ups[1]).every((r) => !('soft_z' in r) && r.user_id === USER)).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expectScoped();
  });

  it('500 on another db error (no retry)', async () => {
    useDb((c) => (c.op === 'upsert' ? { error: { code: '23514', message: 'check violation' } } : undefined));
    const res = await putPins(req('/api/taste/map/pins', 'PUT', { pins: [{ key: k1, pos: [0, 0, 0] }] }));
    expect(res.status).toBe(500);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });
});

// ── layout ───────────────────────────────────────────────────────────────────

describe('PUT /api/taste/map/layout', () => {
  it('401 without a user', async () => {
    state.userId = null;
    expect((await putLayout(req('/api/taste/map/layout', 'PUT', { positions: { [k1]: [0, 0, 0] } }))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['no positions', {}],
    ['array', { positions: [] }],
    ['empty', { positions: {} }],
    ['bad key', { positions: { nope: [0, 0, 0] } }],
    ['bad coord', { positions: { [k1]: [0, 0, 101] } }],
  ])('400 on %s', async (_n, body) => {
    expect((await putLayout(req('/api/taste/map/layout', 'PUT', body))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('upserts a user-arranged (version 2) layout for the authed user', async () => {
    const res = await putLayout(req('/api/taste/map/layout', 'PUT', { user_id: OTHER, positions: { [k1]: [0, 0, 0], [kE]: [1, 0.5, -0.5] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2 });
    expect(calls).toHaveLength(1);
    const row = rowsOf(calls[0])[0];
    expect(calls[0].table).toBe('taste_map_layouts');
    expect(row).toMatchObject({ user_id: USER, lens: 'sound', dims: 3, version: 2, positions: { [k1]: [0, 0, 0], [kE]: [1, 0.5, -0.5] } });
    expect(typeof row.solved_at).toBe('string');
    expectScoped();
  });
});

// ── export ───────────────────────────────────────────────────────────────────

const G1 = '55555555-5555-4555-8555-555555555555';

function exportResponder(opts: { softZColumn?: boolean; dimW?: unknown } = {}): Responder {
  return (c) => {
    if (c.op !== 'select') return undefined;
    switch (c.table) {
      case 'taste_map_pins':
        if (opts.softZColumn === false && c.cols?.includes('soft_z'))
          return { error: { code: '42703', message: 'column taste_map_pins.soft_z does not exist' } };
        return { data: [{ node_key: k1, x: 0.1, y: 0.2, z: 0.3, ...(opts.softZColumn === false ? {} : { soft_z: true }) }] };
      case 'taste_map_groups':
        return {
          data: [{ id: G1, name: 'Rock', color: '#123456', seed_world: null, created_at: 'x', taste_map_members: [{ node_key: k1, weight: 0.5, manual: true }] }],
        };
      case 'taste_map_eras':
        return { data: [{ artist_id: A1, split_rg_ids: [R1] }] };
      case 'taste_map_metric':
        return { data: { block_w: { tags: 2, text: 1, graph: 1, era: 0.5 }, dim_w: opts.dimW ?? { rock: 1.5 } } };
      case 'taste_map_layouts':
        return { data: { positions: { [k1]: [0, 0, 0], [kE]: [1, 1, 1] } } };
    }
    return undefined;
  };
}

describe('GET /api/taste/map/export', () => {
  it('401 without a user', async () => {
    state.userId = null;
    expect((await getExport(req('/api/taste/map/export', 'GET'))).status).toBe(401);
  });

  it('returns a valid TasteMapExport as an attachment', async () => {
    useDb(exportResponder());
    const res = await getExport(req('/api/taste/map/export', 'GET'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="taste-map-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = (await res.json()) as TasteMapExport;
    expect(validateExport(body, 'sound').ok).toBe(true);
    expect(body.pins).toEqual([{ key: k1, pos: [0.1, 0.2, 0.3], softZ: true }]);
    expect(body.groups).toEqual([{ id: G1, name: 'Rock', color: '#123456', seedWorld: null, members: [{ key: k1, weight: 0.5, manual: true }] }]);
    expect(body.eras).toEqual([{ artistId: A1, splitAlbumIds: [R1] }]);
    expect(body.metric).toEqual({ block: { tags: 2, text: 1, graph: 1, era: 0.5 }, tagDims: { rock: 1.5 } });
    expect(body.layout).toEqual({ [k1]: [0, 0, 0], [kE]: [1, 1, 1] });
    expect(calls.every((c) => c.op === 'select')).toBe(true);
    expectScoped();
  });

  it('exports an index-array dim_w as null and works without the soft_z column', async () => {
    useDb(exportResponder({ softZColumn: false, dimW: [1.2, 0.8] }));
    const body = (await (await getExport(req('/api/taste/map/export', 'GET'))).json()) as TasteMapExport;
    expect(body.metric?.tagDims).toBeNull();
    expect(body.pins).toEqual([{ key: k1, pos: [0.1, 0.2, 0.3] }]);
    expectScoped();
  });
});

// ── import ───────────────────────────────────────────────────────────────────

const OLD_GROUP = '66666666-6666-4666-8666-666666666666';
const OLD_ERA_ARTIST = '77777777-7777-4777-8777-777777777777';

function goodExport(): TasteMapExport {
  return {
    kind: 'sillajuku.tasteMap',
    version: 1,
    exportedAt: '2026-11-03T00:00:00.000Z',
    lens: 'sound',
    pins: [
      { key: k1, pos: [0.1, 0.2, 0.3], softZ: true },
      { key: k2, pos: [0, 0, 0] },
    ],
    groups: [
      // An id from another account: must never be written as-is.
      { id: OTHER, name: 'Britpop', color: '#AABBCC', seedWorld: null, members: [{ key: k1, weight: 0.6, manual: true }, { key: k2, weight: 1, manual: false }] },
      { id: 'w:rock', name: 'Rock', color: '#112233', seedWorld: 'rock', members: [{ key: k1, weight: 0.4, manual: false }] },
    ],
    eras: [{ artistId: A1, splitAlbumIds: [R1] }],
    metric: { block: { tags: 1, text: 1, graph: 1, era: 0.5 }, tagDims: { rock: 1.2 } },
    layout: { [k1]: [0, 0, 0], [kE]: [1, -1, 0.5] },
  };
}

function importResponder(over: Responder = () => undefined): Responder {
  return (c) => {
    const o = over(c);
    if (o) return o;
    if (c.op !== 'select') return undefined;
    if (c.table === 'taste_map_groups') return { data: [{ id: OLD_GROUP }] };
    if (c.table === 'taste_map_eras') return { data: [{ artist_id: OLD_ERA_ARTIST }, { artist_id: A1 }] };
    if (c.table === 'taste_map_pins') return { data: [{ node_key: k3 }] };
    if (c.table === 'artists') return { data: [{ id: A1 }] };
    return undefined;
  };
}

describe('POST /api/taste/map/import', () => {
  it('401 without a user', async () => {
    state.userId = null;
    expect((await postImport(req('/api/taste/map/import', 'POST', goodExport()))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('413 over 2 MB', async () => {
    expect((await postImport(req('/api/taste/map/import', 'POST', goodExport(), { 'content-length': '2000001' }))).status).toBe(413);
    const padded = { ...goodExport(), exportedAt: 'x'.repeat(2_100_000) };
    expect((await postImport(req('/api/taste/map/import', 'POST', padded))).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  const mutations: [string, (e: TasteMapExport & Record<string, unknown>) => void][] = [
    ['wrong kind', (e) => ((e as Record<string, unknown>).kind = 'x')],
    ['wrong version', (e) => ((e as Record<string, unknown>).version = 2)],
    ['other lens', (e) => (e.lens = 'mood')],
    ['bad color', (e) => (e.groups[0].color = '#12345')],
    ['empty name', (e) => (e.groups[0].name = '')],
    ['61-char name', (e) => (e.groups[0].name = 'x'.repeat(61))],
    ['weight > 1', (e) => (e.groups[0].members[0].weight = 1.01)],
    ['membership sum > 1', (e) => (e.groups[1].members[0].weight = 0.5)],
    ['era artist not a uuid', (e) => (e.eras[0].artistId = 'coldplay')],
    ['split id not a uuid', (e) => (e.eras[0].splitAlbumIds = ['first'])],
    ['bad pin key', (e) => (e.pins[0].key = 'a:nope')],
    ['bad layout coord', (e) => (e.layout![k1] = [0, 0, 500])],
    ['metric weight negative', (e) => (e.metric!.block.tags = -1)],
    ['too many groups', (e) => (e.groups = Array.from({ length: LIMITS.groups + 1 }, (_, i) => ({ ...e.groups[0], id: `g${i}`, members: [] })))],
  ];
  it.each(mutations)('400 on %s, before any db call', async (_n, mut) => {
    useDb(importResponder());
    const e = goodExport() as TasteMapExport & Record<string, unknown>;
    mut(e);
    const res = await postImport(req('/api/taste/map/import', 'POST', e));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('replaces everything, with fresh group ids, scoped to the authed user', async () => {
    useDb(importResponder());
    const res = await postImport(req('/api/taste/map/import', 'POST', { ...goodExport(), user_id: OTHER }));
    expect(res.status).toBe(200);
    const out = (await res.json()) as ImportResponse;
    expect(out).toEqual({ ok: true, counts: { pins: 2, groups: 2, members: 3, eras: 1, metric: 1, layout: 1 } });

    const gIns = calls.find((c) => c.table === 'taste_map_groups' && c.op === 'insert')!;
    const newIds = new Set(rowsOf(gIns).map((r) => r.id as string));
    expect(newIds.size).toBe(2);
    expect(newIds.has(OTHER)).toBe(false);
    expect(newIds.has('w:rock')).toBe(false);
    for (const id of newIds) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rowsOf(gIns).map((r) => [r.name, r.seed_world])).toEqual([
      ['Britpop', null],
      ['Rock', 'rock'],
    ]);
    const mIns = calls.find((c) => c.table === 'taste_map_members' && c.op === 'insert')!;
    expect(rowsOf(mIns)).toHaveLength(3);

    // Pins: k3 pruned, both file pins upserted.
    const pinDel = calls.find((c) => c.table === 'taste_map_pins' && c.op === 'delete')!;
    expect(pinDel.filters).toContainEqual(['in', 'node_key', [k3]]);
    expect(rowsOf(calls.find((c) => c.table === 'taste_map_pins' && c.op === 'upsert')!).map((r) => r.node_key)).toEqual([k1, k2]);

    // Eras: A1 upserted, the old artist pruned.
    const eraUp = calls.find((c) => c.table === 'taste_map_eras' && c.op === 'upsert')!;
    expect(rowsOf(eraUp)).toEqual([expect.objectContaining({ user_id: USER, artist_id: A1, split_rg_ids: [R1], manual: true })]);
    expect(calls.find((c) => c.table === 'taste_map_eras' && c.op === 'delete')!.filters).toContainEqual(['in', 'artist_id', [OLD_ERA_ARTIST]]);

    // Metric + layout.
    expect(rowsOf(calls.find((c) => c.table === 'taste_map_metric' && c.op === 'upsert')!)[0]).toMatchObject({
      user_id: USER,
      lens: 'sound',
      block_w: { tags: 1, text: 1, graph: 1, era: 0.5 },
      dim_w: { rock: 1.2 },
    });
    expect(rowsOf(calls.find((c) => c.table === 'taste_map_layouts')!)[0]).toMatchObject({ user_id: USER, version: 2, lens: 'sound' });

    // Old groups go last.
    const gDel = calls.find((c) => c.table === 'taste_map_groups' && c.op === 'delete')!;
    expect(gDel.filters).toContainEqual(['in', 'id', [OLD_GROUP]]);
    expect(calls.indexOf(gDel)).toBe(calls.length - 1);
    expect(calls.findIndex(isWrite)).toBe(calls.indexOf(gIns));

    expectScoped(newIds);
  });

  it('skips eras for artists not in the catalog and deletes the metric when the file has none', async () => {
    useDb(importResponder((c) => (c.table === 'artists' ? { data: [] } : undefined)));
    const e = { ...goodExport(), metric: null, layout: null };
    const out = (await (await postImport(req('/api/taste/map/import', 'POST', e))).json()) as ImportResponse;
    expect(out.counts).toMatchObject({ eras: 0, metric: 0, layout: 0 });
    expect(calls.some((c) => c.table === 'taste_map_eras' && c.op === 'upsert')).toBe(false);
    const mDel = calls.find((c) => c.table === 'taste_map_metric' && c.op === 'delete')!;
    expect(hasFilter(mDel, 'eq', 'lens', 'sound')).toBe(true);
    expect(calls.some((c) => c.table === 'taste_map_layouts')).toBe(false);
    expectScoped(new Set(rowsOf(calls.find((c) => c.table === 'taste_map_groups' && c.op === 'insert')!).map((r) => r.id as string)));
  });

  it('a failed member insert removes the new groups and writes nothing else', async () => {
    useDb(importResponder((c) => (c.table === 'taste_map_members' ? { error: { message: 'boom' } } : undefined)));
    const res = await postImport(req('/api/taste/map/import', 'POST', goodExport()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/group members/);
    const writes = calls.filter(isWrite);
    expect(writes.map((c) => `${c.op} ${c.table}`)).toEqual(['insert taste_map_groups', 'insert taste_map_members', 'delete taste_map_groups']);
    const newIds = rowsOf(writes[0]).map((r) => r.id);
    expect(writes[2].filters).toContainEqual(['in', 'id', newIds]);
    expectScoped(new Set(newIds as string[]));
  });

  it('round-trips an export', async () => {
    useDb(exportResponder());
    const exported = await (await getExport(req('/api/taste/map/export', 'GET'))).json();
    useDb(importResponder());
    const res = await postImport(req('/api/taste/map/import', 'POST', exported));
    expect(res.status).toBe(200);
  });
});
