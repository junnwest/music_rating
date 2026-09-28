import { describe, expect, it } from 'vitest';
import { bucketShares, rankExplore, scoreCandidate } from './ranking';
import type { Candidate } from './types';

const now = Date.parse('2026-09-28T12:00:00Z');
const candidate = (id: number, overrides: Partial<Candidate> = {}): Candidate => ({
  key: `rating:${id}`, author: `author-${id}`, createdAt: new Date(now - 3600000).toISOString(),
  format: 'review', albums: [{ id: `album-${id}`, title: '', artist_display: '', primary_artist_id: `artist-${id}`,
    cover_url: null, release_group_type: 'album', native_title: null }],
  text: 'A thoughtful account of what makes this record worth hearing.', relevance: 0.75,
  authorAffinity: 0.2, response: 0.2, seen: false, knownArtist: false, followed: false, ...overrides,
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
