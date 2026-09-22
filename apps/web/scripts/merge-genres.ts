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

async function main() {
  // Sample release groups that have both a displayed genres[] and release_genres rows.
  const { data: groups, error } = await db
    .from('release_groups')
    .select('id, title, genres')
    .not('genres', 'is', null)
    .order('id')
    .limit(SAMPLE);
  if (error) throw new Error(error.message);

  let changed = 0;
  let shown = 0;
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
      console.log(`  merged: ${mergedIds.join(', ')}`);
    }
  }

  const n = (groups ?? []).length;
  console.log(
    `\n— sampled ${n} groups; ${changed} would change ranked-set vs today's genres[] (${
      n ? Math.round((changed / n) * 100) : 0
    }%). Sources present today: legacy-only until per-source acquisition lands.`,
  );
}

main();
