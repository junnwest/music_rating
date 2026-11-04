import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFeatureSpace, DEFAULT_METRIC, explain, gramScores, similarity } from './features';
import { BLOCKS, type MapAlbumInput, type MapArtistInput, type MapNode, type MapUserInput, type SimilarArtist } from './types';

// Synthetic user: three "pop rock" acts that sound and are described alike
// (5SOS / Walk the Moon / The Vamps), a Britpop act, a J-Rock act, a K-hip-hop act,
// and a Coldplay-like artist that splits into two eras.
const DIM = 32;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}
const direction = (seed: number) => {
  const r = rng(seed);
  return Array.from({ length: DIM }, () => r());
};
const COMMON = direction(100);
/** A described-alike family of embeddings: common jina "album" direction + a sound direction + noise. */
const emb = (sound: number[], seed: number) => {
  const r = rng(seed);
  return COMMON.map((x, j) => x + 0.6 * sound[j] + 0.1 * r());
};
const POPROCK = direction(1);
const BRIT = direction(2);
const JROCK = direction(3);
const KRAP = direction(4);
const DANCE = direction(5);

let id = 0;
function album(
  artistId: string,
  year: number | null,
  genres: string[],
  embedding: number[] | null,
  score: number | null = 4,
  extra: Partial<MapAlbumInput> = {},
): MapAlbumInput {
  return {
    id: `rg${++id}`,
    title: `${artistId} ${id}`,
    artistId,
    year,
    genres,
    titleLanguage: null,
    coverUrl: null,
    embedding,
    score,
    rated: score != null,
    ...extra,
  };
}
const sim = (artistId: string, match: number): SimilarArtist => ({ name: artistId, mbid: null, artistId, match });
function artist(
  aid: string,
  country: string | null,
  albums: MapAlbumInput[],
  similar: SimilarArtist[] = [],
  extra: Partial<MapArtistInput> = {},
): MapArtistInput {
  return {
    id: aid,
    name: aid,
    nameNative: null,
    country,
    genreEvidence: null,
    similar: similar.length ? [{ source: 'lastfm', items: similar }] : [],
    albums,
    ...extra,
  };
}

function user(): MapUserInput {
  return {
    userId: 'u',
    username: 'u',
    artists: [
      artist('5sos', 'AU', [
        album('5sos', 2014, ['pop punk', 'pop rock'], emb(POPROCK, 11), 4.5),
        album('5sos', 2015, ['pop rock', 'pop punk'], emb(POPROCK, 12), 4),
        album('5sos', 2018, ['pop rock'], emb(POPROCK, 13), null),
      ], [sim('wtm', 0.8), sim('vamps', 0.9), sim('ext-a', 0.7)]),
      artist('wtm', 'US', [
        album('wtm', 2014, ['indie pop', 'pop rock', 'dance-pop'], emb(POPROCK, 21), 4),
        album('wtm', 2017, ['pop rock', 'indie pop'], emb(POPROCK, 22), 3.5),
      ], [sim('5sos', 0.7), sim('ext-a', 0.6), sim('ext-b', 0.5)]),
      artist('vamps', 'GB', [album('vamps', 2014, ['pop rock', 'pop'], emb(POPROCK, 31), 3)], [sim('5sos', 0.9), sim('ext-b', 0.4)]),
      artist('oasis', 'GB', [
        album('oasis', 1994, ['britpop', 'rock'], emb(BRIT, 41), 5),
        album('oasis', 1995, ['britpop', 'alternative rock'], emb(BRIT, 42), 4.5),
      ], [sim('blur', 0.9), sim('ext-c', 0.5)]),
      artist('yorushika', 'JP', [
        album('yorushika', 2019, ['j-rock', 'j-pop', 'alternative rock'], emb(JROCK, 51), 5, { title: 'だから僕は音楽を辞めた' }),
        album('yorushika', 2020, ['j-rock', 'alternative rock'], emb(JROCK, 52), 4.5, { title: '盗作' }),
      ], [sim('zutomayo', 0.9), sim('ext-d', 0.8)], { nameNative: 'ヨルシカ' }),
      artist('beenzino', 'KR', [
        album('beenzino', 2012, ['hip hop'], emb(KRAP, 61), 4),
        album('beenzino', 2016, ['hip hop', 'k-pop'], emb(KRAP, 62), 4),
      ], [], {
        nameNative: '빈지노',
        genreEvidence: { lastfm: [['korean hip hop', 100], ['hip-hop', 60], ['seen live', 10]], musicbrainz: [['hip hop', 3]] },
      }),
      artist('coldplay', 'GB', [
        album('coldplay', 2000, ['britpop', 'alternative rock'], emb(BRIT, 71), 4),
        album('coldplay', 2002, ['britpop', 'alternative rock'], emb(BRIT, 72), null),
        album('coldplay', 2005, ['alternative rock', 'britpop'], emb(BRIT, 73), 3.5),
        album('coldplay', 2011, ['pop', 'dance-pop'], emb(DANCE, 74), 3),
        album('coldplay', 2015, ['dance-pop', 'pop'], emb(DANCE, 75), 2.5),
        album('coldplay', 2021, ['pop', 'dance-pop', 'synth-pop'], emb(DANCE, 76), null),
      ], [sim('oasis', 0.5), sim('ext-c', 0.4)]),
      // One unrated era → no node.
      artist('lonely', 'US', [album('lonely', 2001, ['country'], null, null), album('lonely', 2003, ['country'], null, 3)]),
    ],
  };
}

