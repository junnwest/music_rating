import { describe, expect, it } from 'vitest';
import { bucketShares, familiarity, rankExplore, scoreCandidate, thoughtfulness } from './ranking';
import type { Candidate } from './types';

const now = Date.parse('2026-09-28T12:00:00Z');
const candidate = (id: number, overrides: Partial<Candidate> = {}): Candidate => ({
  key: `rating:${id}`, author: `author-${id}`, createdAt: new Date(now - 3600000).toISOString(),
  format: 'review', albums: [{ id: `album-${id}`, title: '', artist_display: '', primary_artist_id: `artist-${id}`,
    cover_url: null, release_group_type: 'album', native_title: null }],
  text: 'A thoughtful account of what makes this record worth hearing.', relevance: 0.75,
  authorAffinity: 0.2, response: 0.2, seen: false, knownArtist: false, rated: false, followed: false, ...overrides,
});

describe('Explore ordering', () => {
  it('uses normalized mixtures throughout the adventure range', () => {
    for (const value of [-20, 0, 25, 50, 75, 100, 120]) {
      expect(Object.values(bucketShares(value)).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    expect(bucketShares(50)).toEqual({ taste: 0.4, adjacent: 0.25, social: 0.15, community: 0.1, exploration: 0.1 });
    expect(bucketShares(100).taste).toBeLessThan(bucketShares(0).taste);
  });
  it('is deterministic, deduplicates and preserves every candidate across pages', () => {
    const input = Array.from({ length: 75 }, (_, i) => candidate(i));
    const order = rankExplore([...input, input[0]], 50, now);
    expect(order).toEqual(rankExplore(input, 50, now));
    expect(new Set(order.map(r => r.key)).size).toBe(75);
    expect(order.slice(0, 20).some(r => order.slice(20).some(other => other.key === r.key))).toBe(false);
  });
  it('spaces authors and albums across page boundaries when alternatives exist', () => {
    const input = Array.from({ length: 100 }, (_, i) => candidate(i, { author: `author-${i % 20}` }));
    const order = rankExplore(input, 50, now).map(r => input.find(c => c.key === r.key)!);
    for (let i = 0; i < order.length; i++) {
      if (i) expect(order[i].author).not.toBe(order[i - 1].author);
      const window = order.slice(Math.max(0, i - 19), i + 1);
      expect(window.filter(c => c.author === order[i].author).length).toBeLessThanOrEqual(2);
    }
  });
  it('keeps a highly popular seen post behind unseen supply', () => {
    const seen = candidate(0, { seen: true, relevance: 1, authorAffinity: 1, response: 1 });
    const fresh = candidate(1, { relevance: 0.05, authorAffinity: 0, response: 0 });
    expect(rankExplore([seen, fresh], 50, now)[0].key).toBe(fresh.key);
  });
  it('relaxes quotas and spacing for a sparse community without silently dropping posts', () => {
    const input = Array.from({ length: 7 }, (_, i) => candidate(i, { author: 'only-author', relevance: 0, response: 0, knownArtist: true }));
    expect(rankExplore(input, 50, now)).toHaveLength(7);
    expect(rankExplore([], 50, now)).toEqual([]);
  });
  it('spreads discovery slots through the page', () => {
    const input = Array.from({ length: 100 }, (_, i) => candidate(i, { followed: true, authorAffinity: 1, relevance: 0.65 }));
    const first = rankExplore(input, 50, now).slice(0, 20);
    const counts = Object.fromEntries(['taste', 'adjacent', 'social', 'community', 'exploration'].map(b => [b, first.filter(r => r.bucket === b).length]));
    expect(counts).toEqual({ taste: 8, adjacent: 5, social: 3, community: 2, exploration: 2 });
    expect(first.slice(0, 10).some(r => r.bucket === 'exploration')).toBe(true);
    expect(first.slice(10).some(r => r.bucket === 'exploration')).toBe(true);
  });
  it('uses smooth freshness and caps engagement and text effects', () => {
    const fresh = candidate(1);
    const old = candidate(1, { createdAt: new Date(now - 48 * 3600000).toISOString() });
    expect(scoreCandidate(fresh, now)).toBeGreaterThan(scoreCandidate(old, now));
    expect(scoreCandidate(candidate(1, { response: 1000 }), now)).toBe(scoreCandidate(candidate(1, { response: 1 }), now));
    expect(scoreCandidate(candidate(1, { text: 'x'.repeat(10000) }), now) - scoreCandidate(candidate(1, { text: '' }), now)).toBeLessThan(0.1);
    expect(Number.isFinite(scoreCandidate(candidate(1, { createdAt: 'invalid' }), now))).toBe(true);
  });
});

describe('Thoughtfulness', () => {
  const real = '이 앨범은 전작보다 훨씬 차분해요. 특히 3번 트랙의 색소폰이 좋았고, 가사도 담백합니다. 다만 후반부는 조금 늘어져요.';
  const realEn = 'Calmer than the last record. The saxophone on track three is the best thing here, and the lyrics stay plain. The back half drags a little.';

  it('ranks a written review above a reaction, in both languages', () => {
    expect(thoughtfulness(real, 'review')).toBeGreaterThan(thoughtfulness('짱', 'review'));
    expect(thoughtfulness(realEn, 'review')).toBeGreaterThan(thoughtfulness('love it', 'review'));
  });

  it('does not rank Korean below English of the same substance', () => {
    // A 어절 carries more than an English word, so a single token threshold would penalise Korean.
    expect(thoughtfulness(real, 'review')).toBeGreaterThan(0.8 * thoughtfulness(realEn, 'review'));
  });

  it('is not fooled by padding — the failure mode a type-token ratio would miss', () => {
    // 'x'.repeat(n) has a perfect TTR of 1.0; distinct-token counting puts it near the floor.
    expect(thoughtfulness('x'.repeat(5000), 'review')).toBeLessThan(thoughtfulness(real, 'review'));
    expect(thoughtfulness('좋아요 좋아요 좋아요 좋아요 좋아요 좋아요', 'review')).toBeLessThan(thoughtfulness(real, 'review'));
  });

  it('still cannot be gamed by length alone', () => {
    expect(scoreCandidate(candidate(1, { text: 'x'.repeat(10000) }), now)
      - scoreCandidate(candidate(1, { text: '' }), now)).toBeLessThan(0.1);
  });
});

describe('Familiarity', () => {
  it('ranks an album the viewer rated above one by an artist they know, above a stranger', () => {
    expect(familiarity(candidate(1, { rated: true }))).toBeGreaterThan(familiarity(candidate(1, { knownArtist: true })));
    expect(familiarity(candidate(1, { knownArtist: true }))).toBeGreaterThan(familiarity(candidate(1)));
  });

  it('lifts a rated release above an unknown one, all else equal', () => {
    expect(scoreCandidate(candidate(1, { rated: true, knownArtist: true }), now))
      .toBeGreaterThan(scoreCandidate(candidate(2), now));
  });

  it('keeps adventurousness meaningful: discovery readers are not forced into the familiar', () => {
    const known = candidate(1, { rated: true, knownArtist: true });
    const fresh = candidate(2);
    const cautious = scoreCandidate(known, now, 0) - scoreCandidate(fresh, now, 0);
    const adventurous = scoreCandidate(known, now, 100) - scoreCandidate(fresh, now, 100);
    expect(cautious).toBeGreaterThan(adventurous);
  });

  it('does not let familiarity outweigh a much better predicted match', () => {
    const familiarMeh = candidate(1, { rated: true, knownArtist: true, relevance: 0.1 });
    const unknownGreat = candidate(2, { relevance: 0.95 });
    expect(scoreCandidate(unknownGreat, now)).toBeGreaterThan(scoreCandidate(familiarMeh, now));
  });
});
