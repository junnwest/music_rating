/**
 * Who may open the taste map (TASTE_MAP_PLAN.md §6.5: ship behind a flag).
 *
 * For now only the allowlisted test accounts see it, and they skip the rating
 * gate so small maps can be tried too. When the map opens to everyone, flip
 * TASTE_MAP_OPEN and every other user needs MIN_RATED_ALBUMS rated albums.
 * Shared by the API (server) and the Taste tab entry point (client).
 */

export const TASTE_MAP_ALLOWLIST: readonly string[] = ['junnwest', 'zero', 'one'];
export const TASTE_MAP_OPEN = false;
/** Rated albums a non-allowlisted user needs once the map is open. */
export const MIN_RATED_ALBUMS = 50;
/** Below this the layout itself has too little to work with, allowlist or not. */
export const HARD_FLOOR_RATED_ALBUMS = 5;

export function isTasteMapAllowlisted(username: string | null | undefined): boolean {
  return !!username && TASTE_MAP_ALLOWLIST.includes(username.toLowerCase());
}

/** Whether to show the map at all (before counting ratings). */
export function canSeeTasteMap(username: string | null | undefined): boolean {
  return TASTE_MAP_OPEN || isTasteMapAllowlisted(username);
}

/** Rated albums this user needs before the map builds. */
export function requiredRatedAlbums(username: string | null | undefined): number {
  return isTasteMapAllowlisted(username) ? HARD_FLOOR_RATED_ALBUMS : MIN_RATED_ALBUMS;
}
