import { describe, expect, it } from 'vitest';
import { buildPalette } from './palette';
import { mixAB, oklabToRgb, purity } from './color';
import { colorField, spanningTree, tagGradients } from './fields';
import type { FeatureSpace, MapNode } from './types';

// Tag dims: 'rock' is a plain family (never a hue); the rest are genres.
const TAGS = ['rock', 'britpop', 'brit-rock', 'j-rock', 'k-rap', 'shoegaze'];

function node(key: string, mass: number, w: Partial<Record<string, number>>): MapNode {
  const raw = TAGS.map((t) => w[t] ?? 0);
  const nn = Math.hypot(...raw) || 1;
  return {
    key,
    artistId: key,
    label: key,
    eraLabel: null,
    albumIds: [],
    ratedAlbumIds: [],
    mass,
    avgScore: 4,
    blocks: { tags: raw.map((x) => x / nn), text: [], graph: [], era: [] },
    has: { tags: raw.some((x) => x > 0), text: false, graph: false, era: false },
  };
}

function space(nodes: MapNode[]): FeatureSpace {
  return {
    tagDims: TAGS.map((id) => ({ id, label: id })),
    dims: { tags: TAGS.length, text: 0, graph: 0, era: 0 },
    nodes,
  };
}

describe('buildPalette', () => {
  const s = space([
    // britpop and brit-rock always together: near-synonyms, one hue.
    node('oasis', 6, { rock: 1, britpop: 1, 'brit-rock': 0.9 }),
    node('blur', 4, { rock: 1, britpop: 0.8, 'brit-rock': 0.8 }),
    node('yorushika', 7, { rock: 1, 'j-rock': 1 }),
    node('epik', 5, { 'k-rap': 1 }),
    node('slowdive', 2, { rock: 1, shoegaze: 1, britpop: 0.2 }),
    node('untagged', 1, {}),
  ]);
  const p = buildPalette(s);

  it('never gives a plain family a hue and merges near-synonyms', () => {
    const ids = p.hues.map((h) => h.id);
    expect(ids).not.toContain('rock');
    expect(ids.filter((id) => id === 'britpop' || id === 'brit-rock')).toHaveLength(1);
    expect(ids).toEqual(expect.arrayContaining(['j-rock', 'k-rap', 'shoegaze']));
  });

  it('spaces hues evenly and starts the wheel at the strongest tag', () => {
    const step = 360 / p.hues.length;
    const sorted = [...p.hues].map((h) => h.hue).sort((a, b) => a - b);
    sorted.forEach((h, i) => i > 0 && expect(h - sorted[i - 1]).toBeCloseTo(step, 0));
    expect(p.hues[0].hue).toBe(20);
  });

  it('folds a synonym into its picked tag and leaves untagged nodes empty', () => {
    const picked = p.hues.find((h) => h.id === 'britpop' || h.id === 'brit-rock')!.id;
    // Oasis is all britpop + brit-rock once rock is excluded: ~100% on one hue.
    expect(p.mix.oasis[picked]).toBeGreaterThan(0.95);
    expect(p.mix.untagged).toEqual({});
    for (const rec of Object.values(p.mix)) expect(Object.values(rec).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.001);
  });

  it('is deterministic', () => {
    expect(buildPalette(s)).toEqual(p);
  });
});

describe('buildPalette taxonomy fold', () => {
  // boom-bap@ko only ever appears on one artist, so its column barely overlaps
  // k-rap's; it still folds into Korean Hip-Hop through the taxonomy. Plain
  // boom-bap (no language) does not: k-rap is Korean.
  const DIMS = ['k-rap', 'j-rock', 'boom-bap@ko', 'boom-bap'];
  const mk = (key: string, mass: number, w: number[]): MapNode => {
    const nn = Math.hypot(...w) || 1;
    return { ...node(key, mass, {}), blocks: { tags: w.map((x) => x / nn), text: [], graph: [], era: [] }, has: { tags: true, text: false, graph: false, era: false } };
  };
  const s: FeatureSpace = {
    tagDims: DIMS.map((id) => ({ id, label: id })),
    dims: { tags: DIMS.length, text: 0, graph: 0, era: 0 },
    nodes: [mk('epik', 6, [1, 0, 0, 0]), mk('yoru', 6, [0, 1, 0, 0]), mk('esens', 1, [0.5, 0, 1, 0]), mk('nas', 1, [0, 0, 0, 1])],
  };
  const p = buildPalette(s, 2);

  it('folds a qualified subgenre into its picked same-language ancestor', () => {
    expect(p.hues.map((h) => h.id).sort()).toEqual(['j-rock', 'k-rap']);
    expect(p.mix.esens['k-rap']).toBeCloseTo(1, 3);
    expect(p.mix.nas).toEqual({});
  });
});