const byKey = (nodes: MapNode[], prefix: string) => nodes.find((n) => n.key.startsWith(prefix))!;

describe('buildFeatureSpace', () => {
  const space = buildFeatureSpace(user());
  const node = (aid: string) => byKey(space.nodes, `a:${aid}`);

  it('makes one node per rated segment, with mass and average score', () => {
    const fives = node('5sos');
    expect(fives.mass).toBe(2);
    expect(fives.avgScore).toBeCloseTo(4.25);
    expect(fives.albumIds).toHaveLength(3);
    expect(fives.ratedAlbumIds).toHaveLength(2);
    expect(fives.eraLabel).toBeNull();
    const cp = space.nodes.filter((n) => n.artistId === 'coldplay');
    expect(cp.map((n) => n.eraLabel)).toEqual(['2000–2005', '2011–2021']);
    expect(cp.every((n) => n.key.startsWith('e:coldplay:'))).toBe(true);
    expect(space.nodes.filter((n) => n.artistId === 'lonely')).toHaveLength(1);
  });

  it('has L2-normalized blocks with consistent dims and no NaN', () => {
    expect(space.dims.tags).toBe(space.tagDims.length);
    expect(space.dims.text).toBeLessThanOrEqual(Math.min(64, space.nodes.length - 1));
    for (const n of space.nodes) {
      for (const b of BLOCKS) {
        expect(n.blocks[b]).toHaveLength(space.dims[b]);
        for (const x of n.blocks[b]) expect(Number.isFinite(x)).toBe(true);
        const len = Math.hypot(...n.blocks[b]);
        if (n.has[b]) expect(len).toBeCloseTo(1, 6);
        else expect(len).toBe(0);
      }
    }
    // No similar-artist list and nobody lists them → no graph data.
    expect(node('beenzino').has.graph).toBe(false);
    expect(node('lonely').has.text).toBe(false);
    expect(node('5sos').has.graph).toBe(true);
  });

  it('language-qualifies tags and folds in artist evidence', () => {
    const ids = space.tagDims.map((d) => d.id);
    expect(ids).toContain('j-rock');
    expect(ids).toContain('k-rap');
    // Yorushika's "alternative rock" is the Japanese form, not the Western one Oasis has.
    const yo = node('yorushika');
    const at = (q: string) => yo.blocks.tags[ids.indexOf(q)] ?? 0;
    expect(at('j-rock')).toBeGreaterThan(0);
    expect(at('rock')).toBe(0);
    expect(space.tagDims.find((d) => d.id === 'j-rock')!.label).toBe('J-Rock');
  });

  it('puts 5SOS and Walk the Moon closer to each other than to Yorushika', () => {
    const a = node('5sos');
    const b = node('wtm');
    const y = node('yorushika');
    const ab = similarity(a, b);
    expect(ab).toBeGreaterThan(similarity(a, y));
    expect(ab).toBeGreaterThan(similarity(b, y));
    expect(ab).toBeGreaterThan(0.3);
    // Coldplay's early era is nearer Oasis than its late era is.
    const [early, late] = space.nodes.filter((n) => n.artistId === 'coldplay');
    expect(similarity(early, node('oasis'))).toBeGreaterThan(similarity(late, node('oasis')));
  });

  it('is symmetric and self-similar', () => {
    const a = node('5sos');
    const b = node('oasis');
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 12);
    expect(similarity(a, a)).toBeCloseTo(1, 6);
  });

  it('explains a pair with shares ≤ 1 naming the shared tag', () => {
    const why = explain(node('5sos'), node('wtm'), space);
    expect(why.length).toBeGreaterThan(0);
    const total = why.reduce((s, c) => s + c.share, 0);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
    for (const c of why) expect(c.share).toBeGreaterThan(0);
    expect(why.map((c) => c.label)).toContain('Pop Rock');
    // Block labels appear for non-tag evidence.
    const all = explain(node('5sos'), node('wtm'), space, DEFAULT_METRIC, 100).map((c) => c.label);
    expect(all).toContain('listeners overlap');
  });

  it('respects block weights and tag-dim weights', () => {
    const a = node('5sos');
    const b = node('wtm');
    const tagsOnly = { block: { tags: 1, text: 0, graph: 0, era: 0 }, tagDims: null };
    expect(similarity(a, b, tagsOnly)).toBeCloseTo(a.blocks.tags.reduce((s, x, k) => s + x * b.blocks.tags[k], 0), 12);
    const zeroed = { ...tagsOnly, tagDims: space.tagDims.map(() => 0) };
    expect(similarity(a, b, zeroed)).toBe(0);
    expect(explain(a, b, space, zeroed)).toEqual([]);
  });
});

