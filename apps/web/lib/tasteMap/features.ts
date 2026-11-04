/**
 * Feature space for the taste map (TASTE_MAP_PLAN.md D1, D6, D8): the user's
 * artists → era segments (eras.ts) → one node per segment the user rated in, each
 * with four separately L2-normalized blocks:
 *
 *   tags   TF-IDF over language-qualified taxonomy nodes + their ancestors. The
 *          interpretable block: every dimension is a genre with a name, so it is
 *          the one the personal metric learns per-dimension weights on.
 *   text   the segment's pooled jina embedding, PCA'd to ≤ 64 dims across the
 *          user's nodes. Centering on the user's own mean matters: raw jina album
 *          vectors all sit at cos ≈ 0.7+, which would make everything "similar".
 *   graph  Last.fm / ListenBrainz similar-artist lists as a node × artist matrix,
 *          SVD'd to ≤ 32 dims. "Listeners overlap."
 *   era    decade bumps + scene, so 1985 city pop and 2024 city-pop revival differ.
 *
 * Similarity is weighted cosine over the concatenation, which splits EXACTLY into
 * per-dimension terms w_k·a_k·b_k — that's what explain() returns (D8), no SHAP.
 *
 * Pure: no DB, no new deps (the PCA is a small deterministic eigen-solver below).
 */
import { qualifiedInfo, qualify } from '../genres/language';
import { itunesTag, ITUNES_WEIGHT, resolveEvidenceTag } from '../genres/placement';
import { toArtistEvidence, type StoredGenreEvidence } from '../genres/artistEvidence';
import { fold } from '../genres/resolver';
import { sceneOf, type Scene } from '../taste/albumVector';
import { albumLang, albumTagVector, closureOf, splitEras } from './eras';
import {
  BLOCKS,
  type BlockName,
  type Contribution,
  type EraOverride,
  type EraSegment,
  type FeatureSpace,
  type MapAlbumInput,
  type MapArtistInput,
  type MapNode,
  type MapUserInput,
  type MetricWeights,
  type TagDim,
} from './types';

// ── constants ────────────────────────────────────────────────────────────────

/**
 * Default block weights, until the personal metric (metric.ts) learns otherwise.
 * Era is halved: at 1 the "same era & scene" term was the top contributor in most
 * pairs and squeezed each language island into one blob. 0.5 was picked from 2D
 * renders of zero's map (1 / 0.5 / 0.25, 2026-11-03), where it spreads the groups
 * and puts Bastille between Pop and Oasis/Radiohead. Halving scene alone
 * (ERA_SCENE_SHARE 0.3) didn't merge the East Asian and Western islands: those come
 * from language-qualified tags and the listener graph.
 */
export const DEFAULT_BLOCK_WEIGHTS: Readonly<Record<BlockName, number>> = { tags: 1, text: 1, graph: 1, era: 0.5 };
export const DEFAULT_METRIC: MetricWeights = { block: { ...DEFAULT_BLOCK_WEIGHTS }, tagDims: null };

/** An unrated catalog album in the segment counts this much of a rated one in the
 *  tag/text pools: it says what the era sounds like, but the user's own picks say
 *  more about what of it they listen to. */
export const UNRATED_ALBUM_WEIGHT = 0.35;

/** The artist prior (genre_evidence) relative to the album pool (whose entries
 *  peak at 1): enough to tag an untagged artist, low enough that an era's own
 *  album tags decide the difference between eras. */
export const ARTIST_EVIDENCE_WEIGHT = 0.3;

export const TEXT_DIMS = 64;
export const GRAPH_DIMS = 32;

/** Weight of the artist's own column in the graph matrix — makes "A lists B"
 *  a direct A↔B link (row A has B's column at match m, row B has it at this). */
export const GRAPH_SELF_WEIGHT = 1;

/** Decade bump centers and width (years) for the era block. */
export const ERA_CENTERS: readonly number[] = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030];
export const ERA_SIGMA = 8;
export const SCENES: readonly Scene[] = ['kr', 'jp', 'west', 'other'];
/** Year vs scene inside the era block (squares sum to 1): same decade/other scene
 *  ≈ 0.64, same scene/other decade ≈ 0.36. */
export const ERA_YEAR_SHARE = 0.8;
export const ERA_SCENE_SHARE = 0.6;

