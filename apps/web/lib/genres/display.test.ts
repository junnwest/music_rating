import { describe, it, expect } from 'vitest';
import { deriveDisplayGenres, type GenreRow } from './display';

/**
 * Golden tests for the genre DISPLAY projection (Phase 3 cutover).
 */
const legacy = (...ids: string[]): GenreRow[] => ids.map((genre_id) => ({ genre_id, source: 'legacy', confidence: null }));

describe('deriveDisplayGenres', () => {
  it('leaves a legacy-only album exactly as it is (order + spelling kept)', () => {
    const cur = ['indie rock', 'rock', 'shoegaze'];
    expect(deriveDisplayGenres(cur, legacy('indie-rock', 'rock', 'shoegaze'))).toEqual(cur);
  });

  it('folds duplicate spellings of one node, preferring the one naming the node', () => {
    const cur = ['psychedelic', 'rock', 'psychedelic rock'];
    expect(deriveDisplayGenres(cur, legacy('psychedelic-rock', 'rock'))).toEqual(['psychedelic rock', 'rock']);
  });

  it('keeps unresolvable tail tags at their original position (MB vote order survives)', () => {
    expect(deriveDisplayGenres(['yodeling', 'k-pop'], legacy('k-pop'))).toEqual(['yodeling', 'k-pop']);
    const cur = ['indie rock', 'yodeling', 'rock', 'shoegaze'];
    expect(deriveDisplayGenres(cur, legacy('indie-rock', 'rock', 'shoegaze'))).toEqual(cur);
  });

  it('ranks by evidence, adds new genres, and never displays scene roots', () => {
    const rows: GenreRow[] = [
      { genre_id: 'rock', source: 'musicbrainz', confidence: 2 },
      { genre_id: 'shoegaze', source: 'musicbrainz', confidence: 19 },
      { genre_id: 'korean', source: 'lastfm', confidence: 100 },
      { genre_id: 'dream-pop', source: 'lastfm', confidence: 60 },
    ];
    const out = deriveDisplayGenres(['rock'], rows)!;
    expect(out[0]).toBe('shoegaze');
    expect(out).toContain('rock');
    expect(out.some((t) => /dream.?pop/.test(t))).toBe(true);
    expect(out).not.toContain('korean');
  });

  it('returns null (leave untouched) with no rows or nothing displayable', () => {
    expect(deriveDisplayGenres(['rock'], [])).toBeNull();
    expect(deriveDisplayGenres(null, [{ genre_id: 'korean', source: 'lastfm', confidence: 90 }])).toBeNull();
  });
});
