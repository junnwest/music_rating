/**
 * Per-user taste profile math: genre weights → taste clusters.
 *
 * genre_weights (maintained incrementally by the ratings trigger in migration
 * 20260712000009, format { "<tag>": { w, n } } where w = Σ(display_score − 3.0))
 * is the persistent part; everything here derives from it in-memory.
 *
 * Users are assumed MULTI-MODAL: instead of collapsing taste into one mushy mean
 * vector, positively-weighted genres are greedily clustered by embedding
 * similarity into up to MAX_CLUSTERS "taste worlds" (e.g. a k-pop + shoegaze
 * listener gets two distinct clusters). Candidate albums are scored against
 * their best-matching cluster, and the Taste page renders one card per cluster.
 *
 * Server-only (pulls in the embeddings artifact).
 */
import { eloToScore } from '../elo';
import { albumCentroid, centroid, cosine, genreVector } from './embeddings';
import { primaryTagOf, tagWeight } from './primaryGenre';

export interface GenreWeightEntry {
  /**
   * Σ (display_score − 3.0) × tag-weight across this user's ratings tagged
   * with this genre — the tag-weight is 1.0 when the genre is the album's
   * PRIMARY genre (scene-first precedence, see primaryGenre.ts), 0.5 for
   * co-tags, so a k-pop album's [k-pop, hip hop, pop] pulls k-pop hardest.
   */
  w: number;
  /** Σ of the same tag-weights (so 3 + w/n stays a true weighted average). */
  n: number;
}

export type GenreWeights = Record<string, GenreWeightEntry>;

export interface ClusterTag {
  tag: string;
  w: number;
  n: number;
  /** The user's average score for albums carrying this tag (3 + w/n). */
  avg: number;
}

export interface TasteCluster {
  tags: ClusterTag[];
  /** Σ positive w across member tags — the cluster's pull. */
  weight: number;
  /** weight / Σ all clusters' weights. */
  share: number;
  centroid: number[];
}

/** Minimum cosine between a tag and a cluster centroid to join that cluster. */
const JOIN_THRESHOLD = 0.45;
const MAX_CLUSTERS = 5;
/** Only the strongest N positive tags participate in clustering. */
const MAX_TAGS = 30;

/**
 * Mirror of the SQL trigger's per-rating weight math, used to self-heal a
 * profile whose rating_count drifted (or compute one for a user rated entirely
 * before the migration backfill).
 */
export function weightsFromRatings(
  rows: { score: number | null; elo_score: number | null; genres: string[] | null }[],
): GenreWeights {
  const weights: GenreWeights = {};
  for (const r of rows) {
    const display = r.score ?? (r.elo_score != null ? eloToScore(r.elo_score) : null);
    if (display == null || !r.genres) continue;
    const primary = primaryTagOf(r.genres);
    for (const raw of r.genres) {
      const tag = raw.trim();
      if (!tag) continue;
      const wt = tagWeight(raw, primary);
      const e = (weights[tag] ??= { w: 0, n: 0 });
      e.w += (display - 3.0) * wt;
      e.n += wt;
    }
  }
  for (const e of Object.values(weights)) {
    e.w = Math.round(e.w * 1000) / 1000;
    e.n = Math.round(e.n * 1000) / 1000;
  }
  return weights;
}

/**
 * Greedy embedding-similarity clustering of the user's positively-weighted
 * genres. Deterministic: tags are visited strongest-first, so the biggest
 * affinities anchor the clusters.
 */
export function buildClusters(weights: GenreWeights): TasteCluster[] {
  const positive = Object.entries(weights)
    .filter(([tag, e]) => e.w > 0 && genreVector(tag) !== null)
    .map(([tag, e]) => ({ tag, w: e.w, n: e.n, avg: round2(3 + e.w / e.n) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, MAX_TAGS);
  if (positive.length === 0) return [];

  interface Working {
    tags: ClusterTag[];
    weight: number;
    centroid: number[];
  }
  const clusters: Working[] = [];

  for (const t of positive) {
    const vec = genreVector(t.tag)!;
    let best: Working | null = null;
    let bestSim = -1;
    for (const c of clusters) {
      const sim = cosine(vec, c.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && (bestSim >= JOIN_THRESHOLD || clusters.length >= MAX_CLUSTERS)) {
      best.tags.push(t);
      best.weight += t.w;
      best.centroid =
        centroid(best.tags.map(({ tag, w }) => ({ tag, weight: w }))) ?? best.centroid;
    } else {
      clusters.push({ tags: [t], weight: t.w, centroid: [...vec] });
    }
  }

  const total = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  return clusters
    .sort((a, b) => b.weight - a.weight)
    .map((c) => ({
      tags: c.tags,
      weight: round2(c.weight),
      share: round2(c.weight / total),
      centroid: c.centroid,
    }));
}

/**
 * Tags the user demonstrably dislikes (weighted average ≤ 2.0 across enough
 * weighted evidence) — used by the reranker as a soft penalty on candidate
 * albums carrying them. Threshold 1.5 in weighted-n units ≈ two albums where
 * the tag was primary+co-tag, or three co-tags.
 */
export function dislikedTags(weights: GenreWeights): Set<string> {
  const out = new Set<string>();
  for (const [tag, e] of Object.entries(weights)) {
    if (e.n >= 1.5 && 3 + e.w / e.n <= 2.0) out.add(tag);
  }
  return out;
}

/**
 * Score an album's genre tags against the user's clusters: cosine to the
 * best-matching cluster, weighted by that cluster's share so dominant worlds
 * pull a bit harder. Returns 0 when either side has no usable vector.
 */
export function albumAffinity(
  genres: string[] | null | undefined,
  clusters: TasteCluster[],
): number {
  if (!genres?.length || clusters.length === 0) return 0;
  const vec = albumCentroid(genres);
  if (!vec) return 0;
  let best = 0;
  for (const c of clusters) {
    // 0.75 flat + 0.25 share-scaled: a niche-but-real cluster still counts.
    const sim = cosine(vec, c.centroid) * (0.75 + 0.25 * c.share);
    if (sim > best) best = sim;
  }
  return best;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
