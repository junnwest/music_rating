/**
 * Re-test every cover swap in a rollback journal against the CURRENT matcher, and restore the ones
 * that no longer hold. REPORT-ONLY unless --apply.
 *
 * WHY THIS EXISTS. upgrade-covers-deezer.ts pins the artist by exact name and then matches titles
 * with titleVariants/titlesMatch, which is safe only as far as titleVariants is correct. It was not:
 * isAlternateTitle rejected generic parentheticals with an anchored regex built around a SINGLE
 * descriptor word, so every MULTI-WORD descriptor escaped it and became a standalone variant that
 * matched any other release sharing the same aside. Caught by auditing the journal rather than the
 * logs -- 4.1% of swaps matched on neither an exact title nor a containment, and reading those
 * showed real damage:
 *
 *   RichaadEB   "Lyin' 2 Me (Instrumental Version)"      -> "Raise Up Your Bat (Instrumental Version)"
 *   RichaadEB   "Lifelight (Japanese Version)"           -> "Flower Man (Japanese Version)"
 *   A.R. Rahman "Kochadaiiyaan (Original Background Score)" -> "Raayan (Original Background Score)"
 *   A.R. Rahman "Jaane Tu (From \"Chhaava\")"              -> "Chhaava (Telugu)"
 *
 * Different songs, different films, same parenthetical.
 *
 * WHAT IT RE-TESTS. Only swaps made by the `artist` strategy: the `search` fallback compares raw
 * normalized titles for exact equality and never consults titleVariants, so it is unaffected by
 * these fixes. Artist names come from the DATABASE, not the journal's artist_display, because
 * titleVariants strips a leading artist name and the display string ("Doris Day and Gene Nelson
 * with...") is not what the original run passed.
 *
 * Conservative on purpose: a row is restored only when it fails under BOTH the canonical artist
 * name and the journal's display string. Restoring a good cover costs a CAA URL that was already
 * there; keeping a bad one leaves the wrong art on an album indefinitely.
 *
 *   npx tsx --env-file=.env.local scripts/revalidate-cover-swaps.ts
 *   npx tsx --env-file=.env.local scripts/revalidate-cover-swaps.ts --apply
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { titleVariants, titlesMatch } from './resolve-stub-itunes';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const JOURNAL = arg('--journal') ?? 'scripts/data/cover-upgrade-rollback.ndjson';
const OUT = arg('--out') ?? 'scripts/data/cover-swap-revalidation.json';

interface Swap { id: string; artist: string; title: string; old: string; new: string; via: string; how: 'artist' | 'search' }

async function sql<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function main() {
  const db = getDB();
  const swaps: Swap[] = fs.readFileSync(JOURNAL, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  console.log(`[revalidate] ${swaps.length} swap(s) from ${JOURNAL}${APPLY ? '  *** APPLY (restores) ***' : '  (report only)'}`);

  // Canonical artist names, in batches, for the rows the journal touched.
  const names = new Map<string, string[]>();
  const ids = swaps.map(s => s.id);
  for (let i = 0; i < ids.length; i += 300) {
    const rows = await sql<{ id: string; name: string; name_native: string | null }>(
      `select rg.id::text, a.name, a.name_native
         from release_groups rg join artists a on a.id = rg.primary_artist_id
        where rg.id in (${ids.slice(i, i + 300).map(x => `'${x}'`).join(',')})`);
    for (const r of rows) names.set(r.id, [r.name, r.name_native].filter(Boolean) as string[]);
  }

  const bad: Swap[] = [];
  let checkedArtist = 0, skippedSearch = 0;
  for (const s of swaps) {
    if (s.how !== 'artist') { skippedSearch++; continue; }
    checkedArtist++;
    const canonical = names.get(s.id) ?? [];
    const candidates = [...canonical, s.artist].filter(Boolean);
    const ok = candidates.some(n => titlesMatch(titleVariants(s.title, [n]), titleVariants(s.via, [n])));
    if (!ok) bad.push(s);
  }

  console.log(`  artist-strategy swaps re-tested : ${checkedArtist}`);
  console.log(`  search-strategy swaps skipped   : ${skippedSearch}  (exact-title, unaffected)`);
  console.log(`  NO LONGER MATCH, to restore     : ${bad.length} (${(100 * bad.length / Math.max(checkedArtist, 1)).toFixed(1)}%)`);
  fs.writeFileSync(OUT, JSON.stringify(bad, null, 2));

  console.log('\n  sample of what will be restored:');
  for (const s of bad.slice(0, 15)) console.log(`    ${s.artist} :: "${s.title}"  ->  "${s.via}"`);

  if (APPLY) {
    let n = 0;
    for (const s of bad) {
      const { error } = await db.from('release_groups').update({ cover_url: s.old }).eq('id', s.id);
      if (error) console.warn(`  ! ${s.id}: ${error.message}`); else n++;
      if (n % 100 === 0) console.log(`  restored ${n}/${bad.length}`);
    }
    console.log(`\n  RESTORED ${n} cover(s) to their previous URL`);
  } else {
    console.log(`\n  report → ${OUT}`);
    console.log('  report only — re-run with --apply to restore');
  }
}

if (process.argv[1] && process.argv[1].endsWith('revalidate-cover-swaps.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
