// Shared Silla Score math, used by the leaderboard, rankings, and album pages so
// every surface agrees on how an album ranks.
//
// The combined score is `0.55 · ratingScore + 0.45 · rankScore` (ratings lead).
//   • ratingScore — Bayesian-damped, per-user-calibrated star rating mapped to [0,1].
//     Computed server-side by the get_silla_rating_scores / get_calibrated_bayesian_scores
//     RPCs (damping m=3, so ratings actually differentiate albums).
//   • rankScore   — tier-list positions and seed votes, each normalized to [0,1]
//     within the category, then blended `0.7 · tierlists + 0.3 · seeds` so that real
//     user tier-lists outweigh the pre-launch seed priors.

export interface RankingEntry {
  ranking_id: string;
  release_id: string;
  rank: number;
}

/** Bayesian fallback for releases with no ratings (global prior μ). */
export const SILLA_PRIOR = 2.75;

// Within the 45% rank half, how much real user tier-lists count vs. seed priors.
const TIERLIST_WEIGHT = 0.7;
const SEED_WEIGHT = 0.3;

// Top-level split between personal ratings and tier-list standing.
const RATING_WEIGHT = 0.55;
const RANK_WEIGHT = 0.45;

/**
 * Per-album tier-list score: every user tier-list contributes `1 / position`
 * to each album it contains (ties at the same rank share an averaged position).
 * Returns the summed raw score per release — NOT yet normalized.
 */
export function computeTierlistScores(entries: RankingEntry[]): Map<string, number> {
  const byRanking = new Map<string, { release_id: string; rank: number }[]>();
  for (const e of entries) {
    if (!byRanking.has(e.ranking_id)) byRanking.set(e.ranking_id, []);
    byRanking.get(e.ranking_id)!.push(e);
  }

  const scores = new Map<string, number>();
  for (const userEntries of byRanking.values()) {
    const byRank = new Map<number, string[]>();
    for (const e of userEntries) {
      if (!byRank.has(e.rank)) byRank.set(e.rank, []);
      byRank.get(e.rank)!.push(e.release_id);
    }

    let pos = 1;
    for (const [, albums] of [...byRank.entries()].sort(([a], [b]) => a - b)) {
      const t = albums.length;
      const effectivePos = pos + (t - 1) / 2;
      const score = 1 / effectivePos;
      for (const releaseId of albums) {
        scores.set(releaseId, (scores.get(releaseId) ?? 0) + score);
      }
      pos += t;
    }
  }
  return scores;
}

export interface CombineInput {
  /** Every release that should appear: tier-listed ∪ seeded ∪ rated-and-matching. */
  candidateIds: string[];
  /** Raw tier-list scores from computeTierlistScores (un-normalized). */
  tierlistRaw: Map<string, number>;
  /** Raw seed votes per release. */
  seedRaw: Map<string, number>;
  /** Bayesian-damped calibrated rating per release (from the RPC). */
  bayesianMap: Map<string, number>;
}

/**
 * Blend ratings + tier-lists + seeds into a single [0,1] score per release.
 * Tier-lists and seeds are each normalized within the category before blending,
 * so a handful of real tier-lists are never drowned out by large seed-vote counts.
 */
export function combineSillaScores(input: CombineInput): Map<string, number> {
  const maxTier = Math.max(0, ...input.tierlistRaw.values()) || 1;
  const maxSeed = Math.max(0, ...input.seedRaw.values()) || 1;

  const combined = new Map<string, number>();
  for (const id of input.candidateIds) {
    const tierNorm = (input.tierlistRaw.get(id) ?? 0) / maxTier; // [0,1]
    const seedNorm = (input.seedRaw.get(id) ?? 0) / maxSeed; // [0,1]
    const rankScore = TIERLIST_WEIGHT * tierNorm + SEED_WEIGHT * seedNorm; // [0,1]

    const bayes = input.bayesianMap.get(id) ?? SILLA_PRIOR;
    const ratingScore = Math.max(0, Math.min(1, (bayes - 0.5) / 4.5)); // [0,1]

    combined.set(id, RATING_WEIGHT * ratingScore + RANK_WEIGHT * rankScore);
  }
  return combined;
}
