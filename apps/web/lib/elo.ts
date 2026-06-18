/**
 * Math for Instinct rating mode (pairwise comparisons), modeled on Beli/Podiums.
 *
 * Pure, dependency-free so the iOS (Swift) and web sessions derive identical
 * scores — keep this file free of any Next/Supabase imports and mirror it
 * exactly in Swift. See WEB_PARITY.md §4.
 *
 * The model (decided 2026-06-17):
 *   1. A new album gets a gut-check bucket (bad / neutral / good). The bucket is
 *      a SOFT SEED, not a hard band — it only sets where the album's Elo starts
 *      so comparisons begin near its likely position (`seedElo`).
 *   2. "Which do you prefer?" comparisons nudge two albums' Elo up/down
 *      (`updateElo`). Elo is just the ordering engine — there is ONE global
 *      ranked list per user, so an album can freely cross former bucket lines.
 *   3. The DISPLAYED score (0.0–5.0) is the album's position in that single
 *      ranked list, linearly interpolated (`scoreFromRank` / `deriveInstinctScores`).
 *      Scores are fully relative: the user's #1 ≈ 5.0, their lowest ≈ 0.0.
 */

/** Starting rating for a release with no bucket / no prior rating. */
export const DEFAULT_ELO = 1500;

/**
 * Instinct scores stay hidden until the user has rated at least this many
 * albums — the gut-check buckets carry the first few before relative scores
 * mean anything.
 */
export const INSTINCT_REVEAL_THRESHOLD = 5;

/** Gut-check buckets shown before/while there isn't enough comparison data. */
export type Sentiment = 'bad' | 'neutral' | 'good';

/**
 * Initial Elo each bucket seeds. Soft starting points only — comparisons can
 * carry an album well past these into another bucket's territory.
 */
export const SENTIMENT_SEED: Record<Sentiment, number> = {
  bad: 1400,
  neutral: 1500,
  good: 1600,
};

export function seedElo(sentiment: Sentiment): number {
  return SENTIMENT_SEED[sentiment];
}

/**
 * K-factor schedule. New releases move fast so a few comparisons place them
 * roughly; once a release has played enough games its rating stabilises.
 */
export const K_PROVISIONAL = 40; // < PROVISIONAL_GAMES games played
export const K_ESTABLISHED = 24; // < ESTABLISHED_GAMES games played
export const K_STABLE = 16; // thereafter
export const PROVISIONAL_GAMES = 10;
export const ESTABLISHED_GAMES = 30;

export function kFactor(gamesPlayed: number): number {
  if (gamesPlayed < PROVISIONAL_GAMES) return K_PROVISIONAL;
  if (gamesPlayed < ESTABLISHED_GAMES) return K_ESTABLISHED;
  return K_STABLE;
}

/**
 * Expected score (win probability) of player A against player B under the
 * standard logistic Elo curve. Returns a value in (0, 1).
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface EloPlayer {
  /** Current Elo rating. Pass `DEFAULT_ELO` (or null/undefined) for a release with no prior rating. */
  score?: number | null;
  /** Number of comparisons this release has been part of. */
  games?: number | null;
}

export interface EloResult {
  score: number;
  games: number;
}

export interface EloUpdate {
  winner: EloResult;
  loser: EloResult;
}

/**
 * Update two releases' Elo ratings after one pairwise comparison where
 * `winner` was preferred over `loser`. Each player's own K-factor is applied
 * based on the games it had played going in.
 *
 * Ratings are rounded to whole numbers (Elo is conventionally integer-valued)
 * and game counts are incremented by one.
 */
export function updateElo(winner: EloPlayer, loser: EloPlayer): EloUpdate {
  const winnerScore = winner.score ?? DEFAULT_ELO;
  const loserScore = loser.score ?? DEFAULT_ELO;
  const winnerGames = winner.games ?? 0;
  const loserGames = loser.games ?? 0;

  const winnerExpected = expectedScore(winnerScore, loserScore);
  const loserExpected = expectedScore(loserScore, winnerScore);

  const newWinnerScore = winnerScore + kFactor(winnerGames) * (1 - winnerExpected);
  const newLoserScore = loserScore + kFactor(loserGames) * (0 - loserExpected);

  return {
    winner: { score: Math.round(newWinnerScore), games: winnerGames + 1 },
    loser: { score: Math.round(newLoserScore), games: loserGames + 1 },
  };
}

/** Displayed-score bounds (matches the 0.0–5.0 Instinct scale, 0.1 steps). */
export const SCORE_MIN = 0.0;
export const SCORE_MAX = 5.0;

/**
 * Derive the displayed 0.0–5.0 score from an album's position in the user's
 * single ranked list (best → worst), rounded to 0.1.
 *
 * `rankFromTop`: 0 = the user's #1 (highest Elo); `total - 1` = their lowest.
 * Pure relative interpolation — top of list → 5.0, bottom → 0.0. With 0 or 1
 * items there is no relative position, so it returns the midpoint 2.5.
 */
export function scoreFromRank(rankFromTop: number, total: number): number {
  if (total <= 1) return 2.5;
  const frac = (total - 1 - rankFromTop) / (total - 1); // 1 at top → 0 at bottom
  const score = SCORE_MIN + frac * (SCORE_MAX - SCORE_MIN);
  return Math.round(score * 10) / 10;
}

/**
 * Convenience for read paths: given the user's rated albums with their Elo,
 * return a map of release id → derived 0.0–5.0 display score by rank.
 * Sorted by Elo descending; ties resolve by input order.
 */
export function deriveInstinctScores(
  items: { id: string; elo: number }[],
): Record<string, number> {
  const sorted = [...items].sort((a, b) => b.elo - a.elo);
  const total = sorted.length;
  const out: Record<string, number> = {};
  sorted.forEach((item, i) => {
    out[item.id] = scoreFromRank(i, total);
  });
  return out;
}
