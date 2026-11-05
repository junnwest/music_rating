/**
 * Ghost-node routes (PUT /api/taste/map/node-state, GET/POST
 * /api/taste/map/questions) against a fake Supabase client. load.ts and the
 * genre writer are mocked; nothing reaches a real database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeDb, hasFilter, rowsOf, type FakeCall, type Responder } from './fakeDb.testutil';
import { _resetNodeStateWarning } from './nodeState';
import type { MapAlbumInput, MapArtistInput, MapUserInput } from './types';

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as unknown,
  input: null as unknown,
  catalogArtists: [] as unknown[],
  written: [] as { source: string; items: { releaseGroupId: string; tags: { tag: string }[] }[] }[],
}));
vi.mock('../supabaseServer', () => ({ createServerClient: () => state.db }));
vi.mock('../authGuard', () => ({ getAuthedUserId: async () => state.userId }));
vi.mock('../rateLimit', () => ({ rateLimit: async () => null }));
vi.mock('./load', () => ({
  loadMapUserInput: async () => state.input,
  loadArtistInputs: async (_db: unknown, ids: string[]) =>
    (state.catalogArtists as MapArtistInput[]).filter((a) => ids.includes(a.id)),
}));
vi.mock('../genres/sourceWriter', () => ({
  writeSourceGenres: async (_db: unknown, source: string, items: { releaseGroupId: string; tags: { tag: string }[] }[]) => {
    state.written.push({ source, items });
    return { releaseGroups: items.length, upserted: items.length, deleted: 0, unmappedStaged: 0, unchanged: 0 };
  },
}));

import { PUT as putNodeState } from '../../app/api/taste/map/node-state/route';
import { GET as getQuestions, POST as postAnswer } from '../../app/api/taste/map/questions/route';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THIN = uuid(900);
const thinKey = `a:${THIN}`;
const RG = { mbTagged: uuid(901), store: uuid(902), blank: uuid(903), oldTags: uuid(904) };

function album(id: string, artistId: string, genres: string[], extra: Partial<MapAlbumInput> = {}): MapAlbumInput {
  return { id, title: `T ${id.slice(-3)}`, artistId, year: 2016, genres, titleLanguage: 'ko', type: 'album', coverUrl: null, embedding: null, score: 4, rated: true, ...extra };
}
function makeInput(): MapUserInput {
  const GENRES = [['k-rap'], ['korean indie', 'folk'], ['k-r&b']];
  const artists: MapArtistInput[] = Array.from({ length: 12 }, (_, i) => {
    const id = uuid(i + 1);
    return {
      id,
      name: `Artist ${i}`,
      nameNative: null,
      country: 'KR',
      genreEvidence: null,
      similar: [{ source: 'lastfm', items: [{ name: `Artist ${(i + 3) % 12}`, mbid: null, artistId: uuid(((i + 3) % 12) + 1), match: 0.8 }] }],
      albums: [album(uuid(100 + i), id, GENRES[i % 3], { genreSources: ['musicbrainz'] })],
    };
  });
  // The thin one: only an iTunes store genre, no listener graph.
  artists.push({
    id: THIN,
    name: '이상순',
    nameNative: null,
    country: 'KR',
    genreEvidence: { itunes: { id: 1, genres: [['K-Pop', 2], ['R&B/Soul', 1]], albums: { [RG.store]: 'K-Pop' } } },
    similar: [],
    albums: [
      album(RG.store, THIN, ['k-pop'], { genreSources: ['itunes'] }),
      album(RG.mbTagged, THIN, ['folk'], { rated: false, score: null, genreSources: ['itunes'] }),
      album(RG.blank, THIN, [], { rated: false, score: null }),
    ],
  });
  return { userId: USER, username: 'zero', artists };
}
/** What the catalog read sees for 이상순: plus an album whose display tags predate release_genres (no rows). */
function withOldTags(a: MapArtistInput): MapArtistInput {
  return a.id === THIN ? { ...a, albums: [...a.albums, album(RG.oldTags, THIN, ['folk'], { rated: false, score: null })] } : a;
}