/** Contribution labels for the non-tag blocks (D8). */
export const BLOCK_LABELS: Readonly<Record<Exclude<BlockName, 'tags'>, string>> = {
  text: 'described alike',
  graph: 'listeners overlap',
  era: 'same era & scene',
};

// ── small vector helpers ─────────────────────────────────────────────────────

function norm(v: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/** L2-normalize; returns [vector, true] or [zeros, false] for a (near-)zero input. */
function unit(v: number[]): [number[], boolean] {
  const n = norm(v);
  if (!(n > 1e-12)) return [v.map(() => 0), false];
  return [v.map((x) => x / n), true];
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ── PCA (deterministic, dependency-free) ─────────────────────────────────────

/** Cyclic Jacobi eigen-decomposition of a symmetric n×n matrix (row-major).
 *  Returns eigenvalues (descending) and eigenvectors as columns of `vecs` (n×n). */
function jacobiEigen(a: Float64Array, n: number): { vals: number[]; vecs: Float64Array } {
  const A = Float64Array.from(a);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p];
        const aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p];
          const akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k];
          const aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p];
          const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => A[j * n + j] - A[i * n + i] || i - j);
  const vecs = new Float64Array(n * n);
  order.forEach((src, dst) => {
    for (let k = 0; k < n; k++) vecs[k * n + dst] = V[k * n + src];
  });
  return { vals: order.map((i) => A[i * n + i]), vecs };
}

/** Modified Gram–Schmidt on the columns of an n×m matrix (row-major), in place. */
function orthonormalize(Q: Float64Array, n: number, m: number): void {
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < j; i++) {
      let d = 0;
      for (let k = 0; k < n; k++) d += Q[k * m + i] * Q[k * m + j];
      for (let k = 0; k < n; k++) Q[k * m + j] -= d * Q[k * m + i];
    }
    let s = 0;
    for (let k = 0; k < n; k++) s += Q[k * m + j] ** 2;
    const nn = Math.sqrt(s);
    for (let k = 0; k < n; k++) Q[k * m + j] = nn > 1e-12 ? Q[k * m + j] / nn : 0;
  }
}

/** Above this many rows, orthogonal (subspace) iteration replaces a full Jacobi. */
const FULL_EIGEN_MAX = 96;
const SUBSPACE_ITERS = 30;
const OVERSAMPLE = 8;

/**
 * Top-k principal scores from an n×n Gram matrix G = X·Xᵀ (centered X for PCA,
 * raw X for an uncentered SVD): row i = U_i·√λ, i.e. X_i projected on the top-k
 * right singular vectors — without ever forming the d-dim side. Small n solves
 * exactly (Jacobi); large n uses orthogonal iteration from a fixed seed plus a
 * Rayleigh–Ritz step. Eigenvector signs are fixed (largest |entry| positive) so
 * the output is stable run to run.
 */
export function gramScores(G: Float64Array, n: number, k: number): number[][] {
  if (n === 0 || k <= 0) return Array.from({ length: n }, () => new Array(Math.max(k, 0)).fill(0));
  let U: Float64Array;
  let vals: number[];
  let m: number;
  if (n <= FULL_EIGEN_MAX) {
    const e = jacobiEigen(G, n);
    U = e.vecs;
    vals = e.vals;
    m = n;
  } else {
    m = Math.min(n, k + OVERSAMPLE);
    let Q = new Float64Array(n * m);
    let seed = 0x9e3779b9;
    for (let i = 0; i < Q.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      Q[i] = seed / 2 ** 32 - 0.5;
    }
    orthonormalize(Q, n, m);
    for (let it = 0; it < SUBSPACE_ITERS; it++) {
      const Z = new Float64Array(n * m);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const g = G[r * n + c];
          if (g === 0) continue;
          for (let j = 0; j < m; j++) Z[r * m + j] += g * Q[c * m + j];
        }
      }
      orthonormalize(Z, n, m);
      Q = Z;
    }
    // Rayleigh–Ritz: T = Qᵀ G Q, eigen-solve the small m×m, rotate Q.
    const GQ = new Float64Array(n * m);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const g = G[r * n + c];
        if (g === 0) continue;
        for (let j = 0; j < m; j++) GQ[r * m + j] += g * Q[c * m + j];
      }
    const T = new Float64Array(m * m);
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let r = 0; r < n; r++) s += Q[r * m + i] * GQ[r * m + j];
        T[i * m + j] = s;
      }
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++) T[i * m + j] = T[j * m + i] = (T[i * m + j] + T[j * m + i]) / 2;
    const e = jacobiEigen(T, m);
    U = new Float64Array(n * m);
    for (let r = 0; r < n; r++)
      for (let j = 0; j < m; j++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += Q[r * m + i] * e.vecs[i * m + j];
        U[r * m + j] = s;
      }
    vals = e.vals;
  }
  const top = Math.max(vals[0] ?? 0, 0);
  const out = Array.from({ length: n }, () => new Array(k).fill(0));
  for (let j = 0; j < Math.min(k, m); j++) {
    const lam = vals[j];
    if (!(lam > top * 1e-10) || lam <= 0) continue;
    let big = 0;
    for (let r = 0; r < n; r++) if (Math.abs(U[r * m + j]) > Math.abs(big)) big = U[r * m + j];
    const sign = big < 0 ? -1 : 1;
    const s = Math.sqrt(lam) * sign;
    for (let r = 0; r < n; r++) out[r][j] = U[r * m + j] * s;
  }
  return out;
}

