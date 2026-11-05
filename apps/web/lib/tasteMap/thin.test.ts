/**
 * thin.ts (ghost classification) and evidence.ts (confidence-weighted
 * similarity), on hand-built nodes and on buildFeatureSpace.
 */
import { describe, expect, it } from 'vitest';
import { buildFeatureSpace, DEFAULT_METRIC, similarity } from './features';
import { similarityMatrix, weightedSimilarity } from './layout';
import { COVER_MIN, WEAK_TAG_CONF } from './evidence';
import { classifyGhosts, MAX_GHOST_SHARE, nodeEvidence, THIN_MAX } from './thin';
import type { NodeState } from './ghostApi';
import type { BlockName, MapAlbumInput, MapArtistInput, MapNode, MapUserInput } from './types';

const l2 = (v: number[]) => {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
};

function node(
  key: string,
  blocks: Partial<Record<BlockName, number[]>>,
  confidence?: MapNode['confidence'],
): MapNode {
  const full = { tags: [0, 0, 0, 0], text: [0, 0, 0], graph: [0, 0, 0], era: [0, 0], ...blocks };
  return {
    key,
    artistId: key,
    label: key,
    eraLabel: null,
    albumIds: [],
    ratedAlbumIds: [],
    mass: 1,
    avgScore: null,
    blocks: { tags: l2(full.tags), text: l2(full.text), graph: l2(full.graph), era: l2(full.era) },
    has: {
      tags: full.tags.some((x) => x !== 0),
      text: full.text.some((x) => x !== 0),
      graph: full.graph.some((x) => x !== 0),
      era: full.era.some((x) => x !== 0),
    },
    ...(confidence ? { confidence } : {}),
  };
}

describe('evidence-weighted similarity', () => {
  const era = [1, 0.1];
  const rich = (k: string, t: number[]) => node(k, { tags: t, text: [1, 0.2, 0], graph: [1, 0, 0.1], era });
  const eraOnly = node('thin', { era });

  it('an era-only pair no longer reads as identical', () => {
    const other = rich('x', [1, 0, 0, 0]);
    // Before: era alone gave ~1.0. Now the normalizer is floored at COVER_MIN of the total weight.
    const s = similarity(eraOnly, other);
    expect(s).toBeCloseTo((0.5 * 1) / (COVER_MIN * 3.5), 6);
    expect(s).toBeLessThan(0.25);
  });

  it('fully evidenced pairs and pairs missing one block are unchanged', () => {
    const a = rich('a', [1, 0.3, 0, 0]);
    const b = rich('b', [0.8, 0.5, 0.1, 0]);
    let num = 0;
    for (const blk of ['tags', 'text', 'graph', 'era'] as const)
      num += DEFAULT_METRIC.block[blk] * a.blocks[blk].reduce((s, x, i) => s + x * b.blocks[blk][i], 0);
    expect(similarity(a, b)).toBeCloseTo(num / 3.5, 10);
    const noText = { ...b, has: { ...b.has, text: false } };
    const num2 = num - a.blocks.text.reduce((s, x, i) => s + x * b.blocks.text[i], 0);
    expect(similarity(a, noText)).toBeCloseTo(num2 / 2.5, 10);
  });

  it('store-genre tags count for less in both numerator and normalizer', () => {
    const weak = node('w', { tags: [1, 0, 0, 0], era }, { tags: WEAK_TAG_CONF, text: 0.675, graph: 1, era: 1 });
    const strong = node('s', { tags: [1, 0, 0, 0], era });
    const target = rich('t', [1, 0, 0, 0]);
    expect(similarity(weak, target)).toBeLessThan(similarity(strong, target));
  });

  it('features.similarity and layout.weightedSimilarity agree', () => {
    const nodes = [
      rich('a', [1, 0.3, 0, 0]),
      eraOnly,
      node('w', { tags: [0, 1, 0, 0], text: [0, 1, 0], era }, { tags: WEAK_TAG_CONF, text: 0.675, graph: 0.6, era: 1 }),
      rich('b', [0, 0, 1, 0.2]),
    ];
    for (const a of nodes) for (const b of nodes) if (a !== b) expect(weightedSimilarity(a, b, DEFAULT_METRIC)).toBeCloseTo(similarity(a, b), 12);
  });
});