let calls: FakeCall[] = [];
interface Rows {
  username?: string;
  nodeState?: Record<string, unknown>[];
  nodeStateMissing?: boolean;
  /** release_genres sources per rg. */
  genres?: Record<string, string[]>;
}
function useDb(rows: Rows = {}): void {
  const respond: Responder = (c) => {
    if (c.table === 'taste_map_node_state') {
      if (rows.nodeStateMissing) return { error: { code: 'PGRST205', message: "Could not find the table 'public.taste_map_node_state'" } };
      if (c.op === 'select') {
        const key = c.filters.find((f) => f[0] === 'eq' && f[1] === 'node_key')?.[2];
        const list = (rows.nodeState ?? []).filter((r) => key === undefined || r.node_key === key);
        return { data: c.single ? (list[0] ?? null) : list };
      }
      return undefined;
    }
    if (c.table === 'profiles') return { data: { username: rows.username ?? 'zero' } };
    if (c.table === 'release_genres' && c.op === 'select') {
      const ids = (c.filters.find((f) => f[0] === 'in')?.[2] ?? []) as string[];
      return { data: ids.flatMap((id) => (rows.genres?.[id] ?? []).map((source) => ({ release_group_id: id, source }))) };
    }
    return undefined;
  };
  const f = fakeDb(respond);
  state.db = f.db as SupabaseClient;
  calls = f.calls;
}

function req(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { Authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Every node-state query is scoped to USER. */
function expectScoped(): void {
  for (const c of calls.filter((c) => c.table === 'taste_map_node_state')) {
    if (c.op === 'upsert') for (const r of rowsOf(c)) expect(r.user_id).toBe(USER);
    else expect(hasFilter(c, 'eq', 'user_id', USER), `${c.op} not scoped`).toBe(true);
  }
  expect(JSON.stringify(calls)).not.toContain(OTHER);
}

beforeEach(() => {
  state.userId = USER;
  state.input = makeInput();
  state.catalogArtists = makeInput().artists.map(withOldTags);
  state.written = [];
  useDb();
  _resetNodeStateWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('PUT /api/taste/map/node-state', () => {
  it('401 without a session', async () => {
    state.userId = null;
    expect((await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: 'hidden' }))).status).toBe(401);
  });

  it('400 on a bad key or state', async () => {
    expect((await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: 'nope', state: 'hidden' }))).status).toBe(400);
    expect((await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: 'gone' }))).status).toBe(400);
    expect((await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey }))).status).toBe(400);
  });

  it('upserts the choice for this user only', async () => {
    const res = await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: 'hidden' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: thinKey, state: 'hidden' });
    const up = calls.find((c) => c.op === 'upsert')!;
    expect(rowsOf(up)[0]).toMatchObject({ user_id: USER, node_key: thinKey, state: 'hidden' });
    expect(rowsOf(up)[0]).not.toHaveProperty('answer');
    expectScoped();
  });

  it('clearing deletes a row without an answer, and keeps one with an answer', async () => {
    useDb({ nodeState: [{ node_key: thinKey, state: 'hidden', answer: null }] });
    await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: null }));
    expect(calls.some((c) => c.op === 'delete')).toBe(true);
    expectScoped();

    useDb({ nodeState: [{ node_key: thinKey, state: 'hidden', answer: { genreId: 'folk', at: 'x' } }] });
    await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: null }));
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    expect(calls.find((c) => c.op === 'update')!.payload).toMatchObject({ state: null });
    expectScoped();
  });

  it('503 when the migration is not applied', async () => {
    useDb({ nodeStateMissing: true });
    expect((await putNodeState(req('/api/taste/map/node-state', 'PUT', { key: thinKey, state: 'hidden' }))).status).toBe(503);
  });
});

