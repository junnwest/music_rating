import { describe, it, expect } from 'vitest';
import { resolveSourceTags, diffSourceRows } from './sourceWriter';

/**
 * Golden tests for the pure halves of the per-source genre writer (Phase 3).
 */
describe('resolveSourceTags', () => {
  it('folds spellings onto one id, keeping the strongest confidence', () => {
    const { genres } = resolveSourceTags([
      { tag: 'k-pop', confidence: 2 },
      { tag: 'Korean Pop', confidence: 5 },
      { tag: 'kpop', confidence: null },
    ]);
    expect(genres).toEqual([{ genreId: 'k-pop', confidence: 5 }]);
  });

  it('keeps first-seen order and null confidence when none is given', () => {
    const { genres } = resolveSourceTags([{ tag: 'shoegaze' }, { tag: 'rap' }]);
    expect(genres.map((g) => g.genreId)).toEqual(['shoegaze', 'hip-hop']);
    expect(genres.every((g) => g.confidence === null)).toBe(true);
  });

  it('returns unresolvable tags once (case-insensitive), skipping blanks', () => {
    const { genres, unmapped } = resolveSourceTags([
      { tag: 'yodeling' },
      { tag: 'Yodeling' },
      { tag: '  ' },
      { tag: 'jazz', confidence: 1 },
    ]);
    expect(unmapped).toEqual(['yodeling']);
    expect(genres).toEqual([{ genreId: 'jazz', confidence: 1 }]);
  });
});

describe('diffSourceRows', () => {
  it('writes nothing when the source already matches', () => {
    const d = diffSourceRows(new Map([['jazz', 3]]), [{ genreId: 'jazz', confidence: 3 }]);
    expect(d).toEqual({ upserts: [], deletes: [] });
  });

  it('upserts new + changed-confidence ids and deletes dropped ones', () => {
    const d = diffSourceRows(
      new Map<string, number | null>([
        ['jazz', 3],
        ['bebop', 1],
        ['swing', null],
      ]),
      [
        { genreId: 'jazz', confidence: 4 }, // changed
        { genreId: 'swing', confidence: null }, // same
        { genreId: 'hard-bop', confidence: 2 }, // new
      ],
    );
    expect(d.upserts.map((u) => u.genreId)).toEqual(['jazz', 'hard-bop']);
    expect(d.deletes).toEqual(['bebop']);
  });
});