// ── tags ─────────────────────────────────────────────────────────────────────

/** The artist's most common album language (null when none is known). */
function artistLang(langs: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const l of langs) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [l, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (c > n) {
      best = l;
      n = c;
    }
  }
  return best;
}

/**
 * The artist prior as a closure vector (max entry 1): each outside source's tags
 * relative to its own top tag, averaged across sources, iTunes at ITUNES_WEIGHT
 * like the placement. Catalog tags are left out — the albums already count.
 */
function evidenceVector(raw: unknown, lang: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || typeof raw !== 'object') return out;
  let artist;
  try {
    artist = toArtistEvidence(raw as StoredGenreEvidence).artist;
  } catch {
    return out;
  }
  const sources: [{ tag: string; weight?: number }[] | undefined, number, boolean][] = [
    [artist.musicbrainz, 1, false],
    [artist.lastfm, 1, false],
    [artist.wikidata, 1, false],
    [artist.itunes, ITUNES_WEIGHT, true],
  ];
  const base = new Map<string, number>();
  let nSources = 0;
  for (const [tags, sw, isItunes] of sources) {
    if (!tags?.length) continue;
    const top = Math.max(...tags.map((t) => t.weight ?? 1));
    if (!(top > 0)) continue;
    let any = false;
    for (const t of tags) {
      const tag = isItunes ? itunesTag(t.tag) : t.tag;
      const id = tag ? resolveEvidenceTag(tag) : null;
      if (!id) continue;
      any = true;
      base.set(id, (base.get(id) ?? 0) + (sw * (t.weight ?? 1)) / top);
    }
    if (any) nSources++;
  }
  if (!nSources) return out;
  for (const [id, w] of base) closureOf(id, lang, w / nSources, out);
  const max = Math.max(0, ...out.values());
  if (max > 0) for (const [q, w] of out) out.set(q, w / max);
  return out;
}

function tagLabel(qid: string): string {
  return qualifiedInfo(qid)?.display.en ?? qid;
}

// ── graph ────────────────────────────────────────────────────────────────────

/** Column identity of an artist in the similarity graph: catalog id, else MBID, else folded name. */
function graphKey(s: { artistId: string | null; mbid: string | null; name: string }): string {
  return s.artistId ?? (s.mbid ? `mbid:${s.mbid}` : `name:${fold(s.name)}`);
}

/** Artist → similar-artist column → match, averaged over the sources that have data. */
function similarRow(artist: MapArtistInput): Map<string, number> {
  const out = new Map<string, number>();
  const sources = (artist.similar ?? []).filter((s) => s.items?.length);
  for (const s of sources) {
    for (const it of s.items) {
      const k = graphKey(it);
      if (k === artist.id) continue;
      const m = Math.max(0, Math.min(1, it.match ?? 0));
      out.set(k, (out.get(k) ?? 0) + m / sources.length);
    }
  }
  return out;
}

// ── build ────────────────────────────────────────────────────────────────────

interface Draft {
  artist: MapArtistInput;
  segment: EraSegment;
  single: boolean;
  albums: MapAlbumInput[];
  rated: MapAlbumInput[];
}