describe('edge cases', () => {
  it('handles a user with no data at all without NaN', () => {
    const s = buildFeatureSpace({
      userId: 'u',
      username: 'u',
      artists: [artist('x', null, [album('x', null, [], null, 4)]), artist('y', null, [album('y', null, [], null, null)])],
    });
    expect(s.nodes).toHaveLength(1);
    const n = s.nodes[0];
    expect(BLOCKS.every((b) => !n.has[b])).toBe(true);
    expect(similarity(n, n)).toBe(0);
    expect(explain(n, n, s)).toEqual([]);
    expect(buildFeatureSpace({ userId: 'u', username: 'u', artists: [] }).nodes).toEqual([]);
  });

  it('drops unrated compilations but keeps rated ones', () => {
    const s = buildFeatureSpace({
      userId: 'u',
      username: 'u',
      artists: [
        artist('pf', 'GB', [
          album('pf', 1973, ['progressive rock'], null, 5, { type: 'album' }),
          album('pf', 1981, ['pop'], null, null, { type: 'compilation' }),
          album('pf', 1988, ['rock'], null, 3, { type: 'live' }),
        ]),
      ],
    });
    expect(s.nodes[0].albumIds).toHaveLength(2);
    expect(s.tagDims.map((d) => d.id)).not.toContain('pop');
  });

  it('gramScores reproduces pairwise dot products at full rank', () => {
    const X = [[1, 0, 2], [0, 1, 1], [2, 1, 0], [1, 1, 1]];
    const n = X.length;
    const G = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G[i * n + j] = X[i].reduce((s, x, k) => s + x * X[j][k], 0);
    const S = gramScores(G, n, 3);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) expect(S[i].reduce((s, x, k) => s + x * S[j][k], 0)).toBeCloseTo(G[i * n + j], 8);
  });

  it('gramScores subspace path (n > 96) matches the leading spectrum', () => {
    const n = 120;
    const r = rng(7);
    const X = Array.from({ length: n }, () => Array.from({ length: 10 }, () => r()));
    const G = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G[i * n + j] = X[i].reduce((s, x, k) => s + x * X[j][k], 0);
    const S = gramScores(G, n, 10); // rank 10 → exact
    for (const [i, j] of [[0, 1], [5, 77], [119, 3]])
      expect(S[i].reduce((s, x, k) => s + x * S[j][k], 0)).toBeCloseTo(G[i * n + j], 6);
  });
});

const FIXTURE = resolve(__dirname, '__fixtures__/map-input-sample.json');
describe.skipIf(!existsSync(FIXTURE))('real fixture (map-input-sample.json)', () => {
  const input: MapUserInput = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;

  it('builds a finite space covering every rated album', () => {
    const space = buildFeatureSpace(input);
    const rated = input.artists.flatMap((a) => a.albums.filter((x) => x.rated).map((x) => x.id));
    expect(space.nodes.flatMap((n) => n.ratedAlbumIds).sort()).toEqual([...rated].sort());
    expect(new Set(space.nodes.map((n) => n.key)).size).toBe(space.nodes.length);
    for (const n of space.nodes) for (const b of BLOCKS) for (const x of n.blocks[b]) expect(Number.isFinite(x)).toBe(true);
    expect(space.dims.text).toBeLessThanOrEqual(space.nodes.length - 1);
    // Every pair's similarity is finite and within [-1, 1].
    for (const a of space.nodes)
      for (const b of space.nodes) {
        const s = similarity(a, b);
        expect(Number.isFinite(s)).toBe(true);
        expect(Math.abs(s)).toBeLessThanOrEqual(1 + 1e-9);
      }
    // The two Korean rappers are nearer each other than a rapper is to the indie-rock band.
    const node = (name: string) => space.nodes.find((n) => n.label === name);
    const [bz, cm, gj] = [node('Beenzino'), node('창모'), node('검정치마')];
    if (bz && cm && gj) expect(similarity(bz, cm)).toBeGreaterThan(similarity(bz, gj));
  });
});
