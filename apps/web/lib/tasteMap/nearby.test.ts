import { describe, expect, it } from 'vitest';
import { fakeDb, hasFilter, isWrite, type FakeCall } from './fakeDb.testutil';
import { hereQuery } from './focus';
import {
  buildQuery,
  candidateTagVector,
  nearbyQueryHash,
  nodeAlbums,
  NEARBY_MAX_KEYS,
  ON_MAP_FACTOR,
  parseNearbyQuery,
  rankNearby,
  suggestNearby,
  tagPools,
  type CandidateRow,
} from './nearby';
import type { MapAlbumInput, MapArtistInput } from './types';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RH = uuid(1); // Radiohead-ish, GB alt rock
const EH = uuid(2); // Korean hip hop
const MUSE = uuid(3);
const KR2 = uuid(4);
const OTHER = uuid(5);

function album(id: string, artistId: string, year: number, genres: string[], rated: boolean, type = 'album'): MapAlbumInput {
  return { id, title: `T${id.slice(-3)}`, artistId, year, genres, titleLanguage: null, type, coverUrl: null, embedding: null, score: rated ? 4 : null, rated };
}

function artist(id: string, name: string, country: string, albums: MapAlbumInput[], similar: [string, number][] = []): MapArtistInput {
  return {
    id,
    name,
    nameNative: null,
    country,
    genreEvidence: null,
    similar: [{ source: 'lastfm', items: similar.map(([artistId, match]) => ({ name: artistId, mbid: null, artistId, match })) }],
    albums,
  };
}

const radiohead = artist(RH, 'Radiohead', 'GB', [
  album(uuid(101), RH, 1997, ['alternative rock', 'art rock'], true),
  album(uuid(102), RH, 2000, ['alternative rock', 'electronic'], false),
], [[MUSE, 0.9]]);
const esens = artist(EH, 'E SENS', 'KR', [album(uuid(201), EH, 2015, ['hip hop'], true)], [[KR2, 0.8]]);

function cand(id: number, artistId: string, genres: string[], country: string, extra: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: uuid(id),
    title: `Album ${id}`,
    artist_display: `Artist ${artistId.slice(-2)}`,
    cover_url: 'https://x/c.jpg',
    release_group_type: 'album',
    first_release_date: '2010-01-01',
    genres,
    title_language: null,
    prestige_score: 1,
    primary_artist_id: artistId,
    is_official: true,
    artists: { name: `Artist ${artistId.slice(-2)}`, name_native: null, country, genre_evidence: null },
    ...extra,
  };
}

describe('parseNearbyQuery', () => {
  it('normalizes weights, sums duplicates, sorts by key', () => {
    const r = parseNearbyQuery(`a:${EH},a:${RH},a:${EH}`, '1,2,1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([
      { key: `a:${uuid(1)}`, w: 0.5 },
      { key: `a:${uuid(2)}`, w: 0.5 },
    ].sort((a, b) => (a.key < b.key ? -1 : 1)));
  });
  it('defaults to equal weights and drops zero weights', () => {
    const eq = parseNearbyQuery(`a:${RH},a:${EH}`, null);
    expect(eq.ok && eq.value.map((n) => n.w)).toEqual([0.5, 0.5]);
    const z = parseNearbyQuery(`a:${RH},a:${EH}`, '0,3');
    expect(z.ok && z.value).toEqual([{ key: `a:${EH}`, w: 1 }]);
  });
  it('accepts era keys', () => {
    expect(parseNearbyQuery(`e:${RH}:${uuid(101)}`, '1').ok).toBe(true);
  });
  it.each([
    [null, null],
    ['', '1'],
    ['not-a-key', '1'],
    [`a:${RH}`, 'NaN'],
    [`a:${RH}`, '-1'],
    [`a:${RH}`, 'Infinity'],
    [`a:${RH},a:${EH}`, '1'],
    [`a:${RH}`, '0'],
    [`a:${RH}`, ''.padEnd(3, ',')],
  ])('rejects keys=%s w=%s', (k, w) => {
    expect(parseNearbyQuery(k, w).ok).toBe(false);
  });
  it('caps the key count', () => {
    const keys = Array.from({ length: NEARBY_MAX_KEYS + 1 }, (_, i) => `a:${uuid(900 + i)}`).join(',');
    expect(parseNearbyQuery(keys, null)).toEqual({ ok: false, error: `at most ${NEARBY_MAX_KEYS} keys` });
  });
  it('hash rounds weights so nearby clicks share a cache entry', () => {
    const a = parseNearbyQuery(`a:${RH},a:${EH}`, '0.5001,0.4999');
    const b = parseNearbyQuery(`a:${RH},a:${EH}`, '1,1');
    if (!a.ok || !b.ok) throw new Error('parse');
    expect(nearbyQueryHash(a.value)).toBe(nearbyQueryHash(b.value));
  });
});