describe('nodeEvidence', () => {
  it('scores what a node says about its sound, not its era', () => {
    expect(nodeEvidence(node('e', { era: [1, 0] }))).toBe(0);
    const storeOnly = node('s', { tags: [1, 0, 0, 0], era: [1, 0] }, { tags: WEAK_TAG_CONF, text: 0.675, graph: 0.6, era: 1 });
    expect(nodeEvidence(storeOnly)).toBeLessThan(THIN_MAX);
    const storePlusText = node('t', { tags: [1, 0, 0, 0], text: [1, 0, 0], era: [1, 0] }, { tags: WEAK_TAG_CONF, text: 0.675, graph: 0.6, era: 1 });
    expect(nodeEvidence(storePlusText)).toBeLessThan(THIN_MAX);
    // A listener graph alone is enough to place; so are trusted tags alone.
    expect(nodeEvidence(node('g', { graph: [1, 0, 0], era: [1, 0] }))).toBeGreaterThanOrEqual(THIN_MAX);
    expect(nodeEvidence(node('tg', { tags: [1, 0, 0, 0], era: [1, 0] }))).toBeGreaterThanOrEqual(THIN_MAX);
  });
});

// ── classification ───────────────────────────────────────────────────────────

/** n rich nodes in 2 clusters, plus extras. */
function map(extra: MapNode[], n = 10): MapNode[] {
  const out: MapNode[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % 2;
    const t = c ? [0, 0.1 * i, 1, 0.2] : [1, 0.3, 0.1 * i, 0];
    out.push(node(`r${i}`, { tags: t, text: c ? [0, 1, 0.1] : [1, 0.1, 0], graph: c ? [0, 1, 0.2] : [1, 0.2, 0], era: [1, 0.1] }));
  }
  return [...out, ...extra];
}
const storeOnly = (k: string) => node(k, { tags: [1, 0.3, 0, 0], era: [1, 0.1] }, { tags: WEAK_TAG_CONF, text: 0.675, graph: 0.6, era: 1 });
// Described, but along an axis no one else has.
const loner = node('lone', { tags: [0, 0, 0, 1], text: [0, 0, 1], graph: [0, 0, 1], era: [0, 1] });

