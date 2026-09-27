/**
 * Homepage recommendation categories — a PROJECTION of the canonical taxonomy,
 * never a hand-maintained list. A category IS a surface node (taxonomy.ts
 * `surface: true`); its members are that node + all its descendants, decided by
 * the SAME graph walk everything else uses (resolver.ts `ancestorsOf`, inverted).
 *
 * This retires lib/genre-categories.ts — the old ~30-entry list of hand-written
 * `genreFilters` substrings (a 4th place genres were maintained). Add or reshape
 * a category by toggling `surface`/editing a node in taxonomy.ts; nothing here is
 * edited by hand. (GENRE_TAXONOMY.md §4 Phase 2 task 2 — "categories → surface
 * nodes + descendants".)
 *
 * Membership is id-based, so it matches the chart-primary path's SQL closure
 * (_taxonomy_closure) by construction: "album is under category X" means the same
 * thing on both sides — X is an ancestor-or-self of a tag the album resolves to.
 */
import { TAXONOMY } from './taxonomy';
import { ancestorsOf, resolveGenre } from './resolver';

export type CategoryOrigin =
  | 'korean'
  | 'japanese'
  | 'chinese'
  | 'indian'
  | 'brazilian'
  | 'western'
  | 'global';

export interface GenreCategory {
  /** Taxonomy node id — doubles as the URL slug and cache key. */
  id: string;
  /** Display title (English) and its Korean twin, straight from the node. */
  name: string;
  nameKo: string;
  /** Scene origin, derived from the node's scene ancestors — drives the
   *  resolver's diversity cap so one origin can't dominate the grid. */
  origin: CategoryOrigin;
}

// Scene roots (isScene families) in priority order; a node's origin is the first
// of these that is an ancestor-or-self of it, else 'global' (pure sound node).
const SCENE_ORIGINS: [string, CategoryOrigin][] = [
  ['korean', 'korean'],
  ['japanese', 'japanese'],
  ['chinese', 'chinese'],
  ['indian', 'indian'],
  ['brazilian', 'brazilian'],
  ['western', 'western'],
];

function originOf(id: string): CategoryOrigin {
  const anc = ancestorsOf(id);
  for (const [scene, origin] of SCENE_ORIGINS) {
    if (id === scene || anc.has(scene)) return origin;
  }
  return 'global';
}

/** Every surface node, projected to a category. Order follows taxonomy.ts. */
export const CATEGORIES: GenreCategory[] = TAXONOMY.filter((n) => n.surface).map((n) => ({
  id: n.id,
  name: n.display.en,
  nameKo: n.display.ko,
  origin: originOf(n.id),
}));

export const CATEGORY_BY_ID: ReadonlyMap<string, GenreCategory> = new Map(
  CATEGORIES.map((c) => [c.id, c]),
);

/**
 * Does an album (by its raw genres[]) belong under category `categoryId`?
 * True iff some tag resolves to the category node itself or one of its
 * descendants — i.e. `categoryId` is an ancestor-or-self of a resolved tag.
 * This is the inverse of the SQL `_taxonomy_closure` lookup.
 */
export function albumMatchesCategory(
  genres: readonly string[] | null | undefined,
  categoryId: string,
): boolean {
  if (!genres?.length) return false;
  for (const tag of genres) {
    const id = resolveGenre(tag);
    if (!id) continue;
    if (id === categoryId || ancestorsOf(id).has(categoryId)) return true;
  }
  return false;
}
