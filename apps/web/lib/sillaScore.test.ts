import { describe, it, expect } from 'vitest';
import { computeTierlistScores, combineSillaScores, SILLA_PRIOR } from './sillaScore';

describe('computeTierlistScores', () => {
  it('gives rank 1 a raw score of 1 within a single tier-list', () => {
    const scores = computeTierlistScores([
      { ranking_id: 'u1', release_id: 'a', rank: 1 },
      { ranking_id: 'u1', release_id: 'b', rank: 2 },
      { ranking_id: 'u1', release_id: 'c', rank: 3 },
    ]);
    expect(scores.get('a')).toBeCloseTo(1, 10);
    expect(scores.get('b')).toBeCloseTo(0.5, 10);
    expect(scores.get('c')).toBeCloseTo(1 / 3, 10);
  });

  it('sums contributions across multiple tier-lists for the same release', () => {
    const scores = computeTierlistScores([
      { ranking_id: 'u1', release_id: 'a', rank: 1 },
      { ranking_id: 'u2', release_id: 'a', rank: 1 },
    ]);
    expect(scores.get('a')).toBeCloseTo(2, 10);
  });

  it('splits a tied rank across an averaged effective position', () => {
    // Two releases tied at rank 1 in a 2-item list: both should get 1/1.5, not 1/1.
    const scores = computeTierlistScores([
      { ranking_id: 'u1', release_id: 'a', rank: 1 },
      { ranking_id: 'u1', release_id: 'b', rank: 1 },
    ]);
    expect(scores.get('a')).toBeCloseTo(1 / 1.5, 10);
    expect(scores.get('b')).toBeCloseTo(1 / 1.5, 10);
  });

  it('keeps different rankers independent — one ranker cannot affect another\'s positions', () => {
    const scores = computeTierlistScores([
      { ranking_id: 'u1', release_id: 'a', rank: 1 },
      { ranking_id: 'u2', release_id: 'b', rank: 1 },
      { ranking_id: 'u2', release_id: 'c', rank: 2 },
    ]);
    expect(scores.get('a')).toBeCloseTo(1, 10);
    expect(scores.get('b')).toBeCloseTo(1, 10);
    expect(scores.get('c')).toBeCloseTo(0.5, 10);
  });

  it('returns an empty map for no entries', () => {
    expect(computeTierlistScores([]).size).toBe(0);
  });
});

describe('combineSillaScores', () => {
  it('gives the release with the best tier-list, seed, and rating a combined score of 1', () => {
    const combined = combineSillaScores({
      candidateIds: ['a'],
      tierlistRaw: new Map([['a', 10]]),
      seedRaw: new Map([['a', 10]]),
      bayesianMap: new Map([['a', 5.0]]),
    });
    expect(combined.get('a')).toBeCloseTo(1, 10);
  });

  it('falls back to the global prior when a release has no rating data', () => {
    const combined = combineSillaScores({
      candidateIds: ['a'],
      tierlistRaw: new Map(),
      seedRaw: new Map(),
      bayesianMap: new Map(),
    });
    const expectedRatingScore = Math.max(0, Math.min(1, (SILLA_PRIOR - 0.5) / 4.5));
    expect(combined.get('a')).toBeCloseTo(0.55 * expectedRatingScore, 10);
  });

  it('normalizes tier-list and seed scores within the candidate set, not against an absolute scale', () => {
    const combined = combineSillaScores({
      candidateIds: ['a', 'b'],
      tierlistRaw: new Map([['a', 5], ['b', 10]]),
      seedRaw: new Map(),
      bayesianMap: new Map(),
    });
    // b has double a's raw tier-list score, so b's rank contribution should be
    // exactly double a's (both normalized against the same max of 10).
    const ratingScore = Math.max(0, Math.min(1, (SILLA_PRIOR - 0.5) / 4.5));
    const base = 0.55 * ratingScore;
    const aRank = (combined.get('a')! - base) / 0.45;
    const bRank = (combined.get('b')! - base) / 0.45;
    expect(bRank).toBeCloseTo(aRank * 2, 10);
  });

  it('weights ratings and rank 0.55/0.45 as documented', () => {
    const allRating = combineSillaScores({
      candidateIds: ['a'],
      tierlistRaw: new Map(),
      seedRaw: new Map(),
      bayesianMap: new Map([['a', 5.0]]), // ratingScore = 1, rankScore = 0
    });
    expect(allRating.get('a')).toBeCloseTo(0.55, 10);

    const allRank = combineSillaScores({
      candidateIds: ['a'],
      tierlistRaw: new Map([['a', 1]]),
      seedRaw: new Map(),
      bayesianMap: new Map([['a', 0.5]]), // ratingScore = 0
    });
    expect(allRank.get('a')).toBeCloseTo(0.45 * 0.7, 10); // only tierlist half of rank contributes
  });
});
