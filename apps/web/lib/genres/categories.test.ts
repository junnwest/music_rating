import { describe, it, expect } from 'vitest';
import { CATEGORIES, CATEGORY_BY_ID, albumMatchesCategory } from './categories';

/**
 * Golden tests for the Phase-2 task-2 category projection: homepage categories
 * are surface nodes, and membership is "category is an ancestor-or-self of a
 * resolved tag" — the TS mirror of the SQL _taxonomy_closure the chart-primary
 * path uses. Keep these in lockstep with that closure's behavior.
 */
describe('CATEGORIES — projection of surface nodes', () => {
  it('every category is a real surface node with display + origin', () => {
    expect(CATEGORIES.length).toBeGreaterThan(20);
    for (const c of CATEGORIES) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.origin).toBeTruthy();
    }
    // The broad sound families are all present.
    for (const id of ['pop', 'rock', 'hip-hop', 'rnb-soul', 'electronic', 'jazz', 'metal']) {
      expect(CATEGORY_BY_ID.has(id)).toBe(true);
    }
  });

  it('derives origin from the scene ancestor', () => {
    expect(CATEGORY_BY_ID.get('k-pop')?.origin).toBe('korean');
    expect(CATEGORY_BY_ID.get('j-pop')?.origin).toBe('japanese');
    expect(CATEGORY_BY_ID.get('electronic')?.origin).toBe('global');
  });
});

describe('albumMatchesCategory — descendant membership', () => {
  it('a family category matches a descendant primary', () => {
    expect(albumMatchesCategory(['house'], 'electronic')).toBe(true); // the case the substring matcher missed
    expect(albumMatchesCategory(['death metal'], 'metal')).toBe(true);
    expect(albumMatchesCategory(['neo soul'], 'rnb-soul')).toBe(true);
    expect(albumMatchesCategory(['bebop'], 'jazz')).toBe(true);
  });

  it('matches the node itself (reflexive) and via raw-tag folding', () => {
    expect(albumMatchesCategory(['k-pop'], 'k-pop')).toBe(true);
    expect(albumMatchesCategory(['Korean Pop'], 'k-pop')).toBe(true);
    expect(albumMatchesCategory(['rap'], 'hip-hop')).toBe(true);
  });

  it('does NOT match across unrelated families', () => {
    expect(albumMatchesCategory(['house'], 'metal')).toBe(false);
    expect(albumMatchesCategory(['k-pop'], 'hip-hop')).toBe(false); // scene isolation
  });

  it('matches when ANY tag in the array qualifies', () => {
    expect(albumMatchesCategory(['yodeling', 'shoegaze'], 'rock')).toBe(true);
  });

  it('handles empty / null / undefined and all-off-taxonomy', () => {
    expect(albumMatchesCategory([], 'rock')).toBe(false);
    expect(albumMatchesCategory(null, 'rock')).toBe(false);
    expect(albumMatchesCategory(undefined, 'rock')).toBe(false);
    expect(albumMatchesCategory(['yodeling'], 'rock')).toBe(false);
  });
});