describe('GET /api/taste/map/questions', () => {
  it('asks about the thin ghost, with candidates from its evidence', async () => {
    const res = await getQuestions(req('/api/taste/map/questions', 'GET'));
    expect(res.status).toBe(200);
    const { questions } = await res.json();
    expect(questions.map((q: { key: string }) => q.key)).toEqual([thinKey]);
    const q = questions[0];
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.options.length).toBeLessThanOrEqual(4);
    expect(q.prompt).toMatch(/^Is 이상순 closer to .+\?$/);
    expectScoped();
  });

  it('skips a hidden or already answered ghost, and works without the table', async () => {
    useDb({ nodeState: [{ node_key: thinKey, state: 'hidden', answer: null }] });
    expect((await (await getQuestions(req('/api/taste/map/questions', 'GET'))).json()).questions).toEqual([]);
    useDb({ nodeState: [{ node_key: thinKey, state: null, answer: { none: true, at: 'x' } }] });
    expect((await (await getQuestions(req('/api/taste/map/questions', 'GET'))).json()).questions).toEqual([]);
    useDb({ nodeStateMissing: true });
    expect((await (await getQuestions(req('/api/taste/map/questions', 'GET'))).json()).questions).toHaveLength(1);
  });
});

describe('POST /api/taste/map/questions', () => {
  const genres = { [RG.mbTagged]: ['itunes', 'musicbrainz'], [RG.store]: ['itunes'] };

  it('400 on an unknown genre, a scene root, or both fields', async () => {
    expect((await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'not-a-genre' }))).status).toBe(400);
    expect((await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'korean' }))).status).toBe(400);
    expect((await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'folk', none: true }))).status).toBe(400);
  });

  it('404 for a node that is not on the map', async () => {
    const res = await postAnswer(req('/api/taste/map/questions', 'POST', { key: `a:${uuid(999)}`, genreId: 'folk' }));
    expect(res.status).toBe(404);
  });

  it('a non-allowlisted user: answer stored, catalog untouched', async () => {
    useDb({ username: 'someone', genres });
    const res = await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'folk' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, key: thinKey, catalog: null });
    const up = calls.find((c) => c.table === 'taste_map_node_state' && c.op === 'upsert')!;
    expect(rowsOf(up)[0]).toMatchObject({ user_id: USER, node_key: thinKey, answer: { genreId: 'folk' } });
    expect((rowsOf(up)[0].answer as Record<string, unknown>).catalogRgIds).toBeUndefined();
    expect(calls.some((c) => c.table === 'release_genres')).toBe(false);
    expect(state.written).toEqual([]);
    expectScoped();
  });

  it('an allowlisted user also writes `manual` genres, only onto untagged / store-only albums', async () => {
    useDb({ username: 'zero', genres });
    const res = await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'folk' }));
    expect(await res.json()).toEqual({ ok: true, key: thinKey, catalog: { releaseGroups: 2 } });
    expect(state.written).toHaveLength(1);
    expect(state.written[0].source).toBe('manual');
    // MB-tagged: skipped. Old display tags with no release_genres rows: skipped.
    expect(state.written[0].items.map((i) => i.releaseGroupId).sort()).toEqual([RG.store, RG.blank].sort());
    expect(state.written[0].items[0].tags).toEqual([{ tag: 'folk', confidence: null }]);
    const up = calls.find((c) => c.table === 'taste_map_node_state' && c.op === 'upsert')!;
    expect((rowsOf(up)[0].answer as { catalogRgIds: string[] }).catalogRgIds.sort()).toEqual([RG.store, RG.blank].sort());
    expectScoped();
  });

  it('"none of these" is stored and writes nothing to the catalog', async () => {
    useDb({ username: 'zero', genres });
    const res = await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, none: true }));
    expect(res.status).toBe(200);
    const up = calls.find((c) => c.table === 'taste_map_node_state' && c.op === 'upsert')!;
    expect(rowsOf(up)[0].answer).toMatchObject({ none: true });
    expect(state.written).toEqual([]);
  });

  it('503 when the migration is not applied, before touching the catalog', async () => {
    useDb({ username: 'zero', genres, nodeStateMissing: true });
    expect((await postAnswer(req('/api/taste/map/questions', 'POST', { key: thinKey, genreId: 'folk' }))).status).toBe(503);
    expect(state.written).toEqual([]);
  });
});
