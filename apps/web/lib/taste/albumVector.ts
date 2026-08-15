/**
 * Composite album representation ("blob"): genre embedding ⊕ era ⊕ scene.
 *
 * Genre similarity alone can't tell a 1985 Japanese city-pop record from a
 * 2024 Korean city-pop revival, and two albums with zero shared tags can
 * still be close in genre-vector space. Scoring combines three blocks:
 *
 *   affinity = W_GENRE·cos(genreVec, cluster.centroid)
 *            + W_ERA · gaussian(year − cluster.meanYear, σ = cluster.sdYears)
 *            + W_SCENE · cluster.sceneShares[scene(country)]
 *
 * evaluated per taste cluster (each of the user's worlds has its own era and
 * scene profile — the k-pop world can be "2020s Korean" while the rock world
 * is "1990s Western") and maxed across clusters. Missing blocks (no release
 * date / no artist country) fall back to a neutral 0.5 so absence of metadata
 * is never a penalty, only never a boost.
 */

export const W_GENRE = 0.65;
export const W_ERA = 0.2;
export const W_SCENE = 0.15;

/** Floor for a cluster's era spread — below this a single-year taste would
 * zero out everything else. */
const SD_FLOOR_YEARS = 8;

export type Scene = 'kr' | 'jp' | 'west' | 'other';

const WEST = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'XW', 'XE']);

export function sceneOf(country: string | null | undefined): Scene | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (c === 'KR') return 'kr';
  if (c === 'JP') return 'jp';
  if (WEST.has(c)) return 'west';
  return 'other';
}

/**
 * Scene implied by a genre tag's *name* (kr/jp only — nothing else is
 * derivable from a tag). Used by the clustering step: the co-occurrence
 * embeddings put j-pop and k-pop at cosine ≈ 0.55 (they share listeners in
 * this catalog), which is above the cluster-join threshold — so without this,
 * a J-pop tag merges into a K-pop-anchored world and the world's country
 * profile then labels it "Korean scene". Verified live 2026-08-10.
 */
export function tagScene(tag: string): Scene | null {
  const t = tag.toLowerCase().replace(/-/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();
  if (t.includes('korean') || /^k (pop|rap|rock|indie|ballad|folk|hip hop|r and b|rnb)\b/.test(t) || t === 'trot') {
    return 'kr';
  }
  if (
    t.includes('japanese') ||
    /^j (pop|rock|rap|hip hop)\b/.test(t) ||
    [
      'city pop',
      'enka',
      'kayokyoku',
      'kayōkyoku',
      'shibuya kei',
      'visual kei',
      'anison',
      'vocaloid',
      'idol kayo',
      'idol kayō',
    ].some((s) => t === s || t.startsWith(`${s} `))
  ) {
    return 'jp';
  }
  return null;
}

export interface EraProfile {
  meanYear: number | null;
  sdYears: number | null;
}

export type SceneShares = Record<Scene, number>;

/** Gaussian era affinity in 0..1 (1 = same year as the cluster's center). */
export function eraAffinity(year: number | null, era: EraProfile): number {
  if (year == null || era.meanYear == null) return 0.5; // neutral when unknown
  const sigma = Math.max(SD_FLOOR_YEARS, era.sdYears ?? SD_FLOOR_YEARS);
  const d = year - era.meanYear;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/** Scene affinity = the cluster's share of listening in the album's scene. */
export function sceneAffinity(scene: Scene | null, shares: SceneShares | null): number {
  if (scene == null || shares == null) return 0.5; // neutral when unknown
  return shares[scene] ?? 0;
}

export function yearOf(firstReleaseDate: string | null | undefined): number | null {
  if (!firstReleaseDate) return null;
  const y = parseInt(firstReleaseDate.slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1900 ? y : null;
}
