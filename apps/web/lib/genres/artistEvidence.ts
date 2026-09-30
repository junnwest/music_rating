/**
 * artists.genre_evidence — the stored outside sources of the ARTIST PRIOR used by
 * album placement (lib/genres/placement.ts; migration 20260930000003).
 *
 *   { musicbrainz: [["hip hop", 12], …], lastfm: [["korean hip hop", 100], …],
 *     wikidata: [["hip-hop"], …],
 *     itunes: { id: 123, genres: [["Hip-Hop/Rap", 8], …], albums: { <release_group id>: "Hip-Hop/Rap" } },
 *     lastfm_shared_name: true,   // Last.fm page merges several same-named artists → no tags kept
 *     fetched_at: { musicbrainz: iso, … } }
 *
 * iTunes: the matched iTunes artist's store genre per album — `genres` counts every
 * album, `albums` maps OUR release groups (matched by title) to theirs, so one
 * album's own genre can be told apart from the artist's other albums.
 *
 * Each source is written independently (mb-ingest writes musicbrainz on every
 * ingest / re-poll; scripts/backfill-artist-genres.ts writes all three), so a
 * write MERGES its source into the object instead of replacing it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArtistEvidence, EvidenceTag } from './placement';
import { pgRetry } from './pgRetry';

export type GenreSource = 'musicbrainz' | 'lastfm' | 'wikidata' | 'itunes';
/** [tag] or [tag, count]. */
export type StoredTag = [string] | [string, number];

export interface StoredItunes {
  /** Matched iTunes artistId, or null when no iTunes artist matched. */
  id: number | null;
  genres: StoredTag[];
  albums: Record<string, string>;
}

export interface StoredGenreEvidence {
  musicbrainz?: StoredTag[];
  lastfm?: StoredTag[];
  wikidata?: StoredTag[];
  itunes?: StoredItunes;
  lastfm_shared_name?: boolean;
  fetched_at?: Partial<Record<GenreSource, string>>;
}

/** What a source write carries (itunes has its own shape). */
export type GenreEvidencePatch = Partial<{
  musicbrainz: StoredTag[];
  lastfm: StoredTag[];
  wikidata: StoredTag[];
  itunes: StoredItunes;
  lastfm_shared_name: boolean;
}>;

/** Tags kept per source — the placement only reads the top of each list. */
export const MAX_TAGS_PER_SOURCE = 15;

export function toStoredTags(tags: readonly { tag: string; count?: number | null }[]): StoredTag[] {
  return tags
    .filter((t) => t.tag)
    .slice(0, MAX_TAGS_PER_SOURCE)
    .map((t) => (t.count != null && t.count !== 1 ? [t.tag, t.count] : [t.tag]));
}

/**
 * Stored evidence (+ the artist's catalog tags) → the placement's ArtistEvidence for
 * one album, and that album's own iTunes genre (kept out of the artist-level counts).
 */
export function toArtistEvidence(
  stored: StoredGenreEvidence | null | undefined,
  catalog?: EvidenceTag[],
  albumId?: string,
): { artist: ArtistEvidence; itunesGenre: string | null } {
  const conv = (xs?: StoredTag[]): EvidenceTag[] | undefined =>
    xs?.map(([tag, weight]) => ({ tag, weight: weight ?? 1 }));
  const it = stored?.itunes;
  const itunesGenre = (albumId && it?.albums?.[albumId]) || null;
  let itunes: EvidenceTag[] | undefined;
  if (it?.genres?.length) {
    itunes = it.genres
      .map(([tag, n]) => ({ tag, weight: (n ?? 1) - (tag === itunesGenre ? 1 : 0) }))
      .filter((t) => t.weight > 0);
  }
  return {
    artist: {
      catalog,
      musicbrainz: conv(stored?.musicbrainz),
      lastfm: stored?.lastfm_shared_name ? undefined : conv(stored?.lastfm),
      wikidata: conv(stored?.wikidata),
      itunes,
    },
    itunesGenre,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Merge one or more sources into an artist's genre_evidence. Read-modify-write
 * (one artist at a time — writers never race on the same artist in practice);
 * returns false when nothing changed (no write).
 */
export async function mergeArtistGenreEvidence(
  db: SupabaseClient,
  artistId: string,
  patch: GenreEvidencePatch,
): Promise<boolean> {
  const cur = await pgRetry('genre_evidence read', () =>
    db.from('artists').select('genre_evidence').eq('id', artistId).maybeSingle(),
  );
  const prev = ((cur as { genre_evidence: StoredGenreEvidence | null } | null)?.genre_evidence ?? {}) as StoredGenreEvidence;
  const next: StoredGenreEvidence = { ...prev, fetched_at: { ...(prev.fetched_at ?? {}) } };
  const now = new Date().toISOString();
  let changed = false;
  for (const [key, value] of Object.entries(patch) as [keyof GenreEvidencePatch, unknown][]) {
    if (!same(prev[key], value)) changed = true;
    (next as Record<string, unknown>)[key] = value;
    if (key !== 'lastfm_shared_name') next.fetched_at![key] = now;
  }
  // Even an unchanged fetch refreshes fetched_at, so the backfill's staleness check
  // doesn't re-fetch an artist it just confirmed.
  await pgRetry('genre_evidence write', () =>
    db.from('artists').update({ genre_evidence: next }).eq('id', artistId),
  );
  return changed;
}

/** mb-ingest's writer: best-effort (never fails the ingest); ARTIST_GENRES_WRITE=0 disables it. */
export async function writeMbArtistGenresBestEffort(
  db: SupabaseClient,
  artistId: string,
  votes: readonly { name: string; count: number }[],
  label: string,
): Promise<void> {
  if (process.env.ARTIST_GENRES_WRITE === '0') return;
  try {
    await mergeArtistGenreEvidence(db, artistId, {
      musicbrainz: toStoredTags(votes.map((v) => ({ tag: v.name, count: v.count }))),
    });
  } catch (e) {
    console.warn(`  [artist-genres] ${label}: ${(e as Error).message}`);
  }
}
