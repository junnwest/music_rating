/**
 * Pure logic for the era override routes (TASTE_MAP_PLAN.md D1, Phase 4):
 * what the era editor shows for one artist, and which manual splits are valid.
 *
 * Semantics follow eras.ts splitEras: an override splits the artist's COUNTED
 * albums (countsForMap), in chronological order, BEFORE each listed album id.
 * `[]` merges the artist into one node; no row = the automatic detector.
 */
import { LIMITS, type EraAlbum, type EraGetResponse } from './apiTypes';
import { chronological, countsForMap, splitEras } from './eras';
import type { MapArtistInput } from './types';
import { validateSplitIds } from './validate';
import { isPlainObject, type Parsed } from './validatePhase4';

/** Split-before album ids the automatic detector picks (each era's first album but the first). */
export function autoSplits(artist: MapArtistInput): string[] {
  return splitEras(artist)
    .slice(1)
    .map((s) => s.albumIds[0]);
}

export function eraView(artist: MapArtistInput, override: string[] | null): EraGetResponse {
  const albums: EraAlbum[] = chronological(artist.albums).map((a) => ({
    id: a.id,
    title: a.title,
    year: a.year,
    rated: a.rated,
    coverUrl: a.coverUrl,
    counts: countsForMap(a),
  }));
  return { artistId: artist.id, albums, override, auto: autoSplits(artist) };
}

/** EraPutBody → `null` (delete the override) or the raw id list (checked by validateSplits). */
export function parseEraPut(body: unknown): Parsed<string[] | null> {
  if (!isPlainObject(body) || !('splitAlbumIds' in body)) return { ok: false, error: 'body must be { splitAlbumIds: string[] | null }' };
  const v = body.splitAlbumIds;
  if (v === null) return { ok: true, value: null };
  return validateSplitIds(v);
}

/**
 * Check split ids against the artist's catalog: each must be a counted album of
 * this artist and not its first (a split before the first album is a no-op that
 * would also break the era key). Returns the ids deduped, in chronological order.
 */
export function validateSplits(artist: MapArtistInput, ids: string[]): Parsed<string[]> {
  const counted = chronological(artist.albums.filter(countsForMap));
  const pos = new Map(counted.map((a, i) => [a.id, i]));
  const all = new Set(artist.albums.map((a) => a.id));
  const uniq = [...new Set(ids)];
  if (uniq.length > LIMITS.splitsPerArtist) return { ok: false, error: `at most ${LIMITS.splitsPerArtist} splits` };
  for (const id of uniq) {
    if (!all.has(id)) return { ok: false, error: `album ${id} is not in this artist's catalog` };
    const i = pos.get(id);
    if (i === undefined) return { ok: false, error: `album ${id} doesn't count for the map (compilation, live or soundtrack you haven't rated)` };
    if (i === 0) return { ok: false, error: `album ${id} is the artist's first album; an era can't start before it` };
  }
  return { ok: true, value: uniq.sort((a, b) => pos.get(a)! - pos.get(b)!) };
}