function eraLabelOf(seg: EraSegment): string {
  const { startYear: a, endYear: b } = seg;
  if (a == null && b == null) return 'undated';
  if (a === b || b == null) return String(a);
  if (a == null) return String(b);
  return `${a}–${b}`;
}

function albumWeight(a: MapAlbumInput): number {
  return a.rated ? 1 : UNRATED_ALBUM_WEIGHT;
}

/**
 * Build the user's feature space. Only segments with ≥ 1 rated album become
 * nodes; an unrated era is dropped, and its albums stay out of the other eras (the
 * segmentation is over the whole discography, so the rated eras stay pure).
 *
 * mass = number of rated albums (each weighs 1 — the taste system's per-album
 * score weighting isn't needed for map size), avgScore = mean user score.
 */
export function buildFeatureSpace(input: MapUserInput, overrides?: EraOverride[]): FeatureSpace {
  const overrideBy = new Map((overrides ?? []).map((o) => [o.artistId, o]));
  const drafts: Draft[] = [];
  for (const artist of input.artists) {
    const byId = new Map(artist.albums.map((a) => [a.id, a]));
    const segments = splitEras(artist, overrideBy.get(artist.id));
    for (const segment of segments) {
      const albums = segment.albumIds.map((id) => byId.get(id)!).filter(Boolean);
      const rated = albums.filter((a) => a.rated);
      if (!rated.length) continue;
      drafts.push({ artist, segment, single: segments.length === 1, albums, rated });
    }
  }
  const n = drafts.length;

  // ── tags: TF over (album pool + artist prior), IDF across the user's nodes ──
  const langCache = new Map<string, string | null>();
  const langOf = (a: MapAlbumInput, artist: MapArtistInput) => {
    if (!langCache.has(a.id)) langCache.set(a.id, albumLang(a, artist));
    return langCache.get(a.id)!;
  };
  const evidenceCache = new Map<string, Map<string, number>>();
  const tf: Map<string, number>[] = drafts.map(({ artist, albums }) => {
    const pool = new Map<string, number>();
    let wsum = 0;
    for (const a of albums) {
      const v = albumTagVector(a, langOf(a, artist));
      if (!v.size) continue;
      const w = albumWeight(a);
      wsum += w;
      for (const [q, x] of v) pool.set(q, (pool.get(q) ?? 0) + w * x);
    }
    if (wsum > 0) for (const [q, x] of pool) pool.set(q, x / wsum);
    if (!evidenceCache.has(artist.id)) {
      const lang = artistLang(artist.albums.map((a) => langOf(a, artist)));
      evidenceCache.set(artist.id, evidenceVector(artist.genreEvidence, lang));
    }
    for (const [q, x] of evidenceCache.get(artist.id)!) pool.set(q, (pool.get(q) ?? 0) + ARTIST_EVIDENCE_WEIGHT * x);
    return pool;
  });
  const df = new Map<string, number>();
  for (const m of tf) for (const [q, x] of m) if (x > 0) df.set(q, (df.get(q) ?? 0) + 1);
  // Most widely shared first, then id — a stable, readable order for tagDims.
  const tagIds = [...df.keys()].sort((a, b) => df.get(b)! - df.get(a)! || (a < b ? -1 : 1));
  const tagIndex = new Map(tagIds.map((q, i) => [q, i]));
  const tagDims: TagDim[] = tagIds.map((id) => ({ id, label: tagLabel(id) }));
  // Smoothed IDF (sklearn's): never zero, so a tag every node shares still counts a little.
  const idf = tagIds.map((q) => Math.log((1 + n) / (1 + df.get(q)!)) + 1);
  const tagBlocks = tf.map((m) => {
    const v = new Array(tagIds.length).fill(0);
    for (const [q, x] of m) v[tagIndex.get(q)!] = x * idf[tagIndex.get(q)!];
    return unit(v);
  });

  // ── text: pooled jina → centered PCA ──
  const embDim = (() => {
    for (const d of drafts) for (const a of d.albums) if (a.embedding?.length) return a.embedding.length;
    return 0;
  })();
  const pooled: (number[] | null)[] = drafts.map(({ albums }) => {
    if (!embDim) return null;
    const acc = new Array(embDim).fill(0);
    let wsum = 0;
    for (const a of albums) {
      if (a.embedding?.length !== embDim) continue;
      const nn = norm(a.embedding);
      if (!(nn > 0)) continue;
      const w = albumWeight(a);
      wsum += w;
      for (let j = 0; j < embDim; j++) acc[j] += (w * a.embedding[j]) / nn;
    }
    return wsum > 0 ? acc.map((x) => x / wsum) : null;
  });
  const textIdx = pooled.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const textK = Math.max(0, Math.min(TEXT_DIMS, textIdx.length - 1, embDim));
  const textBlocks: [number[], boolean][] = drafts.map(() => [new Array(textK).fill(0), false]);
  if (textK > 0) {
    const X = textIdx.map((i) => unit(pooled[i]!)[0]);
    const mean = new Array(embDim).fill(0);
    for (const r of X) for (let j = 0; j < embDim; j++) mean[j] += r[j] / X.length;
    const Xc = X.map((r) => r.map((x, j) => x - mean[j]));
    const scores = gramScores(gram(Xc), Xc.length, textK);
    textIdx.forEach((i, r) => (textBlocks[i] = unit(scores[r])));
  }

  // ── graph: node × similar-artist sparse rows → uncentered SVD ──
  const userArtists = new Set(input.artists.map((a) => a.id));
  const rowsByArtist = new Map(input.artists.map((a) => [a.id, similarRow(a)]));
  const listedByUser = new Set<string>();
  for (const [aid, row] of rowsByArtist) for (const k of row.keys()) if (userArtists.has(k) && k !== aid) listedByUser.add(k);
  const graphRows: Map<string, number>[] = drafts.map(({ artist }) => {
    const row = new Map(rowsByArtist.get(artist.id)!);
    if (row.size || listedByUser.has(artist.id)) row.set(artist.id, GRAPH_SELF_WEIGHT);
    const nn = Math.sqrt([...row.values()].reduce((s, x) => s + x * x, 0));
    if (nn > 0) for (const [k, x] of row) row.set(k, x / nn);
    return row;
  });
  const graphIdx = graphRows.map((r, i) => (r.size ? i : -1)).filter((i) => i >= 0);
  const graphK = Math.max(0, Math.min(GRAPH_DIMS, graphIdx.length - 1));
  const graphBlocks: [number[], boolean][] = drafts.map(() => [new Array(graphK).fill(0), false]);
  if (graphK > 0) {
    const m = graphIdx.length;
    const G = new Float64Array(m * m);
    for (let i = 0; i < m; i++)
      for (let j = i; j < m; j++) {
        const a = graphRows[graphIdx[i]];
        const b = graphRows[graphIdx[j]];
        let s = 0;
        const [small, big] = a.size <= b.size ? [a, b] : [b, a];
        for (const [k, x] of small) {
          const y = big.get(k);
          if (y) s += x * y;
        }
        G[i * m + j] = G[j * m + i] = s;
      }
    const scores = gramScores(G, m, graphK);
    graphIdx.forEach((i, r) => (graphBlocks[i] = unit(scores[r])));
  }

  // ── era: decade bumps (album-weighted) + scene ──
  const eraBlocks = drafts.map(({ artist, albums }) => {
    const bumps = new Array(ERA_CENTERS.length).fill(0);
    let wsum = 0;
    for (const a of albums) {
      if (a.year == null) continue;
      const w = albumWeight(a);
      wsum += w;
      ERA_CENTERS.forEach((c, j) => (bumps[j] += w * Math.exp(-((a.year! - c) ** 2) / (2 * ERA_SIGMA ** 2))));
    }
    const [yearPart, hasYear] = wsum > 0 ? unit(bumps) : [bumps, false];
    let scene = sceneOf(artist.country);
    if (!scene) {
      const l = artistLang(artist.albums.map((a) => langOf(a, artist)));
      scene = l === 'ko' ? 'kr' : l === 'ja' ? 'jp' : null;
    }
    const scenePart = SCENES.map((s) => (s === scene ? 1 : 0));
    const [v, ok] = unit([
      ...(hasYear ? yearPart : bumps.map(() => 0)).map((x) => x * ERA_YEAR_SHARE),
      ...scenePart.map((x) => x * ERA_SCENE_SHARE),
    ]);
    return [v, ok] as [number[], boolean];
  });

  const nodes: MapNode[] = drafts.map((d, i) => {
    const scores = d.rated.map((a) => a.score).filter((s): s is number => s != null && Number.isFinite(s));
    return {
      key: d.segment.key,
      artistId: d.artist.id,
      label: d.artist.name,
      eraLabel: d.single ? null : eraLabelOf(d.segment),
      albumIds: d.segment.albumIds,
      ratedAlbumIds: d.rated.map((a) => a.id),
      mass: d.rated.length,
      avgScore: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null,
      blocks: { tags: tagBlocks[i][0], text: textBlocks[i][0], graph: graphBlocks[i][0], era: eraBlocks[i][0] },
      has: { tags: tagBlocks[i][1], text: textBlocks[i][1], graph: graphBlocks[i][1], era: eraBlocks[i][1] },
    };
  });

  return {
    tagDims,
    dims: { tags: tagIds.length, text: textK, graph: graphK, era: ERA_CENTERS.length + SCENES.length },
    nodes,
  };
}

