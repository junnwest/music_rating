/**
 * Server-side access to the genre embedding artifact built by
 * scripts/build-genre-embeddings.ts (catalog tag co-occurrence → PPMI → truncated
 * eigendecomposition; see that script for method and data-source rationale).
 *
 * The JSON is bundled with the app and used entirely in-memory — genre similarity
 * math never touches Postgres (deliberate: the Supabase instance is a Micro).
 * Server-only: ~600 KB — do not import from client components.
 */
import raw from './genre-embeddings.json';
import { primaryTagOf, tagWeight } from './primaryGenre';

interface GenreEmbeddingData {
  version: number;
  builtAt: string;
  albums: number;
  dims: number;
  minSupport: number;
  support: Record<string, number>;
  vectors: Record<string, number[]>;
}

const data = raw as unknown as GenreEmbeddingData;

export const EMBEDDING_DIMS: number = data.dims;

export function genreVector(tag: string): number[] | null {
  return data.vectors[tag] ?? null;
}

export function genreSupport(tag: string): number {
  return data.support[tag] ?? 0;
}

/** Every genre tag the embedding artifact knows a vector for — the catalog's
 *  tag vocabulary. Used to discover spelling variants of a genre (see
 *  genreSynonyms.ts). Server-only; do not ship to the client. */
export function genreVocab(): string[] {
  return Object.keys(data.vectors);
}

/** Cosine similarity of two unit vectors (embeddings are stored L2-normalized). */
export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Unit-normalized weighted mean of the given tags' vectors (tags without a
 * vector are skipped). Returns null when no tag is known.
 */
export function centroid(tags: { tag: string; weight: number }[]): number[] | null {
  const acc = new Array<number>(EMBEDDING_DIMS).fill(0);
  let hit = false;
  for (const { tag, weight } of tags) {
    const v = genreVector(tag);
    if (!v || weight <= 0) continue;
    hit = true;
    // Shrink rare tags' pull: a tag seen on 4 albums has a noisy vector (it gloms
    // onto whatever big genre it co-occurred with), so it shouldn't steer a
    // centroid as hard as a tag seen on 40k albums.
    const shrink = genreSupport(tag) / (genreSupport(tag) + 10);
    for (let i = 0; i < acc.length; i++) acc[i] += v[i] * weight * shrink;
  }
  if (!hit) return null;
  const norm = Math.sqrt(acc.reduce((s, x) => s + x * x, 0)) || 1;
  return acc.map((x) => x / norm);
}

/**
 * Centroid of an album's genre tags, weighted by importance: the album's
 * primary genre (scene-first precedence — see primaryGenre.ts) counts 1.0,
 * co-tags 0.5, so a [k-pop, hip hop, pop] album sits nearer k-pop than a
 * plain mean of the three would.
 */
export function albumCentroid(genres: string[] | null | undefined): number[] | null {
  if (!genres?.length) return null;
  const primary = primaryTagOf(genres);
  return centroid(genres.map((tag) => ({ tag, weight: tagWeight(tag, primary) })));
}

/**
 * Human display form of an MB/Last.fm genre tag ("dream pop" → "Dream Pop",
 * "k-pop" → "K-Pop", "r&b" → "R&B").
 */
export function displayGenre(tag: string): string {
  const SPECIAL: Record<string, string> = {
    'r&b': 'R&B',
    'contemporary r&b': 'Contemporary R&B',
    'korean r&b': 'Korean R&B',
    'k-pop': 'K-Pop',
    'j-pop': 'J-Pop',
    'j-rock': 'J-Rock',
    edm: 'EDM',
    idm: 'IDM',
    'uk garage': 'UK Garage',
    'uk drill': 'UK Drill',
    'lo-fi': 'Lo-Fi',
  };
  if (SPECIAL[tag]) return SPECIAL[tag];
  return tag
    .split(' ')
    .map((w) => (w.includes('-') ? w.split('-').map(cap).join('-') : cap(w)))
    .join(' ');
}

function cap(w: string): string {
  return w.length === 0 ? w : w[0].toUpperCase() + w.slice(1);
}