describe('nodeAlbums', () => {
  const a = artist(RH, 'R', 'GB', [1, 2, 3, 4].map((i) => album(uuid(300 + i), RH, 2000 + i, ['rock'], i % 2 === 0)));
  it('whole artist: every counted album', () => {
    expect(nodeAlbums(a, `a:${RH}`).map((x) => x.id)).toEqual([301, 302, 303, 304].map(uuid));
  });
  it('era: from its first album to the next requested era start', () => {
    expect(nodeAlbums(a, `e:${RH}:${uuid(302)}`, [uuid(302), uuid(304)]).map((x) => x.id)).toEqual([uuid(302), uuid(303)]);
    expect(nodeAlbums(a, `e:${RH}:${uuid(304)}`, [uuid(302), uuid(304)]).map((x) => x.id)).toEqual([uuid(304)]);
    expect(nodeAlbums(a, `e:${RH}:${uuid(302)}`).map((x) => x.id)).toEqual([302, 303, 304].map(uuid));
  });
  it('skips unrated compilations', () => {
    const b = { ...a, albums: [...a.albums, album(uuid(399), RH, 2010, ['rock'], false, 'compilation')] };
    expect(nodeAlbums(b, `a:${RH}`)).toHaveLength(4);
  });
});

describe('buildQuery', () => {
  it('mixes tags and graph by weight; drops nodes not on the map', () => {
    const q = buildQuery(
      [
        { key: `a:${RH}`, w: 0.5 },
        { key: `a:${EH}`, w: 0.25 },
        { key: `a:${OTHER}`, w: 0.25 },
      ],
      [radiohead, esens],
    );
    expect(q.nodes.map((n) => n.label)).toEqual(['Radiohead', 'E SENS']);
    expect(q.nodes.map((n) => n.w)).toEqual([2 / 3, 1 / 3]);
    expect(q.graph.get(MUSE)).toBeCloseTo(0.9 * (2 / 3), 9);
    expect(q.graph.get(KR2)).toBeCloseTo(0.8 / 3, 9);
    const norm = Math.sqrt([...q.tags.values()].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 9);
    // Language-qualified: Korean hip hop is not plain (English) hip hop.
    expect([...q.tags.keys()].some((k) => k === 'hip-hop')).toBe(false);
  });
  it('empty when no node is on the map', () => {
    expect(buildQuery([{ key: `a:${OTHER}`, w: 1 }], [radiohead]).nodes).toEqual([]);
  });
});

