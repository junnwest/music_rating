import { describe, it, expect } from 'vitest';
import { tagScene } from './albumVector';
import { displayGenre, genreVector, cosine } from './embeddings';
import { canonicalize, synonymsOf } from './genreSynonyms';

/**
 * Golden tests for the Phase-2 "synonyms / scene / display derived from the
 * taxonomy" step: the taxonomy graph is now the primary source and the old
 * hand-maintained fold/regex/SPECIAL map are demoted to safety nets. These pin
 * both the derivation (a resolvable tag uses the taxonomy) and the fallback (an
 * unresolvable tag still gets the legacy behavior).
 */
describe('tagScene — scene from taxonomy ancestry, regex as safety net', () => {
  it('derives kr/jp from scene ancestry', () => {
    expect(tagScene('k-pop')).toBe('kr');
    expect(tagScene('korean pop')).toBe('kr'); // alias → k-pop → korean
    expect(tagScene('k-rap')).toBe('kr');
    expect(tagScene('city pop')).toBe('jp');
    expect(tagScene('visual kei')).toBe('jp'); // alias → j-rock → japanese
    expect(tagScene('japanese pop')).toBe('jp');
    expect(tagScene('enka')).toBe('jp');
  });

  it('falls back to the name regex for tags with no taxonomy node', () => {
    expect(tagScene('trot')).toBe('kr'); // unresolved → regex special-case
    expect(tagScene('shibuya kei')).toBe('jp'); // unresolved → regex list
  });

  it('returns null for non-scene genres', () => {
    expect(tagScene('rock')).toBeNull();
    expect(tagScene('jazz')).toBeNull();
    expect(tagScene('r&b')).toBeNull(); // resolves (r-and-b) but no kr/jp ancestor
  });
});

describe('displayGenre — display from taxonomy, SPECIAL/title-case as safety net', () => {
  it('uses the node display name for resolvable tags', () => {
    expect(displayGenre('r&b')).toBe('R&B');
    expect(displayGenre('rnb')).toBe('R&B');
    expect(displayGenre('kpop')).toBe('K-Pop');
    expect(displayGenre('dream pop')).toBe('Dream Pop');
    expect(displayGenre('idm')).toBe('IDM');
  });

  it('title-cases tags with no taxonomy node', () => {
    expect(displayGenre('some unknown tag')).toBe('Some Unknown Tag');
    expect(displayGenre('witch house zzz')).toBe('Witch House Zzz');
  });
});

describe('canonicalize — synonym grouping keyed on the taxonomy node', () => {
  it('spellings of one node share a canonical (group together)', () => {
    const kpop = canonicalize('k-pop');
    expect(canonicalize('kpop')).toBe(kpop);
    expect(canonicalize('korean pop')).toBe(kpop);
    const rnb = canonicalize('r&b');
    expect(canonicalize('rnb')).toBe(rnb);
  });

  it('distinct nodes do NOT collapse together', () => {
    // soul and r&b are separate genre nodes — must stay separate tiles.
    expect(canonicalize('soul')).not.toBe(canonicalize('r&b'));
    expect(canonicalize('neo soul')).not.toBe(canonicalize('r&b'));
  });

  it('synonymsOf expands to the node id + its taxonomy aliases (DB overlap)', () => {
    const syn = synonymsOf('k-pop');
    expect(syn).toContain('k-pop'); // the id
    expect(syn).toContain('korean pop'); // a taxonomy alias → raw DB spelling
  });
});

describe('genreVector — id-canonical lookup unifies spellings onto one vector', () => {
  it('spelling variants of a node resolve to the same vector', () => {
    for (const [a, b] of [
      ['kpop', 'k-pop'],
      ['korean pop', 'k-pop'],
      ['hip hop', 'hip-hop'], // raw spelling vs the taxonomy id form
      ['rnb', 'r&b'],
    ]) {
      const va = genreVector(a);
      const vb = genreVector(b);
      expect(va).not.toBeNull();
      expect(vb).not.toBeNull();
      expect(cosine(va!, vb!)).toBeGreaterThan(0.999);
    }
  });

  it('preserves genre semantics (near vs far)', () => {
    const sg = genreVector('shoegaze')!;
    const dp = genreVector('dream pop')!;
    const jz = genreVector('jazz')!;
    expect(cosine(sg, dp)).toBeGreaterThan(0.5); // near
    expect(cosine(genreVector('kpop')!, jz)).toBeLessThan(0.3); // far
  });
});
