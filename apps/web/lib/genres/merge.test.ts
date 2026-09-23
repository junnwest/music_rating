import { describe, it, expect } from 'vitest';
import { mergeGenres, confidenceWeight, SOURCE_TRUST, type GenreAssignment } from './merge';

/**
 * Golden tests for the Phase-3 genre merge model (trust × confidence × agreement).
 */
describe('confidenceWeight', () => {
  it('null → full weight; higher count → saturates toward 1', () => {
    expect(confidenceWeight(null)).toBe(1);
    expect(confidenceWeight(undefined)).toBe(1);
    expect(confidenceWeight(0)).toBe(0.5);
    expect(confidenceWeight(3)).toBeCloseTo(0.75, 5);
    expect(confidenceWeight(100)).toBeGreaterThan(0.97);
    expect(confidenceWeight(100)).toBeLessThan(1);
  });

  it('saturates on each source’s own scale (MB votes vs Last.fm 0–100 weights)', () => {
    // At its own floor each source sits at exactly 0.75.
    expect(confidenceWeight(3, 'musicbrainz')).toBeCloseTo(0.75, 5);
    expect(confidenceWeight(30, 'lastfm')).toBeCloseTo(0.75, 5);
    // A middling Last.fm weight must NOT read as near-certain (it would on the MB scale).
    expect(confidenceWeight(20, 'lastfm')).toBeLessThan(0.75);
    expect(confidenceWeight(20, 'musicbrainz')).toBeGreaterThan(0.9);
    // Unlisted sources fall back to the default scale.
    expect(confidenceWeight(3, 'itunes')).toBeCloseTo(0.75, 5);
  });
});

describe('mergeGenres', () => {
  it('ranks by trust when confidence is absent', () => {
    const a: GenreAssignment[] = [
      { genreId: 'lastfm-only', source: 'lastfm' },
      { genreId: 'mb-only', source: 'musicbrainz' },
      { genreId: 'manual-only', source: 'manual' },
    ];
    expect(mergeGenres(a).map((m) => m.genreId)).toEqual(['manual-only', 'mb-only', 'lastfm-only']);
  });

  it('boosts a genre multiple sources agree on above a single stronger source', () => {
    const merged = mergeGenres([
      { genreId: 'agreed', source: 'lastfm' },
      { genreId: 'agreed', source: 'itunes' },
      { genreId: 'agreed', source: 'deezer' },
      { genreId: 'solo', source: 'musicbrainz' },
    ]);
    // 'agreed' (3 sources, 0.5+0.55+0.6=1.65 ·1.5) beats 'solo' (0.9 ·1.0).
    expect(merged[0].genreId).toBe('agreed');
    expect(merged.find((m) => m.genreId === 'agreed')!.sources).toEqual([
      'deezer',
      'itunes',
      'lastfm',
    ]);
  });

  it('weights higher-confidence assignments more', () => {
    const merged = mergeGenres([
      { genreId: 'strong', source: 'lastfm', confidence: 100 },
      { genreId: 'weak', source: 'lastfm', confidence: 0 },
    ]);
    expect(merged[0].genreId).toBe('strong');
    expect(merged[0].score).toBeGreaterThan(merged[1].score);
  });

  it('drops ids the caller marks non-displayable (e.g. scene roots)', () => {
    const merged = mergeGenres(
      [
        { genreId: 'korean', source: 'lastfm', confidence: 100 },
        { genreId: 'k-pop', source: 'musicbrainz' },
      ],
      { displayable: (id) => id !== 'korean' },
    );
    expect(merged.map((m) => m.genreId)).toEqual(['k-pop']);
  });

  it('respects the limit and is deterministic on ties', () => {
    const rows: GenreAssignment[] = [
      { genreId: 'b', source: 'musicbrainz' },
      { genreId: 'a', source: 'musicbrainz' },
      { genreId: 'c', source: 'musicbrainz' },
    ];
    // equal score → id order; limit caps the displayed set.
    expect(mergeGenres(rows, { limit: 2 }).map((m) => m.genreId)).toEqual(['a', 'b']);
  });

  it('ignores empty ids and unknown sources', () => {
    const merged = mergeGenres([
      { genreId: '', source: 'manual' },
      { genreId: 'ok', source: 'bogus' as never },
      { genreId: 'ok', source: 'manual' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].genreId).toBe('ok');
    expect(merged[0].sources).toEqual(['manual']);
  });

  it('trust order is manual > musicbrainz > deezer > itunes > lastfm > legacy', () => {
    const order = (Object.keys(SOURCE_TRUST) as (keyof typeof SOURCE_TRUST)[]).sort(
      (a, b) => SOURCE_TRUST[b] - SOURCE_TRUST[a],
    );
    expect(order).toEqual(['manual', 'musicbrainz', 'deezer', 'itunes', 'lastfm', 'legacy']);
  });
});
