/**
 * Writing a ghost answer into the catalog (README TODO "missing genre data",
 * item 2): the answered genre becomes a `release_genres` row with source
 * `manual` on the node's albums, through the shared per-source writer
 * (lib/genres/sourceWriter.ts), which also re-derives each album's displayed
 * `release_groups.genres`. Only for allowlisted users (the route checks);
 * never for anyone else.
 *
 * `manual` is the top-trust source in the merge (lib/genres/merge.ts, trust 1.0
 * vs MusicBrainz 0.9), and it is per-source replace: writing an album's manual
 * set replaces whatever manual rows it had. So the write is fenced to albums
 * where a person's one-word answer can only fill a gap:
 *
 *   - no MusicBrainz / Last.fm / legacy rows (real tags win; an answer about
 *     the artist mustn't outrank an album's own MB tags),
 *   - no manual rows other than this user's earlier answer for the same node
 *     (scripts/apply-genre-overrides.ts owns the curated ones),
 *   - and, with no release_genres rows at all, an empty displayed genres[]
 *     (display.ts derives genres[] from rows, so a first row on an album whose
 *     tags predate release_genres would drop those tags from its display).
 *
 * In practice that's the untagged and store-genre-only (iTunes / Deezer)
 * albums: exactly the ones that made the node thin.
 *
 * Server-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeSourceGenres } from '../genres/sourceWriter';
import { chunk, IN_CHUNK } from './store';
import type { MapAlbumInput } from './types';

/** Sources whose rows mean the album already has real tags. */
const REAL_TAG_SOURCES = new Set(['musicbrainz', 'lastfm', 'legacy']);

/** Albums a manual answer may be written to (pure; see the header). */
export function catalogTargets(
  albums: readonly Pick<MapAlbumInput, 'id' | 'genres'>[],
  sourcesByRg: ReadonlyMap<string, ReadonlySet<string>>,
  ownRgIds: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const a of albums) {
    const src = sourcesByRg.get(a.id);
    if (!src || src.size === 0) {
      if (!(a.genres ?? []).some((g) => g && g.trim())) out.push(a.id);
      continue;
    }
    if ([...src].some((s) => REAL_TAG_SOURCES.has(s))) continue;
    if (src.has('manual') && !ownRgIds.has(a.id)) continue;
    out.push(a.id);
  }
  return out;
}

/** Distinct release_genres sources per release group. Throws on a read error. */
export async function readGenreSources(db: SupabaseClient, rgIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const part of chunk(rgIds, IN_CHUNK)) {
    const { data, error } = await db.from('release_genres').select('release_group_id, source').in('release_group_id', part);
    if (error) throw new Error(`release_genres read: ${error.message}`);
    for (const r of (data ?? []) as { release_group_id: string; source: string }[]) {
      const s = out.get(r.release_group_id) ?? new Set<string>();
      s.add(r.source);
      out.set(r.release_group_id, s);
    }
  }
  return out;
}

/** Write `genreId` as source `manual` on `rgIds` (titles for the unmapped-tag stage). */
export async function writeManualGenre(
  db: SupabaseClient,
  albums: readonly Pick<MapAlbumInput, 'id' | 'title'>[],
  genreId: string,
): Promise<number> {
  if (!albums.length) return 0;
  const res = await writeSourceGenres(
    db,
    'manual',
    albums.map((a) => ({ releaseGroupId: a.id, title: a.title, tags: [{ tag: genreId, confidence: null }] })),
  );
  return res.releaseGroups;
}
