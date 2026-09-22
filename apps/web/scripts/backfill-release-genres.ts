/**
 * backfill-release-genres.ts — Phase 1 backfill (GENRE_TAXONOMY.md §4).
 *
 * Maps the current, denormalized `release_groups.genres text[]` through the
 * canonical resolver (lib/genres/resolver.ts) into the normalized
 * `release_genres` join table:
 *
 *   raw tag → resolveGenre → genre_id     → upsert release_genres(source='legacy')
 *   raw tag → (no node)    → genre_unmapped(title, raw tag, source='legacy')
 *   primaryOf(tags)        → is_primary=true on the winning genre_id
 *
 * Additive and idempotent: it never touches `release_groups.genres` (that stays
 * the live display denormalization until Phase 2), upserts on the natural keys,
 * and can be re-run safely after growing the taxonomy to mop up former misses.
 * Ends by printing the top unmapped tags — the review queue for taxonomy growth.
 *
 *   npm run taxonomy:backfill:dry    # preview + unmapped report, no writes
 *   npm run taxonomy:backfill        # apply
 *
 * Requires (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveGenre, primaryOf } from '../lib/genres/resolver';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const s = createClient(SUPABASE_URL, SERVICE_KEY);
const DRY = process.argv.includes('--dry-run');
const SOURCE = 'legacy'; // the `genres[]` array's per-source provenance was discarded long ago

type RG = { id: string; title: string | null; genres: string[] | null };

type GenreRow = { release_group_id: string; genre_id: string; source: string; confidence: number | null; is_primary: boolean };
type UnmappedRow = { release_group_id: string; title: string | null; raw_tag: string; source: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTimeout = (msg: string) => /timeout|57014|canceling statement/i.test(msg);

async function pageAll(): Promise<RG[]> {
  const out: RG[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await s
      .from('release_groups')
      .select('id,title,genres')
      .not('genres', 'is', null)
      // Stable sort key is REQUIRED: without it PostgREST `.range()` paging has an
      // undefined order, so pages overlap (dupes collapse on the PK) and, worse,
      // skip rows — a first run wrote only ~198k of 342k releases. Ordering by the
      // PK makes pagination cover every release exactly once.
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as RG[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

/** Chunked upsert with timeout backoff — the Supabase Micro times out large writes. */
async function upsertChunked<T extends object>(
  table: string,
  rows: T[],
  onConflict: string,
  ignoreDuplicates = false,
): Promise<{ written: number; failed: number }> {
  const CHUNK = 200;
  let written = 0, failed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      if (attempt > 0) await sleep(400 * attempt);
      const { error } = await s.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
      if (!error) { ok = true; written += chunk.length; }
      else if (!isTimeout(error.message)) { console.log(`  ${table} upsert error:`, error.message); break; }
    }
    if (!ok) failed += chunk.length;
    await sleep(15); // gentle pacing to spare the IO budget
    if (written % 2000 < CHUNK) process.stdout.write(`\r  ${table}: written ~${written}/${rows.length} (failed ${failed})`);
  }
  process.stdout.write('\n');
  return { written, failed };
}

(async () => {
  console.log(`backfill-release-genres ${DRY ? '(DRY RUN)' : ''}`);
  const rgs = await pageAll();
  console.log(`  release_groups with genres[]: ${rgs.length}`);

  const genreRows: GenreRow[] = [];
  const unmappedRows: UnmappedRow[] = [];
  const unmappedCounts = new Map<string, number>();
  let rgsWithPrimary = 0, rgsFullyUnmapped = 0;

  for (const rg of rgs) {
    const tags = (rg.genres ?? []).map((t) => t?.trim()).filter(Boolean) as string[];
    if (!tags.length) continue;

    const primary = primaryOf(tags);
    if (primary) rgsWithPrimary++;

    // Dedup resolved ids per release (many raw spellings can fold to one node).
    const seen = new Set<string>();
    let anyResolved = false;
    // Track unmapped tags per release, deduped so a repeated raw tag stages once.
    const stagedTags = new Set<string>();
    for (const tag of tags) {
      const id = resolveGenre(tag);
      if (id) {
        anyResolved = true;
        if (!seen.has(id)) {
          seen.add(id);
          genreRows.push({
            release_group_id: rg.id,
            genre_id: id,
            source: SOURCE,
            confidence: null, // the array carries no vote counts (discarded at ingest)
            is_primary: id === primary,
          });
        }
      } else {
        const key = tag.toLowerCase();
        unmappedCounts.set(key, (unmappedCounts.get(key) ?? 0) + 1);
        if (!stagedTags.has(key)) {
          stagedTags.add(key);
          unmappedRows.push({ release_group_id: rg.id, title: rg.title, raw_tag: tag, source: SOURCE });
        }
      }
    }
    if (!anyResolved) rgsFullyUnmapped++;
  }

  console.log(`  → release_genres rows to write : ${genreRows.length}`);
  console.log(`  → releases with a primary genre: ${rgsWithPrimary}/${rgs.length}`);
  console.log(`  → genre_unmapped rows to stage : ${unmappedRows.length}`);
  console.log(`  → releases with ZERO resolvable tags: ${rgsFullyUnmapped}`);

  // Top unmapped tags — the review queue for growing the taxonomy.
  const topUnmapped = [...unmappedCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log(`\n  Top unmapped tags (${unmappedCounts.size} distinct) — add a node/alias in taxonomy.ts, then re-run:`);
  for (const [tag, count] of topUnmapped) {
    console.log(`    ${String(count).padStart(6)}×  ${tag}`);
  }

  if (DRY) {
    console.log('\nDRY RUN — no writes.');
    return;
  }

  console.log('\nWriting…');
  const g = await upsertChunked('release_genres', genreRows, 'release_group_id,genre_id');
  const u = await upsertChunked('genre_unmapped', unmappedRows, 'release_group_id,raw_tag,source', true);
  console.log(`\n  done — release_genres: ${g.written} written${g.failed ? ` (${g.failed} failed)` : ''}; ` +
    `genre_unmapped: ${u.written} staged${u.failed ? ` (${u.failed} failed)` : ''}.`);
})();
