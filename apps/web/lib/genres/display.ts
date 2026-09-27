/**
 * The genre DISPLAY projection (GENRE_TAXONOMY.md §4 Phase 3 cutover): derive an album's
 * displayed `release_groups.genres` text[] from its per-source `release_genres` rows.
 *
 *   rows (all sources) → mergeGenres (trust × confidence × agreement, scene roots
 *   excluded) → canonical ids → display spellings → + unresolvable tail → genres[]
 *
 * Format choice: the sink stays `release_groups.genres` (every consumer already reads
 * it) and the values stay RAW-TAG SPELLINGS, not canonical ids — each id is written
 * with the spelling the album already used, else the catalog's dominant spelling
 * (genreSynonyms.canonicalize). So the key shape of everything derived from genres[]
 * (iOS genre_weights keys, the v1 embedding artifact, SQL `_genre_resolve`) is
 * unchanged; only WHICH genres an album shows, and their order, change.
 *
 * Information-preserving rules:
 *   - no `release_genres` rows → no derivation (caller leaves genres[] untouched);
 *   - tags in the current array that resolve to NO taxonomy node (the long tail, staged
 *     in genre_unmapped) are kept AT THEIR ORIGINAL POSITION — never dropped, and MB's
 *     vote order survives (a legacy-only album derives to exactly its current array);
 *   - an empty derivation never blanks an album.
 *
 * `syncDisplayGenres` applies it to the DB, and is where `legacy` rows are retired:
 * once an album has MusicBrainz rows, its provenance-less legacy rows (largely an old
 * snapshot of those same MB tags) are deleted so they stop double-counting as
 * "agreement". Reversible: `release_groups_genres_backup` holds the pre-cutover arrays.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeGenres, type GenreSource } from './merge';
import { resolveGenre, isSceneRoot, fold } from './resolver';
import { canonicalize } from '../taste/genreSynonyms';
import { pgRetry } from './pgRetry';

export interface GenreRow {
  genre_id: string;
  source: string;
  confidence: number | null;
}

/**
 * The displayed genres for one album, or null when there is nothing to derive from
 * (no rows, or an empty result) — callers then leave the album's genres[] as is.
 */
export function deriveDisplayGenres(
  current: readonly (string | null)[] | null | undefined,
  rows: readonly GenreRow[],
): string[] | null {
  if (!rows.length) return null;

  // What the album shows today: each id's spelling + position, and the unresolvable tail.
  const spelling = new Map<string, string>();
  const position = new Map<string, number>();
  const tail: { tag: string; index: number }[] = [];
  (current ?? []).forEach((raw, i) => {
    const t = raw?.trim();
    if (!t) return;
    const id = resolveGenre(t);
    if (!id) {
      if (!tail.some((x) => x.tag.toLowerCase() === t.toLowerCase())) tail.push({ tag: t, index: i });
    } else if (!spelling.has(id)) {
      spelling.set(id, t);
      position.set(id, i);
    } else if (fold(t) === fold(id) && fold(spelling.get(id)!) !== fold(id)) {
      // Several spellings fold to one node ("psychedelic", "psychedelic rock"): keep the
      // first one's position but prefer the spelling that names the node itself.
      spelling.set(id, t);
    }
  });

  const merged = mergeGenres(
    rows.map((r) => ({ genreId: r.genre_id, source: r.source as GenreSource, confidence: r.confidence })),
    {
      displayable: (id) => !isSceneRoot(id),
      tieBreak: (a, b) => (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity),
    },
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of merged) {
    const t = spelling.get(m.genreId) ?? canonicalize(m.genreId);
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  // Re-insert the unresolvable tail at its original indices (ascending, so earlier
  // insertions don't shift later ones), clamped to the end.
  for (const { tag, index } of tail) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.splice(Math.min(index, out.length), 0, tag);
  }
  return out.length ? out : null;
}

const sameArray = (a: readonly (string | null)[] | null | undefined, b: readonly string[]) =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

export interface SyncDisplayResult {
  checked: number;
  updated: number;
  legacyRetired: number;
  samples: { id: string; before: (string | null)[] | null; after: string[] }[];
}

const CHUNK = 100;

/**
 * Re-derive and write genres[] for the given albums (retiring legacy rows where MB now
 * covers the album). `current` may pre-supply the albums' genres[] to skip a read.
 * Only albums whose array actually changes are written. Throws on non-timeout errors.
 */
export async function syncDisplayGenres(
  db: SupabaseClient,
  releaseGroupIds: readonly string[],
  opts: { dryRun?: boolean; current?: ReadonlyMap<string, (string | null)[] | null>; sampleLimit?: number } = {},
): Promise<SyncDisplayResult> {
  const res: SyncDisplayResult = { checked: 0, updated: 0, legacyRetired: 0, samples: [] };
  const ids = [...new Set(releaseGroupIds)];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);

    const rowData = await pgRetry('release_genres read', () =>
      db.from('release_genres').select('release_group_id, genre_id, source, confidence').in('release_group_id', chunk),
    );
    const rowsByRg = new Map<string, GenreRow[]>();
    for (const r of (rowData ?? []) as (GenreRow & { release_group_id: string })[]) {
      let list = rowsByRg.get(r.release_group_id);
      if (!list) rowsByRg.set(r.release_group_id, (list = []));
      list.push(r);
    }

    // Retire legacy rows on albums MusicBrainz now covers.
    const retire = chunk.filter((id) => {
      const rows = rowsByRg.get(id) ?? [];
      return rows.some((r) => r.source === 'musicbrainz') && rows.some((r) => r.source === 'legacy');
    });
    if (retire.length) {
      for (const id of retire) {
        const rows = rowsByRg.get(id)!;
        res.legacyRetired += rows.filter((r) => r.source === 'legacy').length;
        rowsByRg.set(id, rows.filter((r) => r.source !== 'legacy'));
      }
      if (!opts.dryRun) {
        await pgRetry('legacy retire', () =>
          db.from('release_genres').delete().eq('source', 'legacy').in('release_group_id', retire),
        );
      }
    }

    const withRows = chunk.filter((id) => rowsByRg.has(id));
    let current = opts.current;
    if (!current && withRows.length) {
      const data = await pgRetry('release_groups read', () =>
        db.from('release_groups').select('id, genres').in('id', withRows),
      );
      current = new Map(
        ((data ?? []) as { id: string; genres: (string | null)[] | null }[]).map((r) => [r.id, r.genres]),
      );
    }

    for (const id of withRows) {
      res.checked++;
      const before = current?.get(id) ?? null;
      const after = deriveDisplayGenres(before, rowsByRg.get(id)!);
      if (!after || sameArray(before, after)) continue;
      res.updated++;
      if (res.samples.length < (opts.sampleLimit ?? 0)) res.samples.push({ id, before, after });
      if (!opts.dryRun) {
        await pgRetry('genres update', () => db.from('release_groups').update({ genres: after }).eq('id', id));
      }
    }
  }
  return res;
}
