/**
 * Who may open the taste map (TASTE_MAP_PLAN.md §6.5: ship behind a flag).
 *
 * For now only the allowlisted test accounts see it, and they skip the rating
 * gate so small maps can be tried too. When the map opens to everyone, flip
 * TASTE_MAP_OPEN and every other user needs MIN_RATED_ALBUMS rated albums.
 * Shared by the API (server) and the Taste tab entry point (client).
 *
 * Keyed by profiles.id, not username: usernames can be changed in settings, and
 * the allowlist also fences catalog writes (ghost answers → release_genres
 * 'manual', questions route), so a freed or claimed name must not grant access.
 */

/** profiles.id of junnwest, zero and one (2026-11-05). */
export const TASTE_MAP_ALLOWLIST: readonly string[] = [
  '01c9330b-0c15-4d85-8eb3-3dd1c2e78dba', // junnwest
  'ec560c0b-bf0d-4064-b56b-35433e916d00', // zero
  '7f51b57f-d70c-4903-96fa-6b7e860db51b', // one
];
export const TASTE_MAP_OPEN = false;
/** Rated albums a non-allowlisted user needs once the map is open. */
export const MIN_RATED_ALBUMS = 50;
/** Below this the layout itself has too little to work with, allowlist or not. */
export const HARD_FLOOR_RATED_ALBUMS = 5;

export function isTasteMapAllowlisted(userId: string | null | undefined): boolean {
  return !!userId && TASTE_MAP_ALLOWLIST.includes(userId);
}

/** Whether to show the map at all (before counting ratings). Every taste-map route checks this. */
export function canSeeTasteMap(userId: string | null | undefined): boolean {
  return TASTE_MAP_OPEN || isTasteMapAllowlisted(userId);
}

/** Rated albums this user needs before the map builds. */
export function requiredRatedAlbums(userId: string | null | undefined): number {
  return isTasteMapAllowlisted(userId) ? HARD_FLOOR_RATED_ALBUMS : MIN_RATED_ALBUMS;
}
