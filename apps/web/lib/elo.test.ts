import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ELO,
  SENTIMENT_SEED,
  seedElo,
  kFactor,
  K_PROVISIONAL,
  K_ESTABLISHED,
  K_STABLE,
  PROVISIONAL_GAMES,
  ESTABLISHED_GAMES,
  expectedScore,
  updateElo,
  eloToScore,
  SCORE_MIN,
  SCORE_MAX,
  starToElo,
  STAR_NEUTRAL,
  deriveInstinctScores,
} from './elo';

describe('seedElo', () => {
  it('returns the documented seed for each bucket', () => {
    expect(seedElo('bad')).toBe(SENTIMENT_SEED.bad);
    expect(seedElo('neutral')).toBe(DEFAULT_ELO);
    expect(seedElo('good')).toBe(SENTIMENT_SEED.good);
  });
});

describe('kFactor', () => {
  it('uses K_PROVISIONAL below the provisional threshold', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
  });

  it('uses K_ESTABLISHED between the two thresholds', () => {
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_ESTABLISHED);
    expect(kFactor(ESTABLISHED_GAMES - 1)).toBe(K_ESTABLISHED);
  });

  it('uses K_STABLE at and beyond the established threshold', () => {
    expect(kFactor(ESTABLISHED_GAMES)).toBe(K_STABLE);
    expect(kFactor(ESTABLISHED_GAMES + 1000)).toBe(K_STABLE);
  });
});

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('favors the higher-rated player', () => {
    expect(expectedScore(1600, 1400)).toBeGreaterThan(0.5);
    expect(expectedScore(1400, 1600)).toBeLessThan(0.5);
  });

  it('is symmetric: a vs b + b vs a sums to 1', () => {
    const a = expectedScore(1550, 1470);
    const b = expectedScore(1470, 1550);
    expect(a + b).toBeCloseTo(1, 10);
  });
});

describe('updateElo', () => {
  it('moves the winner up and the loser down for an even matchup', () => {
    const result = updateElo({ score: 1500, games: 0 }, { score: 1500, games: 0 });
    expect(result.winner.score).toBeGreaterThan(1500);
    expect(result.loser.score).toBeLessThan(1500);
  });

  it('increments games played for both sides', () => {
    const result = updateElo({ score: 1500, games: 3 }, { score: 1500, games: 7 });
    expect(result.winner.games).toBe(4);
    expect(result.loser.games).toBe(8);
  });

  it('defaults missing score/games to DEFAULT_ELO and 0', () => {
    const result = updateElo({}, {});
    expect(result.winner.games).toBe(1);
    expect(result.loser.games).toBe(1);
    // With both starting at DEFAULT_ELO and 0 games (K_PROVISIONAL), the winner
    // should gain exactly half of K_PROVISIONAL (expected score 0.5 either way).
    expect(result.winner.score - DEFAULT_ELO).toBeCloseTo(K_PROVISIONAL / 2, 0);
  });

  it('moves a lower-rated upset winner more than a higher-rated expected winner', () => {
    const upset = updateElo({ score: 1400, games: 0 }, { score: 1600, games: 0 });
    const expected = updateElo({ score: 1600, games: 0 }, { score: 1400, games: 0 });
    const upsetGain = upset.winner.score - 1400;
    const expectedGain = expected.winner.score - 1600;
    expect(upsetGain).toBeGreaterThan(expectedGain);
  });

  it('applies a smaller K-factor to a seasoned player', () => {
    const novice = updateElo({ score: 1500, games: 0 }, { score: 1500, games: 0 });
    const veteran = updateElo({ score: 1500, games: 100 }, { score: 1500, games: 100 });
    const noviceGain = novice.winner.score - 1500;
    const veteranGain = veteran.winner.score - 1500;
    expect(veteranGain).toBeLessThan(noviceGain);
  });
});

describe('eloToScore', () => {
  it('maps DEFAULT_ELO to the midpoint of the display scale', () => {
    expect(eloToScore(DEFAULT_ELO)).toBeCloseTo(2.5, 1);
  });

  it('clamps to the documented [0.0, 5.0] range at the extremes', () => {
    expect(eloToScore(0)).toBeGreaterThanOrEqual(SCORE_MIN);
    expect(eloToScore(5000)).toBeLessThanOrEqual(SCORE_MAX);
  });

  it('is monotonically non-decreasing in elo', () => {
    const points = [800, 1200, 1400, 1500, 1600, 1800, 2200];
    const scores = points.map(eloToScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it('lands the sentiment seeds near their documented display anchors', () => {
    // Doc comment: bad 1400 → ~1.4, neutral 1500 → 2.5, good 1600 → ~3.6
    expect(eloToScore(SENTIMENT_SEED.bad)).toBeCloseTo(1.4, 0);
    expect(eloToScore(SENTIMENT_SEED.neutral)).toBeCloseTo(2.5, 0);
    expect(eloToScore(SENTIMENT_SEED.good)).toBeCloseTo(3.6, 0);
  });
});

describe('starToElo', () => {
  it('maps the neutral star rating to DEFAULT_ELO', () => {
    expect(starToElo(STAR_NEUTRAL)).toBe(DEFAULT_ELO);
  });

  it('maps a perfect 5★ rating to a score around 4.3 on the display scale', () => {
    expect(eloToScore(starToElo(5.0))).toBeCloseTo(4.3, 0);
  });

  it('maps the lowest 0.5★ rating to a score under 1.0 on the display scale', () => {
    expect(eloToScore(starToElo(0.5))).toBeLessThan(1.0);
  });

  it('is monotonically increasing in star rating', () => {
    const stars = [0.5, 1, 2, 2.5, 3, 4, 5];
    const elos = stars.map(starToElo);
    for (let i = 1; i < elos.length; i++) {
      expect(elos[i]).toBeGreaterThan(elos[i - 1]);
    }
  });
});

describe('deriveInstinctScores', () => {
  it('maps each item id to its own eloToScore, independent of the others', () => {
    const result = deriveInstinctScores([
      { id: 'a', elo: 1400 },
      { id: 'b', elo: 1500 },
      { id: 'c', elo: 1600 },
    ]);
    expect(result.a).toBe(eloToScore(1400));
    expect(result.b).toBe(eloToScore(1500));
    expect(result.c).toBe(eloToScore(1600));
  });

  it('returns an empty map for an empty list', () => {
    expect(deriveInstinctScores([])).toEqual({});
  });
});
