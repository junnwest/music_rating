/**
 * merge-genres.ts — exercise the Phase-3 genre MERGE (lib/genres/merge.ts) over
 * the real `release_genres` rows and REPORT what the displayed set would become.
 *
 * READ-ONLY BY DESIGN. It never writes: materializing the merged set into the
 * displayed column is a deliberate cutover (the target column/format — canonical
 * ids vs display strings, in `release_groups.genres` or a new column — is chosen
 * when per-source acquisition is live and the merge is validated). This tool is
 * how you validate it first: run it, eyeball the diffs vs today's genres[], and
 * confirm the merge is sane before any cutover.
 *
 *   npx tsx --env-file=.env.local scripts/merge-genres.ts            # sample 40 groups
 *   npx tsx --env-file=.env.local scripts/merge-genres.ts --sample=200
 *   npx tsx --env-file=.env.local scripts/merge-genres.ts --limit=6  # top-N per group
 *   npx tsx --env-file=.env.local scripts/merge-genres.ts --source=musicbrainz
 *       # sample only groups that have rows from that source (validate one source's cutover)
 */
import { createClient } from '@supabase/supabase-js';
import { mergeGenres, type GenreAssignment, type GenreSource } from '../lib/genres/merge';
import { resolveGenre } from '../lib/genres/resolver';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from environment');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const argNum = (name: string, def: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? parseInt(a.split('=')[1], 10) : def;
};
const SAMPLE = argNum('sample', 40);
const TOPN = argNum('limit', 6);
const SOURCE = process.argv.find((x) => x.startsWith('--source='))?.split('=')[1] as GenreSource | undefined;

/** Up to SAMPLE release-group ids that carry at least one row from `source`. */
async function idsWithSource(source: GenreSource): Promise<string[]> {
  const { data, error } = await db
    .from('release_genres')
    .select('release_group_id')
    .eq('source', source)
    .order('release_group_id')
    .limit(Math.min(SAMPLE * 12, 1000));
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.release_group_id as string))].slice(0, SAMPLE);
}

async function main() {
  // Sample release groups that have both a displayed genres[] and release_genres rows
  // (or, with --source, groups that carry that source's rows).
  let q = db.from('release_groups').select('id, title, genres').not('genres', 'is', null);
  if (SOURCE) q = q.in('id', await idsWithSource(SOURCE));
  const { data: groups, error } = await q.order('id').limit(SAMPLE);
  if (error) throw new Error(error.message);

  let changed = 0;
  let shown = 0;
  let multiSourceIds = 0;
  let mergedIdTotal = 0;
  const sourcesSeen = new Map<string, number>();
  for (const g of groups ?? []) {
    const { data: rows } = await db
      .from('release_genres')
      .select('genre_id, source, confidence')
      .eq('release_group_id', g.id);
    if (!rows?.length) continue;

    const merged = mergeGenres(
      rows.map((r) => ({
        genreId: r.genre_id as string,
        source: r.source as GenreSource,
        confidence: r.confidence as number | null,
      })) as GenreAssignment[],
      { limit: TOPN },
    );
    const mergedIds = merged.map((m) => m.genreId);
    for (const m of merged) {
      mergedIdTotal++;
      if (m.sources.length > 1) multiSourceIds++;
    }
    for (const src of new Set(rows.map((r) => r.source as string))) {
      sourcesSeen.set(src, (sourcesSeen.get(src) ?? 0) + 1);
    }
    // Current displayed set, mapped to canonical ids for an apples-to-apples diff.
    const currentIds = [
      ...new Set((g.genres as string[]).map((t) => resolveGenre(t)).filter(Boolean) as string[]),
    ];

    const same =
      mergedIds.length === currentIds.length && mergedIds.every((id) => currentIds.includes(id));
    if (!same) changed++;
    if (shown < 12) {
      shown++;
      console.log(`\n${g.title}`);
      console.log(`  now:    ${currentIds.join(', ') || '(none resolve)'}`);
      console.log(
        `  merged: ${merged.map((m) => `${m.genreId}[${m.sources.join('+')}]`).join(', ')}`,
      );
    }
  }

  const n = (groups ?? []).length;
  console.log(
    `\n— sampled ${n} groups; ${changed} would change ranked-set vs today's genres[] (${
      n ? Math.round((changed / n) * 100) : 0
    }%).`,
  );
  console.log(
    `  sources present (groups): ${[...sourcesSeen].map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}; ` +
      `${multiSourceIds}/${mergedIdTotal} displayed ids backed by >1 source.`,
  );
}

main();