describe('rankNearby', () => {
  const query = buildQuery(
    [
      { key: `a:${RH}`, w: 0.5 },
      { key: `a:${EH}`, w: 0.5 },
    ],
    [radiohead, esens],
  );
  const none = new Set<string>();

  it('ranks tag + graph fits first and explains them', () => {
    const res = rankNearby({
      query,
      candidates: [
        cand(1, OTHER, ['country'], 'US', { prestige_score: 99 }),
        cand(2, MUSE, ['alternative rock'], 'GB'),
        cand(3, KR2, ['hip hop'], 'KR'),
      ],
      ratedIds: none,
      onMapArtists: none,
    });
    expect(res.map((r) => r.id)).toEqual([uuid(2), uuid(3), uuid(1)]);
    expect(res[0].near).toEqual(['Radiohead']);
    expect(res[0].tags[0]).toBe('Alternative Rock');
    expect(res[0].why).toBe(`near Radiohead · ${res[0].tags.join(', ')}`);
    expect(res[1].near).toEqual(['E SENS']);
    expect(res[2].near).toEqual([]);
  });

  it('a Korean hip hop album does not match the Western side by tags', () => {
    expect(candidateTagVector(cand(3, KR2, ['hip hop'], 'KR')).has('hip-hop')).toBe(false);
  });

  it('excludes rated albums, non-album types, bootlegs; one album per artist', () => {
    const res = rankNearby({
      query,
      candidates: [
        cand(2, MUSE, ['alternative rock'], 'GB', { prestige_score: 5 }),
        cand(4, MUSE, ['alternative rock'], 'GB', { prestige_score: 3 }),
        cand(5, KR2, ['hip hop'], 'KR', { release_group_type: 'compilation' }),
        cand(6, KR2, ['hip hop'], 'KR', { is_official: false }),
        cand(7, KR2, ['hip hop'], 'KR', { release_group_type: 'single' }),
        cand(8, OTHER, ['hip hop'], 'KR'),
      ],
      ratedIds: new Set([uuid(8)]),
      onMapArtists: none,
    });
    expect(res.map((r) => r.id)).toEqual([uuid(2)]);
  });

  it('down-weights artists already on the map', () => {
    const cands = [cand(2, MUSE, ['alternative rock'], 'GB'), cand(9, RH, ['alternative rock', 'art rock'], 'GB')];
    const free = rankNearby({ query, candidates: cands, ratedIds: none, onMapArtists: none });
    const pushed = rankNearby({ query, candidates: cands, ratedIds: none, onMapArtists: new Set([RH]) });
    const s = (rs: typeof free, id: string) => rs.find((r) => r.id === id)!.score;
    expect(s(pushed, uuid(9))).toBeCloseTo(s(free, uuid(9)) * ON_MAP_FACTOR, 2);
    expect(pushed[0].id).toBe(uuid(2));
  });

  it('respects the limit and returns nothing for an empty query', () => {
    const many = Array.from({ length: 10 }, (_, i) => cand(10 + i, uuid(500 + i), ['alternative rock'], 'GB'));
    expect(rankNearby({ query, candidates: many, ratedIds: none, onMapArtists: none, limit: 3 })).toHaveLength(3);
    expect(rankNearby({ query: { nodes: [], tags: new Map(), graph: new Map() }, candidates: many, ratedIds: none, onMapArtists: none })).toEqual([]);
  });
});

describe('tagPools', () => {
  it('groups leading tags by language, with that language’s countries', () => {
    const q = buildQuery([{ key: `a:${EH}`, w: 1 }], [esens]);
    const pools = tagPools(q.tags);
    expect(pools.length).toBeGreaterThan(0);
    expect(pools[0].lang).toBe('ko');
    expect(pools[0].countries).toContain('KR');
    expect(pools[0].spellings).toContain('hip hop');
  });
  it('no country filter for English', () => {
    const pools = tagPools(buildQuery([{ key: `a:${RH}`, w: 1 }], [radiohead]).tags);
    expect(pools[0].lang).toBeNull();
    expect(pools[0].countries).toEqual([]);
  });
});

