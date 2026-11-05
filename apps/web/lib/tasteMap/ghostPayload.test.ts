/**
 * payload.ts with ghost nodes (thin.ts): the `ghost` flag, neighbor-list
 * exclusion, barycentre placement, node state in the input hash. load.ts and
 * the artist priors are mocked; nothing hits a DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, type Responder } from './fakeDb.testutil';
import { _resetNodeStateWarning } from './nodeState';
import type { MapAlbumInput, MapArtistInput, MapUserInput, Vec3 } from './types';

const input = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./load', () => ({ loadMapUserInput: async () => input.value }));
vi.mock('../taste/artistPrior', () => ({
  loadArtistPriors: async () => ({ stored: new Map(), releases: new Map() }),
  artistInputFor: () => ({}),
}));

import { buildTasteMapPayload, LAYOUT_ARRANGED } from './payload';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THIN = uuid(900);
const thinKey = `a:${THIN}`;
const keyOf = (i: number) => `a:${uuid(i + 1)}`;
const GENRES = [['rock', 'britpop'], ['k-pop', 'dance-pop'], ['jazz', 'bebop']];

function album(id: string, artistId: string, genres: string[], extra: Partial<MapAlbumInput> = {}): MapAlbumInput {
  return { id, title: id, artistId, year: 2005, genres, titleLanguage: null, type: 'album', coverUrl: null, embedding: null, score: 4, rated: true, ...extra };
}
function makeInput(): MapUserInput {
  const artists: MapArtistInput[] = Array.from({ length: 12 }, (_, i) => {
    const id = uuid(i + 1);
    return {
      id,
      name: `Artist ${i}`,
      nameNative: null,
      country: null,
      genreEvidence: null,
      similar: [{ source: 'lastfm', items: [{ name: `x${i}`, mbid: null, artistId: uuid(((i + 3) % 12) + 1), match: 0.9 }] }],
      albums: [album(uuid(100 + i), id, GENRES[i % 3], { genreSources: ['musicbrainz'] })],
    };
  });
  artists.push({
    id: THIN,
    name: 'Thin',
    nameNative: null,
    country: null,
    genreEvidence: null,
    similar: [],
    albums: [album(uuid(950), THIN, ['k-pop'], { genreSources: ['itunes'] })],
  });
  return { userId: USER, username: 'test', artists };
}

interface Rows {
  nodeState?: Record<string, unknown>[];
  nodeStateMissing?: boolean;
  layout?: Record<string, unknown> | null;
}
function responder(rows: Rows): Responder {
  return (c) => {
    if (c.op !== 'select') return undefined;
    if (c.table === 'taste_map_node_state')
      return rows.nodeStateMissing ? { error: { code: '42P01', message: 'relation "taste_map_node_state" does not exist' } } : { data: rows.nodeState ?? [] };
    if (c.table === 'taste_map_layouts') return { data: rows.layout ?? null };
    return undefined;
  };
}
async function build(rows: Rows = {}) {
  const f = fakeDb(responder(rows));
  const r = await buildTasteMapPayload(f.db, USER, { persist: true, ignoreAccess: true });
  if (r.kind !== 'ok') throw new Error('too few');
  return { ...r, calls: f.calls };
}

beforeEach(() => {
  input.value = makeInput();
  _resetNodeStateWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('buildTasteMapPayload ghosts', () => {
  it('flags the thin node and keeps it out of every other neighbor list', async () => {
    const { payload } = await build();
    const ghosts = payload.nodes.filter((n) => n.ghost);
    expect(ghosts.map((n) => n.key)).toEqual([thinKey]);
    expect(ghosts[0].ghost).toMatchObject({ reason: 'thin' });
    expect(ghosts[0].ghost!.hidden).toBeUndefined();
    for (const [k, list] of Object.entries(payload.neighbors)) {
      if (k === thinKey) continue;
      expect(list.some((nb) => nb.key === thinKey), k).toBe(false);
    }
    // Its own list = suggested spots, over normal nodes.
    expect(payload.neighbors[thinKey].length).toBeGreaterThan(0);
    // similarity stays complete.
    const n = payload.nodes.length;
    expect(payload.similarity!.keys).toHaveLength(n);
    expect(payload.similarity!.q).toHaveLength((n * (n - 1)) / 2);
    // Normal nodes carry no ghost field at all.
    expect(payload.nodes.filter((x) => x.key !== thinKey).every((x) => !('ghost' in x))).toBe(true);
  });

  it('places the ghost at the barycentre of its suggested spots', async () => {
    const { payload } = await build();
    const pos = new Map(payload.nodes.map((n) => [n.key, n.pos]));
    const g = pos.get(thinKey)!;
    const anchors = payload.neighbors[thinKey].slice(0, 5).map((nb) => pos.get(nb.key)!);
    const centre = [0, 1, 2].map((d) => anchors.reduce((s, p) => s + p[d], 0) / anchors.length);
    const spread = Math.max(...anchors.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])));
    expect(Math.hypot(g[0] - centre[0], g[1] - centre[1], g[2] - centre[2])).toBeLessThanOrEqual(spread + 0.05);
  });

  it('"include anyway" and an answer make it a normal node; "leave it out" hides it', async () => {
    const inc = await build({ nodeState: [{ node_key: thinKey, state: 'included', answer: null }] });
    expect(inc.payload.nodes.find((n) => n.key === thinKey)!.ghost).toBeUndefined();
    const ans = await build({ nodeState: [{ node_key: thinKey, state: null, answer: { genreId: 'jazz', at: 'x' } }] });
    expect(ans.payload.nodes.find((n) => n.key === thinKey)!.ghost).toBeUndefined();
    // The answer moved it toward the jazz artists (artist i with i % 3 === 2, key uuid(i + 1)).
    const isJazz = (k: string) => Number(k.slice(-3)) % 3 === 0;
    const bestJazz = (nbs: { key: string; sim: number }[]) => Math.max(0, ...nbs.filter((nb) => isJazz(nb.key)).map((nb) => nb.sim));
    const before = (await build()).payload.neighbors[thinKey];
    expect(bestJazz(ans.payload.neighbors[thinKey])).toBeGreaterThan(bestJazz(before) + 0.1);
    const hid = await build({ nodeState: [{ node_key: thinKey, state: 'hidden', answer: null }] });
    expect(hid.payload.nodes.find((n) => n.key === thinKey)!.ghost).toMatchObject({ reason: 'thin', hidden: true });
  });

  it('node state is in the input hash; a missing table degrades to data-only ghosts', async () => {
    const a = await build();
    const b = await build({ nodeState: [{ node_key: thinKey, state: 'hidden', answer: null }] });
    expect(a.inputHash).not.toBe(b.inputHash);
    const missing = await build({ nodeStateMissing: true });
    expect(missing.inputHash).toBe(a.inputHash);
    expect(missing.payload.nodes.find((n) => n.key === thinKey)!.ghost).toMatchObject({ reason: 'thin' });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('an arranged layout re-places a ghost but never re-saves its stored spot', async () => {
    const positions: Record<string, Vec3> = {};
    for (let i = 0; i < 12; i++) positions[keyOf(i)] = [(i % 3) - 1, i / 12, 0];
    positions[thinKey] = [9, 9, 9];
    const r = await build({ layout: { positions, input_hash: null, version: LAYOUT_ARRANGED, solved_at: '2026-11-05T00:00:00Z' } });
    const g = r.payload.nodes.find((n) => n.key === thinKey)!;
    expect(g.pos).not.toEqual([9, 9, 9]);
    expect(Math.hypot(...g.pos)).toBeLessThan(2);
    for (let i = 0; i < 12; i++) expect(r.payload.nodes.find((n) => n.key === keyOf(i))!.pos).toEqual(positions[keyOf(i)]);
    expect(r.calls.filter((c) => c.table === 'taste_map_layouts' && c.op !== 'select')).toHaveLength(0);
  });
});
