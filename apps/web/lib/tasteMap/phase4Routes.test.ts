/**
 * Handler tests for the Phase 4 Taste Map routes (groups, eras, metric, place)
 * against a MOCKED Supabase client that records every call. Never touches a
 * real database. Lives under lib/ because vitest.config.ts only includes
 * lib/**\/*.test.ts.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerClient } from '../supabaseServer';
import { getAuthedUserId } from '../authGuard';
import { loadArtistInputs, loadMapUserInput } from './load';
import { buildFeatureSpace, DEFAULT_BLOCK_WEIGHTS, DEFAULT_METRIC } from './features';
import { solveLayout } from './layout';
import { artistByName, COLDPLAY_MYLO_XYLOTO, COLDPLAY_SAFETY_EP, mergedInput, withoutArtist } from './phase4Fixtures';

vi.mock('../supabaseServer', () => ({ createServerClient: vi.fn() }));
vi.mock('../authGuard', () => ({ getAuthedUserId: vi.fn() }));
vi.mock('../rateLimit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('../cache', () => ({ cacheGet: vi.fn(async () => null), cacheSet: vi.fn(async () => undefined) }));
vi.mock('./load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./load')>()),
  loadMapUserInput: vi.fn(),
  loadArtistInputs: vi.fn(),
}));
// Lets a test force the leave-one-pin-out outcome; otherwise the real function runs.
const lopo = vi.hoisted(() => ({ value: null as null | { errBaseline: number; errLearned: number; n: number } }));
vi.mock('./metric', async (importOriginal) => {
  const real = await importOriginal<typeof import('./metric')>();
  return { ...real, leaveOnePinOut: (...args: Parameters<typeof real.leaveOnePinOut>) => lopo.value ?? real.leaveOnePinOut(...args) };
});
// access.ts allowlists real profile ids; route tests run as USER, so stand in for it.
const access = vi.hoisted(() => ({ open: false, allow: new Set<string>(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) }));
vi.mock('./access', async (importOriginal) => {
  const real = await importOriginal<typeof import('./access')>();
  const allowed = (id: string | null | undefined) => !!id && access.allow.has(id);
  return {
    ...real,
    isTasteMapAllowlisted: allowed,
    canSeeTasteMap: (id: string | null | undefined) => access.open || allowed(id),
    requiredRatedAlbums: (id: string | null | undefined) => (allowed(id) ? real.HARD_FLOOR_RATED_ALBUMS : real.MIN_RATED_ALBUMS),
  };
});

import { POST as createGroup } from '../../app/api/taste/map/groups/route';
import { PATCH as patchGroup, DELETE as deleteGroup } from '../../app/api/taste/map/groups/[id]/route';
import { PUT as putMembers } from '../../app/api/taste/map/groups/[id]/members/route';
import { POST as adoptGroups } from '../../app/api/taste/map/groups/adopt/route';
import { GET as getEras, PUT as putEras } from '../../app/api/taste/map/eras/[artistId]/route';
import { GET as getMetric, POST as fitMetricRoute } from '../../app/api/taste/map/metric/route';
import { GET as placeRoute } from '../../app/api/taste/map/place/route';

// ── fake Supabase ────────────────────────────────────────────────────────────

type Method = 'select' | 'insert' | 'update' | 'upsert' | 'delete';
interface Call {
  table: string;
  method: Method;
  columns?: string;
  payload?: unknown;
  opts?: unknown;
  filters: [string, ...unknown[]][];
  single?: 'single' | 'maybe';
}
type Result = { data?: unknown; error?: unknown; count?: number | null };
type Responder = (c: Call) => Result | undefined;

const WRITES: Method[] = ['insert', 'update', 'upsert', 'delete'];

function fakeDb(responder: Responder) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, method: 'select', filters: [] };
    calls.push(call);
    const b: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'upsert', 'delete'] as const)
      b[m] = (payload?: unknown, opts?: unknown) => {
        call.method = m;
        call.payload = payload;
        call.opts = opts;
        return b;
      };
    b.select = (columns?: string, opts?: unknown) => {
      if (call.method === 'select') {
        call.columns = columns;
        call.opts = opts;
      }
      return b;
    };
    for (const f of ['eq', 'neq', 'in', 'or', 'not', 'order', 'range', 'limit'])
      b[f] = (...args: unknown[]) => {
        call.filters.push([f, ...args]);
        return b;
      };
    b.single = () => ((call.single = 'single'), b);
    b.maybeSingle = () => ((call.single = 'maybe'), b);
    b.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, count: null, ...(responder(call) ?? {}) }).then(res, rej);
    return b;
  };
  const writes = () => calls.filter((c) => WRITES.includes(c.method));
  return { db: { from }, calls, writes };
}

const eqOf = (c: Call, col: string) => c.filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2];

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MY_GROUP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MY_GROUP_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ARTIST = '11111111-1111-4111-8111-111111111111';
const KEY = `a:${ARTIST}`;

function req(url: string, method = 'GET', body?: unknown, auth = true): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { ...(auth ? { Authorization: 'Bearer test' } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

let fake: ReturnType<typeof fakeDb>;
function useDb(responder: Responder) {
  fake = fakeDb(responder);
  vi.mocked(createServerClient).mockReturnValue(fake.db as never);
}

beforeEach(() => {
  vi.mocked(getAuthedUserId).mockImplementation(async (h) => (h?.startsWith('Bearer ') ? USER : null));
  vi.mocked(loadMapUserInput).mockReset();
  vi.mocked(loadArtistInputs).mockReset();
  lopo.value = null;
  useDb(() => undefined);
});

// ── auth ─────────────────────────────────────────────────────────────────────

describe('auth', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['POST groups', () => createGroup(req('/api/taste/map/groups', 'POST', { name: 'x', color: '#000000' }, false))],
    ['PATCH group', () => patchGroup(req('/x', 'PATCH', { name: 'x' }, false), { params: { id: MY_GROUP } })],
    ['DELETE group', () => deleteGroup(req('/x', 'DELETE', undefined, false), { params: { id: MY_GROUP } })],
    ['PUT members', () => putMembers(req('/x', 'PUT', { members: [] }, false), { params: { id: MY_GROUP } })],
    ['POST adopt', () => adoptGroups(req('/x', 'POST', { groups: [] }, false))],
    ['GET eras', () => getEras(req('/x', 'GET', undefined, false), { params: { artistId: ARTIST } })],
    ['PUT eras', () => putEras(req('/x', 'PUT', { splitAlbumIds: null }, false), { params: { artistId: ARTIST } })],
    ['GET metric', () => getMetric(req('/x', 'GET', undefined, false))],
    ['POST metric', () => fitMetricRoute(req('/x', 'POST', {}, false))],
    ['GET place', () => placeRoute(req(`/x?artistId=${ARTIST}`, 'GET', undefined, false))],
  ];
  it.each(cases)('%s → 401 without a bearer token, no DB call', async (_, run) => {
    const res = await run();
    expect(res.status).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });
});

// ── groups ───────────────────────────────────────────────────────────────────

describe('groups', () => {
  it('creates a group scoped to the user', async () => {
    useDb((c) => {
      if (c.method === 'select') return { count: 2 };
      if (c.method === 'insert') return { data: { id: MY_GROUP, name: 'Britpop', color: '#112233', seed_world: null } };
    });
    const res = await createGroup(req('/x', 'POST', { name: '  Britpop ', color: '#112233' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ group: { id: MY_GROUP, name: 'Britpop', color: '#112233', seedWorld: null } });
    const ins = fake.writes()[0];
    expect(ins.payload).toEqual({ user_id: USER, name: 'Britpop', color: '#112233', seed_world: null });
    expect(eqOf(fake.calls[0], 'user_id')).toBe(USER);
  });

  it('400 on bad input, 409 at the group limit', async () => {
    for (const body of [{ name: '', color: '#112233' }, { name: 'x', color: 'blue' }, { name: 'x'.repeat(61), color: '#112233' }, 'not json'])
      expect((await createGroup(req('/x', 'POST', body))).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
    useDb(() => ({ count: 40 }));
    expect((await createGroup(req('/x', 'POST', { name: 'x', color: '#112233' }))).status).toBe(409);
    expect(fake.writes()).toHaveLength(0);
  });

  it('PATCH / DELETE another user’s group → 404 and no write', async () => {
    // The ownership read is scoped by user_id, so another user's group comes back empty.
    useDb((c) => (c.method === 'select' && eqOf(c, 'user_id') === USER && eqOf(c, 'id') === MY_GROUP ? { data: { id: MY_GROUP } } : undefined));
    expect((await patchGroup(req('/x', 'PATCH', { name: 'Mine now' }), { params: { id: OTHER_GROUP } })).status).toBe(404);
    expect((await deleteGroup(req('/x', 'DELETE'), { params: { id: OTHER_GROUP } })).status).toBe(404);
    expect(fake.writes()).toHaveLength(0);
    expect(fake.calls.every((c) => eqOf(c, 'user_id') === USER)).toBe(true);
  });

  it('PATCH / DELETE own group write with id AND user_id filters', async () => {
    useDb((c) => {
      if (c.method === 'select') return { data: { id: MY_GROUP } };
      if (c.method === 'update') return { data: { id: MY_GROUP, name: 'New', color: '#000000', seed_world: 'rock' } };
    });
    const res = await patchGroup(req('/x', 'PATCH', { name: 'New', user_id: 'evil' }), { params: { id: MY_GROUP } });
    expect(res.status).toBe(200);
    expect((await res.json()).group).toEqual({ id: MY_GROUP, name: 'New', color: '#000000', seedWorld: 'rock' });
    expect((await deleteGroup(req('/x', 'DELETE'), { params: { id: MY_GROUP } })).status).toBe(200);
    const [upd, del] = fake.writes();
    expect(upd.payload).toEqual({ name: 'New' });
    for (const w of [upd, del]) {
      expect(eqOf(w, 'id')).toBe(MY_GROUP);
      expect(eqOf(w, 'user_id')).toBe(USER);
    }
  });

  it('400 for a non-uuid id and an empty patch', async () => {
    expect((await patchGroup(req('/x', 'PATCH', { name: 'x' }), { params: { id: 'nope' } })).status).toBe(400);
    expect((await patchGroup(req('/x', 'PATCH', {}), { params: { id: MY_GROUP } })).status).toBe(400);
  });
});

describe('group members', () => {
  const groupsRead = (c: Call) =>
    c.table === 'taste_map_groups' && c.method === 'select'
      ? {
          data: [
            { id: MY_GROUP, taste_map_members: [{ node_key: `a:${OTHER_GROUP}`, weight: 0.5 }] },
            { id: MY_GROUP_2, taste_map_members: [{ node_key: KEY, weight: 0.7 }] },
          ],
        }
      : undefined;

  it('404 for a group the user doesn’t own', async () => {
    useDb(groupsRead);
    const res = await putMembers(req('/x', 'PUT', { members: [{ key: KEY, weight: 0.1 }] }), { params: { id: OTHER_GROUP } });
    expect(res.status).toBe(404);
    expect(fake.writes()).toHaveLength(0);
    expect(eqOf(fake.calls[0], 'user_id')).toBe(USER);
  });

  it('rejects a node whose weights across ALL groups would sum > 1', async () => {
    useDb(groupsRead);
    const res = await putMembers(req('/x', 'PUT', { members: [{ key: KEY, weight: 0.4 }] }), { params: { id: MY_GROUP } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/sum to ≤ 1/);
    expect(fake.writes()).toHaveLength(0);
  });

  it('replaces members: upserts the new set, prunes the old', async () => {
    useDb(groupsRead);
    const res = await putMembers(req('/x', 'PUT', { members: [{ key: KEY, weight: 0.3 }] }), { params: { id: MY_GROUP } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 1 });
    const [up, del] = fake.writes();
    expect(up.method).toBe('upsert');
    expect(up.payload).toEqual([{ group_id: MY_GROUP, node_key: KEY, weight: 0.3, manual: true }]);
    expect(del.method).toBe('delete');
    expect(eqOf(del, 'group_id')).toBe(MY_GROUP);
    expect(del.filters.find((f) => f[0] === 'in')).toEqual(['in', 'node_key', [`a:${OTHER_GROUP}`]]);
  });

  it('400 on bad member input', async () => {
    useDb(groupsRead);
    for (const members of [[{ key: KEY, weight: 2 }], [{ key: 'x', weight: 0.5 }], 'nope'])
      expect((await putMembers(req('/x', 'PUT', { members }), { params: { id: MY_GROUP } })).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
  });
});

describe('adopt', () => {
  const body = {
    groups: [
      { id: 'w:rock', name: 'Rock', color: '#E4572E', seedWorld: 'rock', members: [{ key: KEY, weight: 0.6 }] },
      { id: 'w:pop', name: 'Pop', color: '#4C9F70', seedWorld: 'pop', members: [{ key: KEY, weight: 0.4 }] },
    ],
  };

  it('409 when the user already has stored groups', async () => {
    useDb(() => ({ count: 1 }));
    const res = await adoptGroups(req('/x', 'POST', body));
    expect(res.status).toBe(409);
    expect(fake.writes()).toHaveLength(0);
  });

  it('materializes seeds and returns idMap', async () => {
    useDb(() => ({ count: 0 }));
    const res = await adoptGroups(req('/x', 'POST', body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json.idMap)).toEqual(['w:rock', 'w:pop']);
    const [gIns, mIns] = fake.writes();
    expect((gIns.payload as { user_id: string }[]).every((r) => r.user_id === USER)).toBe(true);
    expect((gIns.payload as { id: string }[]).map((r) => r.id)).toEqual([json.idMap['w:rock'], json.idMap['w:pop']]);
    expect(mIns.payload).toEqual([
      { group_id: json.idMap['w:rock'], node_key: KEY, weight: 0.6, manual: false },
      { group_id: json.idMap['w:pop'], node_key: KEY, weight: 0.4, manual: false },
    ]);
    expect(json.groups[0]).toEqual({ id: json.idMap['w:rock'], name: 'Rock', color: '#E4572E', seedWorld: 'rock' });
  });

  it('400 when seed memberships sum over 1', async () => {
    useDb(() => ({ count: 0 }));
    const bad = { groups: body.groups.map((g) => ({ ...g, members: [{ key: KEY, weight: 0.6 }] })) };
    expect((await adoptGroups(req('/x', 'POST', bad))).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
  });
});

// ── eras ─────────────────────────────────────────────────────────────────────

describe('eras', () => {
  const full = mergedInput();
  const coldplay = artistByName(full, 'Coldplay');
  const oasis = artistByName(full, 'Oasis');
  const ctx = { params: { artistId: coldplay.id } };

  beforeEach(() => vi.mocked(loadArtistInputs).mockResolvedValue([coldplay]));

  it('GET returns the discography, override and auto', async () => {
    useDb((c) => (c.table === 'taste_map_eras' ? { data: { split_rg_ids: [COLDPLAY_MYLO_XYLOTO] } } : undefined));
    const res = await getEras(req('/x'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.artistId).toBe(coldplay.id);
    expect(json.albums).toHaveLength(coldplay.albums.length);
    expect(json.override).toEqual([COLDPLAY_MYLO_XYLOTO]);
    expect(json.auto).toEqual([]);
    expect(vi.mocked(loadArtistInputs).mock.calls[0][1]).toEqual([coldplay.id]);
    expect(vi.mocked(loadArtistInputs).mock.calls[0][2]).toMatchObject({ userId: USER });
    expect(eqOf(fake.calls[0], 'user_id')).toBe(USER);
    expect(fake.writes()).toHaveLength(0);
  });

  it('PUT rejects another artist’s album and the first album', async () => {
    for (const id of [oasis.albums[0].id, COLDPLAY_SAFETY_EP]) {
      const res = await putEras(req('/x', 'PUT', { splitAlbumIds: [id] }), ctx);
      expect(res.status).toBe(400);
    }
    expect(fake.writes()).toHaveLength(0);
  });

  it('PUT splits Coldplay before Mylo Xyloto (manual upsert scoped to the user)', async () => {
    const res = await putEras(req('/x', 'PUT', { splitAlbumIds: [COLDPLAY_MYLO_XYLOTO] }), ctx);
    expect(res.status).toBe(200);
    const [up] = fake.writes();
    expect(up.method).toBe('upsert');
    expect(up.payload).toMatchObject({ user_id: USER, artist_id: coldplay.id, split_rg_ids: [COLDPLAY_MYLO_XYLOTO], manual: true });
  });

  it('PUT [] merges, PUT null deletes the user’s row only', async () => {
    expect((await putEras(req('/x', 'PUT', { splitAlbumIds: [] }), ctx)).status).toBe(200);
    expect((await putEras(req('/x', 'PUT', { splitAlbumIds: null }), ctx)).status).toBe(200);
    const [up, del] = fake.writes();
    expect((up.payload as { split_rg_ids: string[] }).split_rg_ids).toEqual([]);
    expect(del.method).toBe('delete');
    expect(eqOf(del, 'user_id')).toBe(USER);
    expect(eqOf(del, 'artist_id')).toBe(coldplay.id);
  });

  it('404 for an unknown artist, 400 for bad ids', async () => {
    vi.mocked(loadArtistInputs).mockResolvedValue([]);
    expect((await getEras(req('/x'), ctx)).status).toBe(404);
    expect((await putEras(req('/x', 'PUT', { splitAlbumIds: [COLDPLAY_MYLO_XYLOTO] }), ctx)).status).toBe(404);
    expect((await getEras(req('/x'), { params: { artistId: 'nope' } })).status).toBe(400);
    expect((await putEras(req('/x', 'PUT', { splitAlbumIds: ['nope'] }), ctx)).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
  });
});

// ── metric + place (real fixtures through the real pure functions) ───────────

const full = mergedInput();
const fullSpace = buildFeatureSpace(full);
const fullLayout = solveLayout(fullSpace, { weights: DEFAULT_METRIC });
const keys = fullSpace.nodes.map((n) => n.key).sort();

function storedStateResponder(opts: { layout?: unknown; pins?: string[]; metric?: unknown }): Responder {
  return (c) => {
    if (c.method !== 'select') return undefined;
    if (eqOf(c, 'user_id') !== USER) return { data: null, error: { message: 'unscoped query' } };
    switch (c.table) {
      case 'taste_map_eras':
        return { data: [] };
      case 'taste_map_pins':
        return { data: (opts.pins ?? []).map((k) => ({ node_key: k, x: fullLayout.positions[k][0], y: fullLayout.positions[k][1], z: fullLayout.positions[k][2] })) };
      case 'taste_map_groups':
        return { data: [] };
      case 'taste_map_layouts':
        return { data: opts.layout === undefined ? { positions: fullLayout.positions } : opts.layout };
      case 'taste_map_metric':
        return { data: opts.metric ?? null };
    }
  };
}

describe('metric', () => {
  beforeEach(() => vi.mocked(loadMapUserInput).mockResolvedValue(full));

  it('keeps (and stores) the DEFAULT weights when learned doesn’t win', async () => {
    lopo.value = { errBaseline: 0.29, errLearned: 0.31, n: 6 };
    useDb(storedStateResponder({ pins: keys.slice(0, 6) }));
    const res = await fitMetricRoute(req('/x', 'POST', {}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kept).toBe('unit');
    expect(json.reason).toBe('Learned weights didn’t beat the default weights (0.31 vs 0.29 map units), so the map keeps the default weights.');
    expect(json.eval).toEqual({ errBaseline: 0.29, errLearned: 0.31, n: 6 });
    expect(json.nTriplets).toBeGreaterThan(0);
    const [up] = fake.writes();
    expect(up.table).toBe('taste_map_metric');
    expect(up.payload).toMatchObject({ user_id: USER, lens: 'sound', block_w: DEFAULT_BLOCK_WEIGHTS, dim_w: null });
    expect((up.payload as { eval: { kept: string } }).eval.kept).toBe('unit');
  });

  it('stores learned weights keyed by tag-dim id when they win', async () => {
    lopo.value = { errBaseline: 0.4, errLearned: 0.3, n: 6 };
    useDb(storedStateResponder({ pins: keys.slice(0, 6) }));
    const json = await (await fitMetricRoute(req('/x', 'POST', {}))).json();
    expect(json.kept).toBe('learned');
    expect(json.reason).toBe('Learned weights place your pins 25% closer than the default weights, so the map now uses them.');
    const up = fake.writes()[0].payload as { dim_w: Record<string, number>; n_triplets: number; fitted_at: string };
    expect(Object.keys(up.dim_w).sort()).toEqual(fullSpace.tagDims.map((d) => d.id).sort());
    expect(up.n_triplets).toBe(json.nTriplets);
    expect(up.fitted_at).toBe(json.fittedAt);
  });

  it('keeps the default with fewer than 3 pins (real eval)', async () => {
    useDb(storedStateResponder({ pins: keys.slice(0, 2) }));
    const json = await (await fitMetricRoute(req('/x', 'POST', {}))).json();
    expect(json.kept).toBe('unit');
    expect(json.eval.n).toBe(2);
    expect((fake.writes()[0].payload as { block_w: unknown }).block_w).toEqual(DEFAULT_BLOCK_WEIGHTS);
  });

  it('uses body.positions when sent; 400 on bad positions; 409 without any layout', async () => {
    useDb(storedStateResponder({ layout: null, pins: keys.slice(0, 4) }));
    expect((await fitMetricRoute(req('/x', 'POST', {}))).status).toBe(409);
    expect((await fitMetricRoute(req('/x', 'POST', { positions: { [keys[0]]: [0, 0] } }))).status).toBe(400);
    expect((await fitMetricRoute(req('/x', 'POST', { positions: { bad: [0, 0, 0] } }))).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
    const res = await fitMetricRoute(req('/x', 'POST', { positions: fullLayout.positions }));
    expect(res.status).toBe(200);
  });

  it('GET returns { stored: null } or the stored fit', async () => {
    useDb(() => ({ data: null }));
    expect(await (await getMetric(req('/x'))).json()).toEqual({ stored: null });
    lopo.value = { errBaseline: 0.29, errLearned: 0.31, n: 6 };
    useDb(storedStateResponder({ pins: keys.slice(0, 6) }));
    const posted = await (await fitMetricRoute(req('/x', 'POST', {}))).json();
    const row = fake.writes()[0].payload as Record<string, unknown>;
    useDb((c) => (c.table === 'taste_map_metric' && eqOf(c, 'user_id') === USER ? { data: row } : undefined));
    expect(await (await getMetric(req('/x'))).json()).toEqual(posted);
  });
});

describe('place', () => {
  const { input, candidate } = withoutArtist(full, 'Coldplay');

  it('is read-only and returns a PlaceResponse', async () => {
    vi.mocked(loadMapUserInput).mockResolvedValue(input);
    vi.mocked(loadArtistInputs).mockResolvedValue([candidate]);
    useDb(storedStateResponder({ pins: keys.slice(0, 3), metric: { block_w: { tags: 2 }, dim_w: null } }));
    const res = await placeRoute(req(`/x?artistId=${candidate.id}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.artistId).toBe(candidate.id);
    expect(json.label).toBe('Coldplay');
    expect(json.pos).toHaveLength(3);
    expect(json.anchors.length).toBeGreaterThan(0);
    expect(json.explanation).toMatch(/^Placed near /);
    expect(fake.writes()).toHaveLength(0);
    expect(fake.calls.every((c) => c.method === 'select')).toBe(true);
    // The candidate is loaded unrated (no userId).
    expect(vi.mocked(loadArtistInputs).mock.calls[0][2]).toBeUndefined();
  });

  it('409 with its key when the artist is already on the map', async () => {
    vi.mocked(loadMapUserInput).mockResolvedValue(full);
    useDb(storedStateResponder({}));
    const res = await placeRoute(req(`/x?artistId=${candidate.id}`));
    expect(res.status).toBe(409);
    expect((await res.json()).key).toBe(`a:${candidate.id}`);
    expect(fake.writes()).toHaveLength(0);
  });

  it('409 without a stored layout, 400 for a bad id', async () => {
    vi.mocked(loadMapUserInput).mockResolvedValue(input);
    vi.mocked(loadArtistInputs).mockResolvedValue([candidate]);
    useDb(storedStateResponder({ layout: null }));
    const res = await placeRoute(req(`/x?artistId=${candidate.id}`));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/open the map first/);
    expect((await placeRoute(req('/x?artistId=nope'))).status).toBe(400);
    expect(fake.writes()).toHaveLength(0);
  });
});