describe('hereQuery', () => {
  const pts = [
    { key: 'a', x: 0, y: 0, mass: 1 },
    { key: 'b', x: 0.1, y: 0, mass: 1 },
    { key: 'c', x: 5, y: 5, mass: 1 },
  ];
  it('kernel-weights the nodes around the point, normalized', () => {
    const q = hereQuery(pts, [0, 0], 0.1);
    expect(q.keys).toEqual(['a', 'b']);
    expect(q.w[0]).toBeGreaterThan(q.w[1]);
    expect(q.w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 2);
  });
  it('empty sky falls back to the nearest nodes, equally', () => {
    const q = hereQuery(pts, [3, 3], 0.01, 8, 2);
    expect(q.keys).toEqual(['c', 'b']);
    expect(q.w).toEqual([0.5, 0.5]);
  });
});

describe('suggestNearby (fake db)', () => {
  const USER = uuid(999);
  const rgRow = (a: MapAlbumInput) => ({
    id: a.id,
    title: a.title,
    primary_artist_id: a.artistId,
    first_release_date: `${a.year}-01-01`,
    genres: a.genres,
    title_language: null,
    cover_url: null,
    release_group_type: a.type,
    is_official: true,
  });
  const respond = (c: FakeCall) => {
    if (c.table === 'artists') return { data: [{ id: RH, name: 'Radiohead', name_native: null, country: 'GB', genre_evidence: null }] };
    if (c.table === 'release_groups' && hasFilter(c, 'in', 'primary_artist_id') && (c.cols ?? '').includes('is_official') && !(c.cols ?? '').includes('prestige'))
      return { data: radiohead.albums.map(rgRow) };
    if (c.table === 'ratings' && hasFilter(c, 'in', 'release_groups.primary_artist_id'))
      return { data: [{ id: 'r1', score: 4, release_groups: rgRow(radiohead.albums[0]) }] };
    if (c.table === 'ratings') return { data: [{ id: 'r1', release_group_id: uuid(101), release_groups: { primary_artist_id: RH } }] };
    if (c.table === 'artist_similar' && hasFilter(c, 'in', 'artist_id'))
      return { data: [{ artist_id: RH, source: 'lastfm', similar: [{ name: 'Muse', artist_id: MUSE, match: 0.9 }] }] };
    if (c.table === 'release_groups' && (c.cols ?? '').includes('prestige')) {
      if (hasFilter(c, 'in', 'primary_artist_id')) return { data: [cand(2, MUSE, ['alternative rock'], 'GB'), cand(9, RH, ['alternative rock'], 'GB')] };
      return { data: [cand(3, OTHER, ['alternative rock'], 'US'), { ...cand(1, RH, ['alternative rock'], 'GB'), id: uuid(101) }] };
    }
    return undefined;
  };

  it('reads only, queries the graph and tag pools, and ranks new artists first', async () => {
    const { db, calls } = fakeDb(respond);
    const res = await suggestNearby(db, USER, [{ key: `a:${RH}`, w: 1 }]);
    expect(calls.some(isWrite)).toBe(false);
    const pools = calls.filter((c) => c.table === 'release_groups' && (c.cols ?? '').includes('prestige'));
    expect(pools.some((c) => hasFilter(c, 'in', 'primary_artist_id'))).toBe(true);
    expect(pools.some((c) => c.filters.some((f) => f[0] === 'overlaps'))).toBe(true);
    const ids = res.albums.map((a) => a.id);
    expect(ids[0]).toBe(uuid(2)); // Muse: tags + listeners
    expect(ids).not.toContain(uuid(101)); // rated
    expect(ids.indexOf(uuid(9))).toBeGreaterThan(ids.indexOf(uuid(3))); // on-map artist pushed down
    expect(res.albums[0]).toMatchObject({ title: 'Album 2', year: 2010, coverUrl: 'https://x/c.jpg' });
    expect('score' in res.albums[0]).toBe(false);
  });

  it('no albums (and no pool reads) when no node is on the map', async () => {
    const { db, calls } = fakeDb(() => undefined);
    expect(await suggestNearby(db, USER, [{ key: `a:${RH}`, w: 1 }])).toEqual({ albums: [] });
    expect(calls.some((c) => (c.cols ?? '').includes('prestige'))).toBe(false);
  });
});