describe('classifyGhosts', () => {
  it('flags thin and misfit nodes, nothing else', () => {
    const nodes = map([storeOnly('thin'), loner], 14);
    const { ghosts, nnMedian } = classifyGhosts(nodes, similarityMatrix(nodes, DEFAULT_METRIC));
    expect(nnMedian).toBeGreaterThan(0.5);
    expect([...ghosts.keys()].sort()).toEqual(['lone', 'thin']);
    expect(ghosts.get('thin')).toMatchObject({ reason: 'thin' });
    expect(ghosts.get('lone')).toMatchObject({ reason: 'misfit', evidence: 1 });
    expect(ghosts.get('thin')!.evidence).toBeLessThan(THIN_MAX);
  });

  it('a pinned, placed, included or answered node is a normal node', () => {
    const nodes = map([storeOnly('p'), storeOnly('pl'), storeOnly('in'), storeOnly('an'), storeOnly('none')], 30);
    const states = new Map<string, NodeState>([
      ['pl', { state: 'placed', answer: null }],
      ['in', { state: 'included', answer: null }],
      ['an', { state: null, answer: { genreId: 'folk', at: '' } }],
      ['none', { state: null, answer: { none: true, at: '' } }],
    ]);
    const { ghosts } = classifyGhosts(nodes, similarityMatrix(nodes, DEFAULT_METRIC), { pinned: new Set(['p']), states });
    expect([...ghosts.keys()]).toEqual(['none']);
  });

  it('"leave it out" holds whatever the data says, and only pins override it', () => {
    const nodes = map([storeOnly('thin')]);
    const states = new Map<string, NodeState>([
      ['thin', { state: 'hidden', answer: null }],
      ['r3', { state: 'hidden', answer: null }],
      ['r4', { state: 'hidden', answer: null }],
    ]);
    const { ghosts } = classifyGhosts(nodes, similarityMatrix(nodes, DEFAULT_METRIC), { states, pinned: new Set(['r4']) });
    expect(ghosts.get('thin')).toEqual({ reason: 'thin', evidence: expect.any(Number), hidden: true });
    expect(ghosts.get('r3')).toMatchObject({ reason: 'misfit', hidden: true, evidence: 1 });
    expect(ghosts.has('r4')).toBe(false);
  });

  it('never ghosts more than MAX_GHOST_SHARE of the map from data, weakest first', () => {
    const thins = Array.from({ length: 6 }, (_, i) => storeOnly(`t${i}`));
    thins[3] = node('t3', { era: [1, 0.1] }); // era only: the weakest
    const nodes = map(thins, 14);
    const { ghosts } = classifyGhosts(nodes, similarityMatrix(nodes, DEFAULT_METRIC));
    expect(ghosts.size).toBe(Math.floor(MAX_GHOST_SHARE * nodes.length));
    expect(ghosts.has('t3')).toBe(true);
  });

  it('calls no misfits on a tiny map', () => {
    const nodes = map([loner], 4);
    expect(classifyGhosts(nodes, similarityMatrix(nodes, DEFAULT_METRIC)).ghosts.size).toBe(0);
  });
});

// ── buildFeatureSpace: provenance and answers ────────────────────────────────

function album(id: string, artistId: string, genres: string[], extra: Partial<MapAlbumInput> = {}): MapAlbumInput {
  return { id, title: id, artistId, year: 2015, genres, titleLanguage: null, type: 'album', coverUrl: null, embedding: null, score: 4, rated: true, ...extra };
}
function artist(id: string, albums: MapAlbumInput[]): MapArtistInput {
  return { id, name: id, nameNative: null, country: null, genreEvidence: null, similar: [], albums };
}

describe('buildFeatureSpace confidence', () => {
  const input: MapUserInput = {
    userId: 'u',
    username: 'u',
    artists: [
      artist('mb', [album('m1', 'mb', ['folk'], { genreSources: ['musicbrainz'] })]),
      artist('store', [album('s1', 'store', ['folk'], { genreSources: ['itunes'] })]),
      artist('legacy', [album('l1', 'legacy', ['folk'])]),
      artist('blank', [album('b1', 'blank', [])]),
    ],
  };

  it('store-genre-only tags are weak; unknown provenance is trusted', () => {
    const space = buildFeatureSpace(input);
    const conf = Object.fromEntries(space.nodes.map((n) => [n.artistId, n.confidence?.tags]));
    expect(conf).toMatchObject({ mb: 1, store: WEAK_TAG_CONF, legacy: 1 });
    expect(space.nodes.find((n) => n.artistId === 'blank')!.has.tags).toBe(false);
  });

  it('an answer adds the genre to the node and makes its tags trusted', () => {
    const space = buildFeatureSpace(input, undefined, { answers: { 'a:store': 'rock', 'a:blank': 'jazz' } });
    const store = space.nodes.find((n) => n.artistId === 'store')!;
    const blank = space.nodes.find((n) => n.artistId === 'blank')!;
    expect(store.confidence?.tags).toBe(1);
    expect(blank.has.tags).toBe(true);
    const dims = (n: MapNode) => space.tagDims.filter((_, i) => n.blocks.tags[i] > 0).map((d) => d.id);
    expect(dims(store)).toEqual(expect.arrayContaining(['folk', 'rock']));
    expect(dims(blank)).toContain('jazz');
  });
});
