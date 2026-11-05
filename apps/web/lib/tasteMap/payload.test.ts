/**
 * payload.ts: the user-arranged layout path (assembleArrangedLayout, pure) and
 * buildTasteMapPayload's persistence / hashing / soft_z handling against a fake
 * Supabase client. load.ts and the artist priors are mocked; nothing hits a DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, hasFilter, rowsOf, type FakeCall, type Responder } from './fakeDb.testutil';
import { finishLayout, mulberry32, projectPlane, solveLayout } from './layout';
import { _resetSoftZWarning } from './store';
import type { FeatureSpace, MapAlbumInput, MapNode, MapUserInput, Vec3 } from './types';

const input = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./load', () => ({ loadMapUserInput: async () => input.value }));
vi.mock('../taste/artistPrior', () => ({
  loadArtistPriors: async () => ({ stored: new Map(), releases: new Map() }),
  artistInputFor: () => ({}),
}));

import { assembleArrangedLayout, buildTasteMapPayload, LAYOUT_ARRANGED } from './payload';

// ── a small synthetic feature space (as layout.test.ts) ──────────────────────

const DIMS = { tags: 12, text: 8, graph: 6, era: 2 };
const l2 = (v: number[]) => {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
};
function makeSpace(perCluster: number, clusters = 3, seed = 1): FeatureSpace {
  const rng = mulberry32(seed);
  const nodes: MapNode[] = [];
  const block = (dim: number, c: number) => {
    const v = Array.from({ length: dim }, () => 0.15 * rng());
    const span = Math.max(1, Math.floor(dim / clusters));
    for (let i = c * span; i < Math.min(dim, (c + 1) * span); i++) v[i] += 1;
    return l2(v);
  };
  for (let c = 0; c < clusters; c++)
    for (let i = 0; i < perCluster; i++)
      nodes.push({
        key: `a:c${c}n${i}`,
        artistId: `c${c}n${i}`,
        label: `Artist ${c}-${i}`,
        eraLabel: null,
        albumIds: [],
        ratedAlbumIds: [],
        mass: 1,
        avgScore: null,
        blocks: { tags: block(DIMS.tags, c), text: block(DIMS.text, c), graph: block(DIMS.graph, c), era: l2([1, rng()]) },
        has: { tags: true, text: true, graph: true, era: true },
      });
  return { tagDims: Array.from({ length: DIMS.tags }, (_, i) => ({ id: `t${i}`, label: `Tag ${i}` })), dims: DIMS, nodes };
}
const cluster = (key: string) => key.split('c')[1].split('n')[0];
const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

describe('finishLayout', () => {
  it('reproduces solveLayout’s plane and neighbors from its positions', () => {
    const space = makeSpace(6);
    const solved = solveLayout(space, { nEpochs: 60 });
    const again = finishLayout(space, solved.positions);
    expect(again).toEqual(solved);
  });
});

describe('assembleArrangedLayout', () => {
  const space = makeSpace(6);
  // A hand-arranged map: each cluster parked at its own corner.
  const corners: Vec3[] = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const arranged: Record<string, Vec3> = {};
  for (const m of space.nodes) {
    const c = corners[Number(cluster(m.key))];
    const i = Number(m.key.split('n')[1]);
    arranged[m.key] = [c[0] + 0.05 * i, c[1], c[2] + 0.02 * i];
  }

  it('keeps every stored position exactly and adds the same tail as a solve', () => {
    const r = assembleArrangedLayout(space, { ...arranged, 'a:gone': [9, 9, 9] })!;
    expect(r.placed).toEqual({});
    expect(r.layout.positions).toEqual(arranged);
    expect(r.layout.plane2d).toEqual(projectPlane(arranged));
    expect(r.layout.neighbors).toEqual(solveLayout(space, { nEpochs: 30 }).neighbors);
  });

  it('places missing nodes by kNN barycentre among their own cluster', () => {
    const partial = { ...arranged };
    delete partial['a:c0n2'];
    delete partial['a:c2n5'];
    const r = assembleArrangedLayout(space, partial)!;
    expect(Object.keys(r.placed).sort()).toEqual(['a:c0n2', 'a:c2n5']);
    for (const k of Object.keys(partial)) expect(r.layout.positions[k]).toEqual(partial[k]);
    for (const [k, p] of Object.entries(r.placed)) {
      const own = corners[Number(cluster(k))];
      for (const other of corners) if (other !== own) expect(dist(p, own)).toBeLessThan(dist(p, other));
    }
    // Deterministic.
    expect(assembleArrangedLayout(space, partial)).toEqual(r);
  });

  it('returns null when fewer than 3 current nodes have a stored position', () => {
    expect(assembleArrangedLayout(space, { 'a:c0n0': [0, 0, 0], 'a:c0n1': [1, 0, 0] })).toBeNull();
    expect(assembleArrangedLayout(space, { 'a:x': [0, 0, 0], 'a:y': [1, 0, 0], 'a:z': [1, 1, 0] })).toBeNull();
  });
});

// ── buildTasteMapPayload against a fake db ───────────────────────────────────

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GENRES = [['rock', 'britpop'], ['k-pop', 'dance-pop'], ['jazz', 'bebop']];

function makeInput(nArtists = 9): MapUserInput {
  return {
    userId: USER,
    username: 'test',
    artists: Array.from({ length: nArtists }, (_, i) => {
      const id = uuid(i + 1);
      const album: MapAlbumInput = {
        id: uuid(100 + i),
        title: `Album ${i}`,
        artistId: id,
        year: 2000 + i,
        genres: GENRES[i % 3],
        titleLanguage: null,
        type: 'album',
        coverUrl: null,
        embedding: null,
        score: 4,
        rated: true,
      };
      return { id, name: `Artist ${i}`, nameNative: null, country: null, genreEvidence: null, similar: [], albums: [album] };
    }),
  };
}
const keyOf = (i: number) => `a:${uuid(i + 1)}`;

interface Rows {
  pins?: Record<string, unknown>[];
  pinsSoftZMissing?: boolean;
  layout?: Record<string, unknown> | null;
}
function responder(rows: Rows): Responder {
  return (c) => {
    if (c.op !== 'select') return undefined;
    if (c.table === 'taste_map_pins') {
      if (rows.pinsSoftZMissing && c.cols?.includes('soft_z'))
        return { error: { code: '42703', message: 'column taste_map_pins.soft_z does not exist' } };
      return { data: rows.pins ?? [] };
    }
    if (c.table === 'taste_map_layouts') return { data: rows.layout ?? null };
    return undefined;
  };
}

async function build(rows: Rows, persist = true) {
  const f = fakeDb(responder(rows));
  const r = await buildTasteMapPayload(f.db, USER, { persist, ignoreAccess: true });
  if (r.kind !== 'ok') throw new Error('too few');
  return { ...r, calls: f.calls };
}
const layoutWrites = (calls: FakeCall[]) => calls.filter((c) => c.table === 'taste_map_layouts' && c.op !== 'select');

describe('buildTasteMapPayload', () => {
  beforeEach(() => {
    input.value = makeInput();
    _resetSoftZWarning();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('reads soft pins and marks them softZ', async () => {
    const r = await build({ pins: [{ node_key: keyOf(0), x: 0.5, y: 0.5, z: 0.5, soft_z: true }, { node_key: keyOf(1), x: 0, y: 0, z: 0, soft_z: false }] });
    const n0 = r.payload.nodes.find((n) => n.key === keyOf(0))!;
    const n1 = r.payload.nodes.find((n) => n.key === keyOf(1))!;
    expect(n0).toMatchObject({ pinned: true, softZ: true, pos: [0.5, 0.5, 0.5] });
    expect(n1.pinned).toBe(true);
    expect('softZ' in n1).toBe(false);
    expect(r.payload.nodes.find((n) => n.key === keyOf(2))!.pinned).toBe(false);
    // Every read is scoped to the user.
    for (const c of r.calls.filter((c) => c.table.startsWith('taste_map_'))) {
      if (c.op === 'upsert') expect(rowsOf(c).every((row) => row.user_id === USER)).toBe(true);
      else expect(hasFilter(c, 'eq', 'user_id', USER), `${c.op} ${c.table}`).toBe(true);
    }
  });

  it('falls back to reading pins without soft_z (42703)', async () => {
    const r = await build({ pinsSoftZMissing: true, pins: [{ node_key: keyOf(0), x: 0.5, y: 0.5, z: 0.5 }] });
    const n0 = r.payload.nodes.find((n) => n.key === keyOf(0))!;
    expect(n0.pinned).toBe(true);
    expect('softZ' in n0).toBe(false);
    expect(r.calls.filter((c) => c.table === 'taste_map_pins')).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('softZ changes the input hash', async () => {
    const hard = await build({ pins: [{ node_key: keyOf(0), x: 0, y: 0, z: 0, soft_z: false }] }, false);
    const soft = await build({ pins: [{ node_key: keyOf(0), x: 0, y: 0, z: 0, soft_z: true }] }, false);
    expect(hard.inputHash).not.toBe(soft.inputHash);
  });

  it('a user-arranged layout is used as-is, not re-solved and not overwritten', async () => {
    const positions: Record<string, Vec3> = {};
    for (let i = 0; i < 9; i++) positions[keyOf(i)] = [i / 10, -i / 10, (i % 3) / 10];
    const r = await build({ layout: { positions, input_hash: null, version: LAYOUT_ARRANGED, solved_at: '2026-11-03T10:00:00Z' } });
    for (const n of r.payload.nodes) expect(n.pos).toEqual(positions[n.key]);
    expect(layoutWrites(r.calls)).toHaveLength(0);
  });

  it('places new nodes into an arranged layout and adds only them (version 2 kept)', async () => {
    const positions: Record<string, Vec3> = {};
    for (let i = 0; i < 8; i++) positions[keyOf(i)] = [i / 10, -i / 10, (i % 3) / 10];
    const r = await build({ layout: { positions, input_hash: null, version: LAYOUT_ARRANGED, solved_at: '2026-11-03T10:00:00Z' } });
    for (let i = 0; i < 8; i++) expect(r.payload.nodes.find((n) => n.key === keyOf(i))!.pos).toEqual(positions[keyOf(i)]);
    const writes = layoutWrites(r.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('update');
    expect(hasFilter(writes[0], 'eq', 'user_id', USER)).toBe(true);
    expect(hasFilter(writes[0], 'eq', 'version', LAYOUT_ARRANGED)).toBe(true);
    const saved = (writes[0].payload as { positions: Record<string, Vec3> }).positions;
    expect(Object.keys(saved).sort()).toEqual([...Object.keys(positions), keyOf(8)].sort());
    expect(writes[0].payload).not.toHaveProperty('version');
    expect(writes[0].payload).not.toHaveProperty('solved_at');
  });

  it('an arranged layout’s solved_at is in the hash; a solved layout’s is not', async () => {
    const positions: Record<string, Vec3> = {};
    for (let i = 0; i < 9; i++) positions[keyOf(i)] = [i / 10, 0, 0];
    const arr = (solved_at: string) => ({ layout: { positions, input_hash: null, version: LAYOUT_ARRANGED, solved_at } });
    const a1 = await build(arr('2026-11-03T10:00:00Z'), false);
    const a2 = await build(arr('2026-11-03T11:00:00Z'), false);
    expect(a1.inputHash).not.toBe(a2.inputHash);
    const sol = (solved_at: string) => ({ layout: { positions, input_hash: 'x', version: 1, solved_at } });
    const s1 = await build(sol('2026-11-03T10:00:00Z'), false);
    const s2 = await build(sol('2026-11-03T11:00:00Z'), false);
    expect(s1.inputHash).toBe(s2.inputHash);
    expect(a1.inputHash).not.toBe(s1.inputHash);
  });

  it('a solved layout is only updated while it is still a solve', async () => {
    const positions: Record<string, Vec3> = {};
    for (let i = 0; i < 9; i++) positions[keyOf(i)] = [i / 10, (i % 2) / 10, 0];
    const r = await build({ layout: { positions, input_hash: 'stale', version: 1, solved_at: '2026-11-03T10:00:00Z' } });
    const writes = layoutWrites(r.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('update');
    expect(hasFilter(writes[0], 'neq', 'version', LAYOUT_ARRANGED)).toBe(true);
    expect(rowsOf(writes[0])[0]).toMatchObject({ user_id: USER, version: 1, input_hash: r.inputHash });
  });

  it('a first solve inserts without replacing a concurrent save', async () => {
    const r = await build({ layout: null });
    const writes = layoutWrites(r.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('upsert');
    expect(writes[0].options).toMatchObject({ ignoreDuplicates: true });
  });
});
