/**
 * Era splitting for the taste map (TASTE_MAP_PLAN.md D1): one artist's catalog
 * albums → chronologically contiguous segments, each of which becomes a node when
 * the user rated something in it. Coldplay 2000–2008 and Coldplay 2011– are far
 * apart in sound; one averaged "Coldplay" dot would sit between two worlds and be
 * near neither.
 *
 * The detector is a deliberately simple, explainable change-point search, not a
 * model: over the release-ordered album vectors it takes the single binary split
 * that removes the most within-artist variance, and keeps it only when the cut is
 * BIG (variance reduction), FAR (the two halves' centroids point in different
 * directions) and SUPPORTED (≥ 2 albums each side). It recurses once into the
 * better half, so an artist has at most 3 eras. A user override replaces the
 * detector outright — it's only the first draft.
 *
 * Also home to the per-album tag/language helpers features.ts shares, so the era
 * detector and the tags block see an album's genres the same way (and features.ts
 * can import from here without a cycle).
 *
 * Pure: no DB, deterministic for a given input.
 */
import { NODE_BY_ID } from '../genres/taxonomy';
import { resolveGenre } from '../genres/resolver';
import { albumLanguage, qualify, scriptLanguage } from '../genres/language';
import type { EraOverride, EraSegment, MapAlbumInput, MapArtistInput } from './types';

// ── thresholds ───────────────────────────────────────────────────────────────

/**
 * Minimum share of the artist's within-catalog variance (sum of squared distances
 * to the centroid) a split must remove. Random noise over n albums gives a best
 * split of roughly 1/(n−1) plus a selection bonus — ~0.15–0.25 for 6–10 albums,
 * but 0.34 at n = 4 where only the 2|2 split exists (measured on 1024-d
 * common-direction + noise vectors) — so 0.35 sits above noise while a real sound change (britpop → dance-pop retags
 * AND a different description embedding) removes 0.5+. Chosen on the synthetic
 * Coldplay / consistent-artist cases in eras.test.ts.
 *
 * Real data (2026-11-03: user zero + map-input-sample.json, 44 artists with ≥ 4
 * dated albums): nothing passes both gates. The largest reductions are all short
 * catalogs at the noise floor — Beenzino 0.36 (n = 5, distance 0.19), dress /
 * E SENS 0.35 and 데이먼스 이어 0.34 (n = 4; a permutation test puts them at
 * p ≈ 0.3–0.65, i.e. noise). Coldplay is NOT detectable on today's data: over its
 * 24 counted albums the best cut is 2019|2020 at 0.08 / 0.16, and 2009|2011 only
 * 0.06 / 0.08. Even restricted to its 10 studio albums, tags only, 2008|2011
 * reaches just 0.15 and is not the best cut (p ≈ 0.2–0.4): the MusicBrainz tags
 * barely change (Mylo Xyloto is still "alternative rock, rock, pop rock …", Moon
 * Music is just "rock") and the embedding is a "title by artist. tags (year)"
 * passage, so it adds title noise, not sound. Lowering the gates to 0.08 / 0.16
 * to catch Coldplay would also split 21 other artists, and would still cut
 * Coldplay at 2019|2020, not 2008|2011 — use an override, or fix the tags.
 */
export const MIN_VARIANCE_REDUCTION = 0.35;

/**
 * Minimum cosine distance (1 − cos) between the two segment centroids. Variance
 * reduction alone accepts a tight artist split along a tiny axis (all their
 * albums are near-identical, so ANY split "explains" a large share of almost
 * nothing). Album embeddings of one artist sit at cos ≈ 0.8–0.9 to each other, so
 * the halves of a consistent artist stay within ~0.02–0.15 (higher only for very
 * noisy, short catalogs); 0.2 asks for a visible change in tags and/or description. Same tuning basis as above.
 *
 * Real data (same 44 artists): best-cut distances span 0.04–0.35 and do not
 * separate anything on their own — consistent catalogs reach 0.25–0.31 (Fred
 * again.. 0.31, Fitz and the Tantrums 0.29) while Coldplay's best is 0.16. This
 * gate stays as the guard against tight-artist splits; the reduction gate above
 * is the one that decides on real catalogs.
 */
