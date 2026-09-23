/**
 * The per-source genre WRITER (GENRE_TAXONOMY.md §3.4 / §4 Phase 3): the one path
 * every acquisition source uses to land its tags in `release_genres`.
 *
 *   raw source tag → resolveGenre → genre_id  → release_genres(rg, id, source, confidence)
 *   raw source tag → (no node)               → genre_unmapped(rg, title, raw tag, source)
 *
 * Semantics:
 *   - A source only ever touches ITS OWN rows (the key is rg+genre_id+source), so
 *     re-running one source never clobbers another's assertions.
 *   - Replace-per-source: after a write, a release group's `source` rows are exactly
 *     the source's current tag set — genres the source dropped are deleted.
 *   - Diff-first: existing rows are read and only changes are written, so a
 *     steady-state re-poll (e.g. the pipeline's freshness lane) costs one read per
 *     chunk and no writes — the Supabase Micro IO budget matters here.
 *   - `is_primary` is always false on per-source rows; the primary is a property of
 *     the MERGED set (lib/genres/merge.ts), computed at display cutover.
 *
 * The pure pieces (resolveSourceTags, diffSourceRows) are exported for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveGenre } from './resolver';
import type { GenreSource } from './merge';

/** Sources that write through this path (`legacy` is the one-off Phase-1 backfill). */
export type AcquisitionSource = Exclude<GenreSource, 'legacy'>;

export interface SourceTag {
  tag: string;
  /** The source's own signal (MB vote count / Last.fm weight); null when it has none. */
  confidence?: number | null;
}

export interface ResolvedGenre {
  genreId: string;
  confidence: number | null;
}

/**
 * Resolve a source's raw tags to canonical ids. Several spellings can fold to one
 * node — they collapse to a single id keeping the STRONGEST confidence. Order is
 * first-seen. Tags with no node are returned (deduped case-insensitively) for staging.
 */
export function resolveSourceTags(tags: readonly SourceTag[]): {
  genres: ResolvedGenre[];
  unmapped: string[];
} {
  const byId = new Map<string, ResolvedGenre>();
  const unmapped = new Map<string, string>();
  for (const { tag, confidence } of tags) {
    const raw = tag?.trim();
    if (!raw) continue;
    const id = resolveGenre(raw);
    if (!id) {
      const k = raw.toLowerCase();
      if (!unmapped.has(k)) unmapped.set(k, raw);
      continue;
    }
    const c = confidence ?? null;
    const prev = byId.get(id);
    if (!prev) byId.set(id, { genreId: id, confidence: c });
    else if (c != null && (prev.confidence == null || c > prev.confidence)) prev.confidence = c;
  }
  return { genres: [...byId.values()], unmapped: [...unmapped.values()] };
}

/**
 * Diff one release group's desired genre set against its existing rows for the
 * source: new/changed-confidence ids → upsert, ids no longer asserted → delete.
 */
export function diffSourceRows(
  existing: ReadonlyMap<string, number | null>,
  desired: readonly ResolvedGenre[],
): { upserts: ResolvedGenre[]; deletes: string[] } {
  const want = new Set(desired.map((d) => d.genreId));
  const upserts = desired.filter(
    (d) => !existing.has(d.genreId) || (existing.get(d.genreId) ?? null) !== d.confidence,
  );
  const deletes = [...existing.keys()].filter((id) => !want.has(id));
  return { upserts, deletes };
}

export interface SourceGenreInput {
  releaseGroupId: string;
  title: string | null;
  tags: readonly SourceTag[];
}

export interface WriteSourceResult {
  releaseGroups: number;
  upserted: number;
  deleted: number;
  unmappedStaged: number;
  /** Release groups whose rows were already current (no write needed). */
  unchanged: number;
}

const CHUNK = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTimeout = (msg: string) => /timeout|57014|canceling statement/i.test(msg);

/** Run a PostgREST call, retrying statement timeouts with backoff; throw on anything else. */
async function withRetry(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) await sleep(400 * attempt);
    const { error } = await fn();
    if (!error) return;
    if (!isTimeout(error.message) || attempt >= 3) throw new Error(`${label}: ${error.message}`);
  }
}

/**
 * Write a batch of release groups' tags for ONE source. Throws on a non-timeout DB
 * error (callers in the live pipeline catch and degrade — a genre write must never
 * fail an ingest). `stageUnmapped` filters which unresolved tags reach the review
 * queue (e.g. drop folksonomy noise); default stages all.
 */
export async function writeSourceGenres(
  db: SupabaseClient,
  source: AcquisitionSource,
  items: readonly SourceGenreInput[],
  opts: { dryRun?: boolean; stageUnmapped?: (rawTag: string) => boolean } = {},
): Promise<WriteSourceResult> {
  const res: WriteSourceResult = { releaseGroups: 0, upserted: 0, deleted: 0, unmappedStaged: 0, unchanged: 0 };

  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const ids = chunk.map((c) => c.releaseGroupId);

    const { data, error } = await db
      .from('release_genres')
      .select('release_group_id, genre_id, confidence')
      .eq('source', source)
      .in('release_group_id', ids);
    if (error) throw new Error(`release_genres read: ${error.message}`);
    const existing = new Map<string, Map<string, number | null>>();
    for (const r of (data ?? []) as { release_group_id: string; genre_id: string; confidence: number | null }[]) {
      let m = existing.get(r.release_group_id);
      if (!m) existing.set(r.release_group_id, (m = new Map()));
      m.set(r.genre_id, r.confidence);
    }

    const upsertRows: object[] = [];
    const deletes: { rg: string; genreIds: string[] }[] = [];
    const unmappedRows: object[] = [];
    for (const item of chunk) {
      res.releaseGroups++;
      const { genres, unmapped } = resolveSourceTags(item.tags);
      const diff = diffSourceRows(existing.get(item.releaseGroupId) ?? new Map(), genres);
      if (!diff.upserts.length && !diff.deletes.length) res.unchanged++;
      for (const g of diff.upserts) {
        upsertRows.push({
          release_group_id: item.releaseGroupId,
          genre_id: g.genreId,
          source,
          confidence: g.confidence,
          is_primary: false,
        });
      }
      if (diff.deletes.length) deletes.push({ rg: item.releaseGroupId, genreIds: diff.deletes });
      for (const tag of unmapped) {
        if (opts.stageUnmapped && !opts.stageUnmapped(tag)) continue;
        unmappedRows.push({ release_group_id: item.releaseGroupId, title: item.title, raw_tag: tag, source });
      }
    }

    res.upserted += upsertRows.length;
    res.deleted += deletes.reduce((n, d) => n + d.genreIds.length, 0);
    res.unmappedStaged += unmappedRows.length;
    if (opts.dryRun) continue;

    if (upsertRows.length) {
      await withRetry('release_genres upsert', () =>
        db.from('release_genres').upsert(upsertRows, { onConflict: 'release_group_id,genre_id,source' }),
      );
    }
    for (const d of deletes) {
      await withRetry('release_genres delete', () =>
        db
          .from('release_genres')
          .delete()
          .eq('source', source)
          .eq('release_group_id', d.rg)
          .in('genre_id', d.genreIds),
      );
    }
    if (unmappedRows.length) {
      await withRetry('genre_unmapped stage', () =>
        db
          .from('genre_unmapped')
          .upsert(unmappedRows, { onConflict: 'release_group_id,raw_tag,source', ignoreDuplicates: true }),
      );
    }
  }
  return res;
}
