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
import { albumCentroid, centroid, cosine, genreVector } from './embeddings';
import { canonicalize } from './genreSynonyms';
import { primaryTagOf, tagWeight } from './primaryGenre';
import {
  W_GENRE,
  W_ERA,
  W_SCENE,
  eraAffinity,
  sceneAffinity,
  sceneOf,
  tagScene,
  yearOf,
  type Scene,
  type SceneShares,
} from './albumVector';

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
  /** Scene the world is pinned to by its tag names (kr/jp), or null for a
   *  scene-neutral world (rock, jazz…). A pinned world's scene identity comes
   *  from its genres, NOT from the noisy countries of the albums that happen to
   *  land nearest its centroid — so a J-pop world stays Japanese even when a few
   *  mis-tagged Korean albums assign to it. */
  scene: Scene | null;
}

/** Minimum cosine between a tag and a cluster centroid to join that cluster. */
const JOIN_THRESHOLD = 0.45;
const MAX_CLUSTERS = 5;
/**
 * Absolute ceiling once scene-forced worlds are allowed past MAX_CLUSTERS. A
 * scene-pinned tag with no scene-compatible home (e.g. j-pop when every existing
 * world is Korean/Western) opens its OWN world rather than being drowned in a
 * conflicting-scene cluster — but only up to here, so the map can't sprawl.
 */
const HARD_MAX_CLUSTERS = MAX_CLUSTERS + 2;
/** Only the strongest N positive tags participate in clustering. */
const MAX_TAGS = 30;

/**
 * Mirror of the SQL trigger's per-rating weight math, used to self-heal a
 * profile whose rating_count drifted (or compute one for a user rated entirely
 * before the migration backfill).
 */