/** Dense Gram matrix of row vectors. */
function gram(X: number[][]): Float64Array {
  const n = X.length;
  const G = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      const s = dot(X[i], X[j]);
      G[i * n + j] = G[j * n + i] = s;
    }
  return G;
}

// ── similarity + explanation (D8) ────────────────────────────────────────────

/** Per-block weighted dot products and the normalizer Σ w_b over shared blocks. */
function blockTerms(a: MapNode, b: MapNode, w: MetricWeights): { terms: Record<BlockName, number>; z: number } {
  const terms = { tags: 0, text: 0, graph: 0, era: 0 } as Record<BlockName, number>;
  let z = 0;
  for (const block of BLOCKS) {
    const wb = Math.max(0, w.block[block] ?? 1);
    if (!a.has[block] || !b.has[block] || wb === 0) continue;
    z += wb;
    if (block === 'tags' && w.tagDims) {
      const x = a.blocks.tags;
      const y = b.blocks.tags;
      let s = 0;
      for (let k = 0; k < Math.min(x.length, y.length); k++) s += (w.tagDims[k] ?? 1) * x[k] * y[k];
      terms.tags = wb * s;
    } else {
      terms[block] = wb * dot(a.blocks[block], b.blocks[block]);
    }
  }
  return { terms, z };
}