describe('buildPalette family rollup', () => {
  // Three electronic artists, each on its own small subgenre: no single tag
  // beats shoegaze, but together they are a region no pick explains.
  const DIMS = ['k-rap', 'j-rock', 'shoegaze', 'house', 'progressive-house', 'uk-garage'];
  const mk = (key: string, mass: number, k: number): MapNode => {
    const w = DIMS.map((_, i) => (i === k ? 1 : 0));
    return { ...node(key, mass, {}), blocks: { tags: w, text: [], graph: [], era: [] }, has: { tags: true, text: false, graph: false, era: false } };
  };
  const s: FeatureSpace = {
    tagDims: DIMS.map((id) => ({ id, label: id })),
    dims: { tags: DIMS.length, text: 0, graph: 0, era: 0 },
    nodes: [mk('epik', 6, 0), mk('yoru', 6, 1), mk('slowdive', 2.5, 2), mk('a', 1, 3), mk('b', 1, 4), mk('c', 1, 5)],
  };

  it('swaps the weakest pick for the family of the orphaned pocket', () => {
    const p = buildPalette(s, 3);
    expect(p.hues.map((h) => h.id).sort()).toEqual(['electronic', 'j-rock', 'k-rap']);
    for (const k of ['a', 'b', 'c']) expect(p.mix[k].electronic).toBeCloseTo(1, 3);
  });

  it('keeps the pick when the pocket is smaller', () => {
    const p = buildPalette({ ...s, nodes: s.nodes.filter((n) => n.key !== 'c') }, 3);
    expect(p.hues.map((h) => h.id)).not.toContain('electronic');
  });
});

describe('color', () => {
  const hues = new Map([
    ['a', 20],
    ['b', 200],
    ['c', 40],
  ]);
  it('pure mixes are vivid, opposing mixes cancel to gray', () => {
    expect(purity({ a: 1 }, hues)).toBeCloseTo(1, 5);
    expect(purity({ a: 0.5, b: 0.5 }, hues)).toBeLessThan(0.05);
    // Neighboring hues barely lose chroma.
    expect(purity({ a: 0.5, c: 0.5 }, hues)).toBeGreaterThan(0.9);
    expect(mixAB(undefined, hues)).toEqual([0, 0]);
  });
  it('keeps colors in gamut', () => {
    for (let h = 0; h < 360; h += 30) {
      const rgb = oklabToRgb(0.88, 0.17 * Math.cos(h), 0.17 * Math.sin(h));
      for (const v of rgb) expect(v >= 0 && v <= 255).toBe(true);
    }
  });
});

describe('fields', () => {
  it('colorField averages colors and fades with density', () => {
    const grid = { x0: 0, y0: 0, cell: 1, nx: 3, ny: 1 };
    const d = colorField(
      [
        { x: 0, y: 0, w: 1, rgb: [255, 0, 0] },
        { x: 2, y: 0, w: 1, rgb: [0, 0, 255] },
      ],
      grid,
      0.8,
    );
    // Middle cell: an even blend.
    expect(Math.abs(d[4] - d[6])).toBeLessThanOrEqual(1);
    // Ends are denser than the middle.
    expect(d[3]).toBeGreaterThan(d[7]);
  });

  it('tagGradients finds the direction a share grows in', () => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const x = (i % 5) - 2;
      const y = Math.floor(i / 5) - 2;
      pts.push({ x, y, w: 1, mix: { east: (x + 2) / 4, noise: ((i * 7) % 5) / 5 } });
    }
    const g = tagGradients(pts, [
      { id: 'east', label: 'east', hue: 0 },
      { id: 'noise', label: 'noise', hue: 90 },
    ]);
    expect(g[0].id).toBe('east');
    expect(g[0].dx).toBeCloseTo(1, 5);
    expect(g[0].r2).toBeCloseTo(1, 5);
  });

  it('spanningTree keeps the strongest links that connect everything', () => {
    const nb = (key: string, sim: number) => ({ key, sim, why: [] });
    const tree = spanningTree(
      { a: [nb('b', 0.9), nb('c', 0.2)], b: [nb('c', 0.8)], c: [nb('a', 0.2)], d: [nb('a', 0.5)] },
      new Set(['a', 'b', 'c', 'd']),
    );
    expect(tree.map((e) => `${e.a}${e.b}`).sort()).toEqual(['ab', 'ad', 'bc']);
  });
});