export const MIN_CENTROID_DISTANCE = 0.2;

/** Each era needs at least this many albums — one odd record is not an era. */
export const MIN_ERA_ALBUMS = 2;

/** At most one recursion after the first split → at most this many eras. */
export const MAX_ERAS = 3;

/** Weight of an ancestor per hop up the taxonomy (shoegaze 1 → rock 0.5). */
export const ANCESTOR_DECAY = 0.5;

// ── album helpers (shared with features.ts) ──────────────────────────────────

/** The language the artist sings in by their native-script name, ko/ja only
 *  (the same rule albumLanguage's `artistNativeLanguage` input expects). */
function artistNativeLanguage(artist: MapArtistInput): string | null {
  const l = scriptLanguage(artist.nameNative ?? artist.name ?? '', artist.country);
  return l === 'ko' || l === 'ja' ? l : null;
}

/** An album's language by the shared evidence ladder (lib/genres/language.ts). */
export function albumLang(album: MapAlbumInput, artist: MapArtistInput): string | null {
  return albumLanguage({
    genres: album.genres,
    title: album.title,
    artistCountry: artist.country,
    artistNativeLanguage: artistNativeLanguage(artist),
    titleLanguage: album.titleLanguage,
  }).lang;
}

/**
 * A taxonomy id plus its sound ancestors, language-qualified, with weight
 * ANCESTOR_DECAY^hops (max over paths on the DAG). Scene roots are skipped: scene
 * is carried by the qualification (rock by a Japanese act is J-Rock) and the era
 * block, not by a "Japanese" dimension that every J-act would share.
 */
export function closureOf(id: string, lang: string | null, scale = 1, into = new Map<string, number>()): Map<string, number> {
  const put = (q: string, w: number) => {
    if (w > (into.get(q) ?? 0)) into.set(q, w);
  };
  let frontier = [id];
  let w = scale;
  const seen = new Set<string>();
  while (frontier.length && w > 1e-6) {
    const next: string[] = [];
    for (const cur of frontier) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      const node = NODE_BY_ID.get(cur);
      if (!node || node.isScene) continue;
      put(qualify(cur, lang), w);
      next.push(...node.soundParents);
    }
    frontier = next;
    w *= ANCESTOR_DECAY;
  }
  return into;
}

/** An album's tags as a qualified-taxonomy closure vector (max entry 1), or an
 *  empty map when no tag resolves. */
export function albumTagVector(album: MapAlbumInput, lang: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of album.genres ?? []) {
    const id = resolveGenre(raw);
    if (id) closureOf(id, lang, 1, out);
  }
  return out;
}

/** Release-group types that are an artist's own studio work. */
const OWN_WORK = new Set(['album', 'ep']);

/**
 * Whether an album takes part in the map at all. Rated albums always do. An
 * unrated compilation / live / soundtrack doesn't: catalogs are swamped by them
 * (Pink Floyd: 120 of 155 non-single release groups are compilations), and a
 * best-of re-states old eras, which would blur both the era detector and the
 * pooled tags/text. A missing type (older fixtures) counts as an album.
 */
export function countsForMap(album: MapAlbumInput): boolean {
  return album.rated || album.type == null || OWN_WORK.has(album.type);
}

/** Albums in release order: by year (undated last), then title, then id, so the
 *  order — and therefore the era keys — is stable across loads. */