export function weightsFromRatings(
  rows: { score: number | null; genres: string[] | null }[],
): GenreWeights {
  const weights: GenreWeights = {};
  for (const r of rows) {
    const display = r.score;
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
 * Cosine at/above which two genre tags are treated as the same genre and folded
 * together. Tuned against this catalog's co-occurrence embeddings: r&b↔soul sit
 * at ≈0.96 (true twins → merge), while indie-rock↔alt-rock ≈0.73 and
 * k-pop↔j-pop ≈0.55 stay distinct. High on purpose — this merges near-synonyms,
 * not whole families, so the map keeps its sub-genre texture.
 */
const NEAR_DUP_COSINE = 0.93;

export interface MergedWeights {
  /** Merged weights keyed by anchor tag — feed this to buildClusters/dislikedTags. */
  weights: GenreWeights;
  /** Spelling-canonical tag → the anchor tag it folded into (identity if none).
   *  Lets callers map an album/candidate's raw genres onto the merged tiles. */
  anchorOf: Record<string, string>;
}

/**
 * Fold near-duplicate genres together for the DERIVED taste map/clusters (the
 * stored `genre_weights` row keeps its raw keys — iOS reads it). Two stages:
 *   1. spelling canonicalization (k-pop / kpop / korean pop → k-pop), and
 *   2. embedding near-twin fold — positively-weighted tags within `NEAR_DUP_COSINE`
 *      collapse into the stronger anchor (soul → r&b), summing weights so the
 *      combined `3 + w/n` stays a true weighted average.
 * Disliked (w ≤ 0) tags are never folded, so dislike detection is untouched.
 */
export function mergeSynonymWeights(weights: GenreWeights): MergedWeights {
  // Stage 1 — spelling canonicalization.
  const spelled: GenreWeights = {};
  for (const [tag, e] of Object.entries(weights)) {
    const key = canonicalize(tag);
    const acc = (spelled[key] ??= { w: 0, n: 0 });
    acc.w += e.w;
    acc.n += e.n;
  }
  // Stage 2 — embedding near-twin fold, strongest tag anchoring each group.
  const anchorOf: Record<string, string> = {};
  const anchors: { tag: string; w: number; n: number; vec: number[] | null }[] = [];
  const entries = Object.entries(spelled)
    .map(([tag, e]) => ({ tag, w: e.w, n: e.n, vec: genreVector(tag) }))
    .sort((a, b) => b.w - a.w);
  for (const e of entries) {
    let target: { tag: string; w: number; n: number; vec: number[] | null } | null = null;
    if (e.w > 0 && e.vec) {
      for (const a of anchors) {
        if (a.w > 0 && a.vec && cosine(e.vec, a.vec) >= NEAR_DUP_COSINE) {
          target = a;
          break;
        }
      }
    }
    if (target) {
      target.w += e.w;
      target.n += e.n;
      anchorOf[e.tag] = target.tag;
    } else {
      anchors.push({ tag: e.tag, w: e.w, n: e.n, vec: e.vec });
      anchorOf[e.tag] = e.tag;
    }
  }
  const out: GenreWeights = {};
  for (const a of anchors) {
    out[a.tag] = { w: Math.round(a.w * 1000) / 1000, n: Math.round(a.n * 1000) / 1000 };
  }
  return { weights: out, anchorOf };
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
    /** Scene implied by the anchor tag's name (kr/jp), if any. */
    scene: Scene | null;
  }
  const clusters: Working[] = [];

  for (const t of positive) {
    const vec = genreVector(t.tag)!;
    const scene = tagScene(t.tag);
    // Scene-aware join: a tag whose *name* pins it to a scene (j-pop → jp)
    // never joins a cluster anchored to a different scene (k-pop → kr), even
    // when the co-occurrence embeddings put them close (j-pop↔k-pop ≈ 0.55 in
    // this catalog). Without this the "J-Pop world" merged into the K-Pop one
    // and inherited its "Korean scene" label. Clusters with no implied scene
    // (rock, jazz…) accept everything, as before.
    let best: Working | null = null;
    let bestSim = -1;
    let bestAny: Working | null = null;
    let bestAnySim = -1;
    for (const c of clusters) {
      const sim = cosine(vec, c.centroid);
      if (sim > bestAnySim) {
        bestAnySim = sim;
        bestAny = c;
      }
      const conflict = scene != null && c.scene != null && scene !== c.scene;
      if (!conflict && sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    let joinTarget: Working | null;
    if (best && bestSim >= JOIN_THRESHOLD) {
      // A genuinely similar, scene-compatible home — the normal join.
      joinTarget = best;
    } else if (clusters.length < MAX_CLUSTERS) {
      // Room under the soft cap → open a fresh world (handled by the else below).
      joinTarget = null;
    } else if (best) {
      // At the cap, forced — but a scene-compatible cluster exists, so use it.
      joinTarget = best;
    } else if (scene != null && clusters.length < HARD_MAX_CLUSTERS) {
      // At the cap with NO scene-compatible home, and this tag's name pins it to
      // a scene (j-pop → jp): give it its own world instead of force-merging it
      // into a conflicting-scene cluster (which buried j-pop inside the k-pop
      // world — no J-pop sub-genres, and k-pop recommendations). Bounded by the
      // hard ceiling so a long tail of scene tags can't sprawl the map.
      joinTarget = null;
    } else {
      // A scene-neutral tag (or the ceiling is hit): fall back to the nearest.
      joinTarget = bestAny;
    }
    if (joinTarget) {
      joinTarget.tags.push(t);
      joinTarget.weight += t.w;
      joinTarget.centroid =
        centroid(joinTarget.tags.map(({ tag, w }) => ({ tag, weight: w }))) ??
        joinTarget.centroid;
      // A scene-pinned tag LOCKS an as-yet-unpinned cluster to its scene, so a
      // later tag from a conflicting scene can no longer land here. Without this
      // a world anchored by a scene-neutral tag (e.g. "pop") would absorb both
      // k-pop and j-pop — the co-occurrence embeddings place them ≈ 0.55 apart —
      // and its country profile would then mislabel the whole world (and the
      // nested j-pop tag) as "Korean scene". The anchor-only check missed this.
      if (joinTarget.scene == null && scene != null) joinTarget.scene = scene;
    } else {
      clusters.push({ tags: [t], weight: t.w, centroid: [...vec], scene });
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
      scene: c.scene,
    }));
}

export interface ClusterProfile {
  /** Mean release year of the user's ratings assigned to this cluster. */
  meanYear: number | null;
  sdYears: number | null;
  /** Share of this cluster's ratings per scene (sums to 1 over known scenes). */
  sceneShares: SceneShares | null;
  /** Dominant scene if one holds ≥ 0.5 share. */
  dominantScene: Scene | null;
  ratingCount: number;
}

/**
 * Era + scene profile per taste cluster: each rated album is assigned to its
 * best-matching cluster (genre-centroid cosine), then per-cluster release-year
 * stats and scene shares are computed. This is what makes the blob scoring
 * multi-modal — the k-pop world can be "2020s Korean" while the rock world is
 * "1990s Western", and candidates are judged against the right one.
 */
export function clusterProfiles(
  rows: {
    genres: string[] | null;
    first_release_date: string | null;
    country: string | null;
  }[],
  clusters: TasteCluster[],
): ClusterProfile[] {
  const buckets: { years: number[]; scenes: Scene[] }[] = clusters.map(() => ({
    years: [],
    scenes: [],
  }));
  for (const r of rows) {
    const vec = albumCentroid(r.genres);
    if (!vec || clusters.length === 0) continue;
    let best = 0;
    let bestSim = -1;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosine(vec, clusters[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    }
    const year = yearOf(r.first_release_date);
    if (year != null) buckets[best].years.push(year);
    const scene = sceneOf(r.country);
    if (scene != null) buckets[best].scenes.push(scene);
  }
  return buckets.map((b, i) => {
    const meanYear =
      b.years.length > 0 ? b.years.reduce((s, y) => s + y, 0) / b.years.length : null;
    const sdYears =
      meanYear != null && b.years.length > 1
        ? Math.sqrt(b.years.reduce((s, y) => s + (y - meanYear) ** 2, 0) / b.years.length)
        : null;
    let sceneShares: SceneShares | null = null;
    let dominantScene: Scene | null = null;
    const pinned = clusters[i]?.scene ?? null;
    if (pinned) {
      // Scene-pinned world (j-pop/k-pop…): its scene identity is its genre's, not
      // the countries of albums that landed nearest its centroid. Forcing the
      // share also keeps blobAffinity from rewarding cross-scene recs (the K-pop-
      // in-the-J-pop-world bug).
      sceneShares = { kr: 0, jp: 0, west: 0, other: 0 };
      sceneShares[pinned] = 1;
      dominantScene = pinned;
    } else if (b.scenes.length > 0) {
      sceneShares = { kr: 0, jp: 0, west: 0, other: 0 };
      for (const sc of b.scenes) sceneShares[sc] += 1 / b.scenes.length;
      const top = (Object.entries(sceneShares) as [Scene, number][]).sort((a, x) => x[1] - a[1])[0];
      if (top[1] >= 0.5) dominantScene = top[0];
    }
    return {
      meanYear: meanYear != null ? Math.round(meanYear) : null,
      sdYears: sdYears != null ? Math.round(sdYears * 10) / 10 : null,
      sceneShares,
      dominantScene,
      ratingCount: Math.max(b.years.length, b.scenes.length),
    };
  });
}

/**
 * Composite blob affinity of a candidate album against the user's worlds:
 * per cluster, genre cosine + era gaussian + scene share (weighted), maxed
 * across clusters — so a candidate only needs to fit ONE world well, judged
 * on that world's own era/scene profile. Falls back to pure genre affinity
 * when profiles are absent.
 */
export function blobAffinity(
  album: { genres: string[] | null | undefined; year: number | null; scene: Scene | null },
  clusters: TasteCluster[],
  profiles: ClusterProfile[] | null,
): number {
  if (!album.genres?.length || clusters.length === 0) return 0;
  const vec = albumCentroid(album.genres);
  if (!vec) return 0;
  let best = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const genre = cosine(vec, c.centroid) * (0.75 + 0.25 * c.share);
    const p = profiles?.[i];
    const score = p
      ? W_GENRE * genre +
        W_ERA * eraAffinity(album.year, { meanYear: p.meanYear, sdYears: p.sdYears }) +
        W_SCENE * sceneAffinity(album.scene, p.sceneShares)
      : genre;
    if (score > best) best = score;
  }
  return best;
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
