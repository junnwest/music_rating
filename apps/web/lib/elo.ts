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
 * Spread (in Elo points) of the display S-curve. Larger = flatter (a score
 * moves less per Elo point). 250 makes the sentiment seeds land at fixed,
 * absolute display anchors: bad 1400 → ~1.4, neutral 1500 → 2.5, good 1600 → ~3.6.
 */
export const SCORE_SPREAD = 250;

/**
 * Map an Elo rating to the displayed 0.0–5.0 score via a logistic (S-curve)
 * centered on DEFAULT_ELO.
 *
 * This is ABSOLUTE, not a relative rank interpolation: the bad/neutral/good
 * seed (and imported star ratings via `starToElo`) anchor a release to a score
 * region, and comparisons move it continuously from there. So a library of only
 * loved albums clusters high instead of being smeared down to 0.0, and the
 * gut-check answer genuinely shapes the score. The curve compresses at the
 * extremes, so 0.0 / 5.0 must be *earned* through comparisons, not handed out by
 * a seed. Elo is still one global list, so a release can cross former bucket
 * lines freely (soft seeds, not sealed tiers).
 */
export function eloToScore(elo: number): number {
  const raw = SCORE_MAX / (1 + Math.pow(10, (DEFAULT_ELO - elo) / SCORE_SPREAD));
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, raw));
  return Math.round(clamped * 10) / 10;
}

/** Star anchors for importing Manual ratings onto the Elo scale. */
export const STAR_NEUTRAL = 2.5; // a 2.5★ rating imports to DEFAULT_ELO (display 2.5)
export const ELO_PER_STAR = 80; // each star above/below STAR_NEUTRAL shifts the seed Elo

/**
 * Map an existing 0.5–5.0 star rating to a seed Elo, used when a user switches
 * Manual → Instinct and imports their star ratings. Linear in star value and
 * deliberately compressed (5★ → ~1700 → display ~4.3, 0.5★ → ~1340 → ~0.9): the
 * import is faithful to the old stars on day one but leaves headroom so the
 * extremes are still earned by comparisons rather than imported outright.
 */
export function starToElo(score: number): number {
  return Math.round(DEFAULT_ELO + (score - STAR_NEUTRAL) * ELO_PER_STAR);
}

/**
 * "Games" credited to an imported star rating so it immediately uses the slow,
 * stable K-factor (K_STABLE) instead of the fast provisional one. Imported
 * scores should drift *gradually* — roughly a 1-point drop over ~15–20 lost
 * comparisons — rather than lurch after a single pick. Brand-new Instinct
 * ratings keep 0 games so they place quickly (K_PROVISIONAL). See `kFactor`.
 */
export const IMPORT_GAMES = ESTABLISHED_GAMES; // 30 → K_STABLE (16)

/**
 * Convenience for read paths: given the user's rated albums with their Elo,
 * return a map of release id → derived 0.0–5.0 display score. Each score is the
 * album's own absolute `eloToScore` (independent of the others' positions).
 */
export function deriveInstinctScores(
  items: { id: string; elo: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.id] = eloToScore(item.elo);
  return out;
}