/**
 * Weighted cosine between two nodes: Σ_b w_b·(a_b·b_b) / Σ w_b over the blocks
 * BOTH nodes have data for (a missing block is "unknown", not "different"). The
 * tags block uses per-dimension weights when the metric has them. 0 when the
 * nodes share no block.
 */
export function similarity(a: MapNode, b: MapNode, w: MetricWeights = DEFAULT_METRIC): number {
  const { terms, z } = blockTerms(a, b, w);
  if (z <= 0) return 0;
  return (terms.tags + terms.text + terms.graph + terms.era) / z;
}

/**
 * Why a and b are close: similarity() split into its exact terms — one per tag
 * dimension (w_tags·w_k·a_k·b_k, labelled by the genre) and one per other block
 * (labelled 'described alike' / 'listeners overlap' / 'same era & scene').
 *
 * A share is a term over the sum of the POSITIVE terms, so shares are 0–1 and sum
 * to ≤ 1 across what's returned. Negative terms (centered PCA blocks can disagree)
 * pull the pair apart; they lower similarity() but are not listed as reasons.
 */
export function explain(
  a: MapNode,
  b: MapNode,
  space: FeatureSpace,
  w: MetricWeights = DEFAULT_METRIC,
  top = 5,
): Contribution[] {
  const { terms, z } = blockTerms(a, b, w);
  if (z <= 0) return [];
  const parts: { label: string; value: number }[] = [];
  if (a.has.tags && b.has.tags && terms.tags !== 0) {
    const wb = Math.max(0, w.block.tags ?? 1);
    const x = a.blocks.tags;
    const y = b.blocks.tags;
    for (let k = 0; k < Math.min(x.length, y.length); k++) {
      const v = wb * (w.tagDims?.[k] ?? 1) * x[k] * y[k];
      if (v > 0) parts.push({ label: space.tagDims[k]?.label ?? `tag ${k}`, value: v });
    }
  }
  for (const block of ['text', 'graph', 'era'] as const) {
    if (terms[block] > 0) parts.push({ label: BLOCK_LABELS[block], value: terms[block] });
  }
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return [];
  return parts
    .sort((p, q) => q.value - p.value || (p.label < q.label ? -1 : 1))
    .slice(0, top)
    .map((p) => ({ label: p.label, share: p.value / total }));
}