export function chronological(albums: readonly MapAlbumInput[]): MapAlbumInput[] {
  return [...albums].sort((a, b) => {
    if (a.year !== b.year) {
      if (a.year == null) return 1;
      if (b.year == null) return -1;
      return a.year - b.year;
    }
    return a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

// ── vectors for the detector ─────────────────────────────────────────────────

function l2(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  if (s <= 0) return v.map(() => 0);
  const n = Math.sqrt(s);
  return v.map((x) => x / n);
}

/**
 * Per-album detector vectors: [normalized tag closure | normalized embedding],
 * each block scaled by 1/√blocks so an album vector has unit length. An album
 * missing a block gets the mean of the albums that have it — it then adds no
 * variance on that block instead of looking like a sudden change to "nothing".
 * A block no album has is dropped.
 */
function detectorVectors(albums: MapAlbumInput[], artist: MapArtistInput): number[][] {
  const tagMaps = albums.map((a) => albumTagVector(a, albumLang(a, artist)));
  const vocab = [...new Set(tagMaps.flatMap((m) => [...m.keys()]))].sort();
  const tagRows: (number[] | null)[] = tagMaps.map((m) =>
    m.size ? l2(vocab.map((q) => m.get(q) ?? 0)) : null,
  );
  const dim = albums.find((a) => a.embedding?.length)?.embedding?.length ?? 0;
  const embRows: (number[] | null)[] = albums.map((a) =>
    dim && a.embedding?.length === dim ? l2(a.embedding) : null,
  );
  const blocks = [tagRows, embRows].filter((rows) => rows.some((r) => r));
  if (!blocks.length) return albums.map(() => []);
  const scale = 1 / Math.sqrt(blocks.length);
  const filled = blocks.map((rows) => {
    const present = rows.filter((r): r is number[] => !!r);
    const mean = present[0].map((_, j) => present.reduce((s, r) => s + r[j], 0) / present.length);
    return rows.map((r) => (r ?? mean).map((x) => x * scale));
  });
  return albums.map((_, i) => filled.flatMap((rows) => rows[i]));
}

function centroid(rows: number[][]): number[] {
  const c = new Array(rows[0]?.length ?? 0).fill(0);
  for (const r of rows) for (let j = 0; j < r.length; j++) c[j] += r[j] / rows.length;
  return c;
}

function sse(rows: number[][]): number {
  if (!rows.length) return 0;
  const c = centroid(rows);
  let s = 0;
  for (const r of rows) for (let j = 0; j < r.length; j++) s += (r[j] - c[j]) ** 2;
  return s;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let j = 0; j < a.length; j++) {
    dot += a[j] * b[j];
    na += a[j] * a[j];
    nb += b[j] * b[j];
  }
  if (na <= 0 || nb <= 0) return 0;
  return 1 - dot / Math.sqrt(na * nb);
}

export interface SplitCandidate {
  /** Index of the first album of the second segment. */
  at: number;
  /** Share of the segment's SSE the split removes, 0–1. */
  reduction: number;
  /** 1 − cos between the two halves' centroids. */
  distance: number;
}

/**
 * The best single split of rows[lo, hi) by SSE, accepted or null. With `years`
 * (index-aligned with rows), a cut may only fall BETWEEN two release years: albums
 * from the same year are one moment, and ordering within a year is arbitrary
 * (NewJeans' 2023 releases otherwise split on which one happened to carry ten
 * tags).
 */
export function bestSplit(
  rows: number[][],
  lo = 0,
  hi = rows.length,
  years?: readonly (number | null)[],
): SplitCandidate | null {
  const seg = rows.slice(lo, hi);
  if (seg.length < 2 * MIN_ERA_ALBUMS) return null;
  const total = sse(seg);
  if (total <= 1e-12) return null;
  let best: SplitCandidate | null = null;
  let bestSse = Infinity;
  for (let k = MIN_ERA_ALBUMS; k <= seg.length - MIN_ERA_ALBUMS; k++) {
    if (years && years[lo + k - 1] === years[lo + k]) continue;
    const left = seg.slice(0, k);
    const right = seg.slice(k);
    const s = sse(left) + sse(right);
    if (s < bestSse - 1e-12) {
      bestSse = s;
      best = { at: lo + k, reduction: 1 - s / total, distance: cosineDistance(centroid(left), centroid(right)) };
    }
  }
  if (!best || best.reduction < MIN_VARIANCE_REDUCTION || best.distance < MIN_CENTROID_DISTANCE) return null;
  return best;
}

// ── segments ─────────────────────────────────────────────────────────────────

function segmentOf(artistId: string, albums: MapAlbumInput[], single: boolean): EraSegment {
  const years = albums.map((a) => a.year).filter((y): y is number => y != null);
  return {
    key: single ? `a:${artistId}` : `e:${artistId}:${albums[0].id}`,
    artistId,
    albumIds: albums.map((a) => a.id),
    startYear: years.length ? Math.min(...years) : null,
    endYear: years.length ? Math.max(...years) : null,
  };
}

function toSegments(artistId: string, groups: MapAlbumInput[][]): EraSegment[] {
  const nonEmpty = groups.filter((g) => g.length);
  return nonEmpty.map((g) => segmentOf(artistId, g, nonEmpty.length === 1));
}

/**
 * Split an artist's catalog albums into eras.
 *
 * Unrated compilations/live/soundtracks are left out of every segment (see
 * countsForMap), so they are in no node's albumIds.
 *
 * Override: split exactly before each listed album id (in release order); ids not
 * in the catalog, or naming the first album, are ignored. An override with no ids
 * merges the artist into one node — that's how "merge eras" is stored.
 *
 * Auto: the change-point search above, over DATED albums only. Undated albums
 * can't sit anywhere in a timeline, so each joins the era whose centroid it is
 * closest to (appended after that era's dated albums).
 */
export function splitEras(artist: MapArtistInput, override?: EraOverride): EraSegment[] {
  const sorted = chronological(artist.albums.filter(countsForMap));
  if (!sorted.length) return [];

  if (override && override.artistId === artist.id) {
    const cuts = new Set(override.splitAlbumIds);
    const groups: MapAlbumInput[][] = [[]];
    sorted.forEach((a, i) => {
      if (i > 0 && cuts.has(a.id)) groups.push([]);
      groups[groups.length - 1].push(a);
    });
    return toSegments(artist.id, groups);
  }

  const dated = sorted.filter((a) => a.year != null);
  const undated = sorted.filter((a) => a.year == null);
  const rows = detectorVectors(sorted, artist);
  const datedRows = rows.slice(0, dated.length);

  const cuts: number[] = [];
  const years = dated.map((a) => a.year);
  const first = bestSplit(datedRows, 0, datedRows.length, years);
  if (first) {
    cuts.push(first.at);
    // Recurse once: the better of the two halves' own best splits, if any passes.
    const left = bestSplit(datedRows, 0, first.at, years);
    const right = bestSplit(datedRows, first.at, datedRows.length, years);
    const second = [left, right]
      .filter((c): c is SplitCandidate => !!c)
      .sort((a, b) => b.reduction - a.reduction)[0];
    if (second && MAX_ERAS > 2) cuts.push(second.at);
    cuts.sort((a, b) => a - b);
  }

  const bounds = [0, ...cuts, dated.length];
  const groups = bounds.slice(0, -1).map((lo, i) => dated.slice(lo, bounds[i + 1]));
  if (!groups.length || !groups[0].length) {
    // Nothing dated: one era of everything.
    return toSegments(artist.id, [undated]);
  }
  if (undated.length) {
    if (groups.length === 1) groups[0].push(...undated);
    else {
      const centroids = bounds.slice(0, -1).map((lo, i) => centroid(datedRows.slice(lo, bounds[i + 1])));
      undated.forEach((a, u) => {
        const r = rows[dated.length + u];
        let bestG = groups.length - 1;
        let bestD = Infinity;
        centroids.forEach((c, g) => {
          const d = cosineDistance(r, c);
          if (d < bestD - 1e-12) {
            bestD = d;
            bestG = g;
          }
        });
        groups[bestG].push(a);
      });
    }
  }
  return toSegments(artist.id, groups);
}
