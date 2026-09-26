/**
 * Which tag in an album's genres[] is its PRIMARY genre — the primary tag
 * carries full weight in taste weighting, co-tags carry half (see profile.ts).
 *
 * REPOINTED (Phase 2, 2026-09-21): the scene-first precedence is no longer a
 * hand-maintained ordered list here. It is DERIVED from the canonical taxonomy
 * walk in lib/genres/resolver.ts — `primaryOf(tags)` picks the most-specific
 * resolvable tag (level: subgenre > genre > family, then `rank`, then tag
 * order), which encodes the same "scene-qualified > niche > specific > broad"
 * ordering the old PRECEDENCE table did (a [hip hop, k-pop, pop] album → k-pop;
 * a [indie rock, rock, shoegaze] album → shoegaze). The triplicated PRECEDENCE
 * list is deleted from this file (GENRE_TAXONOMY.md §3.2 / §4 Phase 2).
 *
 * This file's only remaining job is to map that canonical winner BACK to the
 * album's raw array element, because taste weighting keys `genre_weights` on the
 * raw tag strings — iOS reads those keys, so the KEY SHAPE must not change. We
 * return the raw element, never the canonical id.
 *
 * Why not array position: MB's API returns genres ALPHABETICALLY and the ingest
 * discards per-genre vote counts (e.g. every My Bloody Valentine album reads
 * ["indie rock","rock","shoegaze"]), so position carries no importance signal —
 * the taxonomy walk does.
 */
import { primaryOf, resolveGenre } from '../genres/resolver';

/**
 * The array element that is the album's primary genre: the first tag (in array
 * order) that resolves to the taxonomy's most-specific node for this album.
 * Falls back to the first tag when nothing resolves — an album whose tags are
 * all off-taxonomy still has a main tag (unchanged from the old behavior).
 */
export function primaryTagOf(genres: string[] | null | undefined): string | null {
  if (!genres || genres.length === 0) return null;
  const primaryId = primaryOf(genres);
  if (!primaryId) return genres[0];
  // Map the canonical winner back to the first raw element that resolves to it,
  // so the returned value is a real key present in the album's genres[].
  for (const g of genres) if (resolveGenre(g) === primaryId) return g;
  return genres[0];
}

/** Weight of one tag within its album: primary 1.0, co-tag 0.5. */
export function tagWeight(tag: string, primary: string | null): number {
  return primary != null && tag === primary ? 1.0 : 0.5;
}
