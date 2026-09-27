import { describe, it, expect } from 'vitest';
import { resolveGenre, ancestorsOf, primaryOf, isSceneRoot } from './resolver';

describe('resolveGenre', () => {
  it('resolves an exact canonical id', () => {
    expect(resolveGenre('shoegaze')).toBe('shoegaze');
    expect(resolveGenre('k-pop')).toBe('k-pop');
  });

  it('folds spacing/punctuation/case variants onto one node', () => {
    // The structural fold catches these without an explicit alias.
    expect(resolveGenre('K-Pop')).toBe('k-pop');
    expect(resolveGenre('k pop')).toBe('k-pop');
    expect(resolveGenre('kpop')).toBe('k-pop');
    expect(resolveGenre('Hip Hop')).toBe('hip-hop');
    expect(resolveGenre('hiphop')).toBe('hip-hop');
    expect(resolveGenre('lo fi')).toBe('lo-fi');
  });

  it('resolves authored word-level aliases the fold cannot see', () => {
    expect(resolveGenre('rap')).toBe('hip-hop');
    expect(resolveGenre('r&b')).toBe('r-and-b');
    expect(resolveGenre('rnb')).toBe('r-and-b');
    expect(resolveGenre('korean pop')).toBe('k-pop');
    expect(resolveGenre('bollywood')).toBe('filmi');
    expect(resolveGenre('alternative')).toBe('alternative-rock');
  });

  it('returns null for an unmapped tail tag (routed to genre_unmapped)', () => {
    expect(resolveGenre('yodeling')).toBeNull();
    expect(resolveGenre('asian music')).toBeNull();
    expect(resolveGenre('')).toBeNull();
    expect(resolveGenre(null)).toBeNull();
    expect(resolveGenre(undefined)).toBeNull();
  });
});

describe('ancestorsOf', () => {
  it('includes sound ancestors transitively', () => {
    // deep-house → house → electronic
    const a = ancestorsOf('deep-house');
    expect(a.has('house')).toBe(true);
    expect(a.has('electronic')).toBe(true);
    expect(a.has('deep-house')).toBe(false); // excludes self
  });

  it('includes scene roots via scene parents', () => {
    // k-pop: sound parent pop, scene parent korean
    const a = ancestorsOf('k-pop');
    expect(a.has('pop')).toBe(true);
    expect(a.has('korean')).toBe(true);
  });

  it('terminates on the multi-parent DAG and returns [] for a family', () => {
    expect(ancestorsOf('pop').size).toBe(0);
    // city-pop has two sound parents (pop, rnb-soul) + scene japanese
    const a = ancestorsOf('city-pop');
    expect(a.has('pop')).toBe(true);
    expect(a.has('rnb-soul')).toBe(true);
    expect(a.has('japanese')).toBe(true);
  });
});

describe('primaryOf — replaces PRECEDENCE', () => {
  it('picks the most-specific genre on a real album (My Bloody Valentine)', () => {
    // MB returns tags alphabetically: ["indie rock","rock","shoegaze"].
    expect(primaryOf(['indie rock', 'rock', 'shoegaze'])).toBe('shoegaze');
  });

  it('scene-qualified wins over its sound co-tags (a k-pop album)', () => {
    expect(primaryOf(['hip hop', 'k-pop', 'pop'])).toBe('k-pop');
    expect(primaryOf(['korean pop', 'dance-pop'])).toBe('k-pop');
  });

  it('a subgenre beats a genre beats a family', () => {
    expect(primaryOf(['electronic', 'house', 'deep house'])).toBe('deep-house');
    expect(primaryOf(['rock', 'indie rock'])).toBe('indie-rock');
    expect(primaryOf(['pop'])).toBe('pop');
  });

  it('ignores unresolvable tags and returns null when nothing resolves', () => {
    expect(primaryOf(['yodeling', 'shoegaze'])).toBe('shoegaze');
    expect(primaryOf(['yodeling', 'asian music'])).toBeNull();
    expect(primaryOf([])).toBeNull();
    expect(primaryOf(null)).toBeNull();
  });
});

describe('isSceneRoot', () => {
  it('flags scene roots (a nationality tag resolves there) but not genres', () => {
    expect(resolveGenre('korean')).toBe('korean');
    expect(isSceneRoot('korean')).toBe(true);
    expect(isSceneRoot('western')).toBe(true);
    expect(isSceneRoot('k-pop')).toBe(false);
    expect(isSceneRoot('not-a-node')).toBe(false);
  });
});
