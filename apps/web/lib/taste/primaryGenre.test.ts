import { describe, it, expect } from 'vitest';
import { primaryTagOf, tagWeight } from './primaryGenre';

/**
 * Golden tests for the Phase-2 repoint of primaryTagOf onto the taxonomy walk.
 * The contract that iOS depends on: primaryTagOf returns a RAW array element
 * (verbatim, casing preserved), never a canonical id — genre_weights keys stay
 * raw. Only WHICH element is primary changed (now the taxonomy's most-specific
 * node), not the shape of the value.
 */
describe('primaryTagOf — taxonomy walk, raw-element return', () => {
  it('returns the most-specific tag as its raw array element', () => {
    // My Bloody Valentine (MB returns tags alphabetically): shoegaze wins.
    expect(primaryTagOf(['indie rock', 'rock', 'shoegaze'])).toBe('shoegaze');
    expect(primaryTagOf(['rock', 'indie rock'])).toBe('indie rock');
    expect(primaryTagOf(['electronic', 'house', 'deep house'])).toBe('deep house');
  });

  it('scene-qualified wins over its sound co-tags (a k-pop album)', () => {
    expect(primaryTagOf(['hip hop', 'k-pop', 'pop'])).toBe('k-pop');
  });

  it('returns the element VERBATIM (casing/spelling preserved, not the id)', () => {
    // "Korean Pop" resolves to id k-pop, but the returned key is the raw element.
    expect(primaryTagOf(['Korean Pop', 'Pop'])).toBe('Korean Pop');
    expect(primaryTagOf(['K-Pop', 'pop'])).toBe('K-Pop');
    expect(primaryTagOf(['Rap', 'Pop'])).toBe('Rap'); // rap → hip-hop, still returns "Rap"
  });

  it('falls back to the first tag when nothing resolves', () => {
    expect(primaryTagOf(['yodeling', 'asian music'])).toBe('yodeling');
    expect(primaryTagOf(['pop'])).toBe('pop');
  });

  it('ignores unresolvable tags but keeps a resolvable winner', () => {
    expect(primaryTagOf(['yodeling', 'shoegaze'])).toBe('shoegaze');
  });

  it('handles empty / null / undefined', () => {
    expect(primaryTagOf([])).toBeNull();
    expect(primaryTagOf(null)).toBeNull();
    expect(primaryTagOf(undefined)).toBeNull();
  });

  it('tagWeight: primary 1.0, co-tag 0.5, by exact element identity', () => {
    const genres = ['hip hop', 'k-pop', 'pop'];
    const primary = primaryTagOf(genres);
    expect(primary).toBe('k-pop');
    expect(tagWeight('k-pop', primary)).toBe(1.0);
    expect(tagWeight('hip hop', primary)).toBe(0.5);
    expect(tagWeight('pop', primary)).toBe(0.5);
  });
});
