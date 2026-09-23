/**
 * Spot-check a stub-iTunes write report against the LIVE catalogue before anything is written.
 * REPORT ONLY.
 *
 * WHY, given refilter-stub-report.ts already exists. Refilter answers "does the current matcher
 * still think this is missing?" -- but it is the matcher itself that has been wrong twice. When the
 * first refilter pass dropped 1 album out of 17,123, that looked like a clean report and was
 * actually a broken matcher: titleVariants applied each reduction once, to the seed only, so
 * "NCT#127 LIMITLESS - The 2nd Mini Album" never reduced to "limitless" and never matched the
 * LIMITLESS already in the catalogue. Fixing that took the count to 30.
 *
 * A number produced by the thing under test is not evidence about the thing under test. This takes
 * a spread sample of what WOULD be written, re-queries the catalogue for that artist, and prints
 * both sides so the titles can be read by eye -- the check that caught the bug in the first place.
 *
 *   npx tsx --env-file=.env.local scripts/verify-writepass-sample.ts --in=scripts/data/kr-scene-refiltered.json --n=25
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { titleVariants, titlesMatch } from './resolve-stub-itunes';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const IN = arg('--in') ?? 'scripts/data/kr-scene-refiltered.json';
const N = Number(arg('--n') ?? 25);

interface Album { primary: boolean; collides: unknown | null; displayTitle: string }
interface Row { id: string; name: string; verdict: string; newAlbums: Album[] }

async function main() {
  const db = getDB();
  const rows: Row[] = JSON.parse(fs.readFileSync(IN, 'utf8'));

  // One candidate album per artist, spread evenly through the report rather than taken from the
  // front -- the head of a report is not representative of its tail.
  const pool: { artist: string; id: string; title: string }[] = [];
  for (const r of rows) {
    if (r.verdict !== 'CORROBORATED') continue;
    for (const a of r.newAlbums ?? []) {
      if (a.primary && !a.collides) { pool.push({ artist: r.name, id: r.id, title: a.displayTitle }); break; }
    }
  }
  const step = Math.max(1, Math.floor(pool.length / N));
  const sample = [];
  for (let i = 0; i < pool.length && sample.length < N; i += step) sample.push(pool[i]);

  console.log(`[verify] ${pool.length} artists have at least one pending write; checking ${sample.length} spread across the report\n`);

  let held = 0;
  for (const s of sample) {
    const { data, error } = await db.from('release_group_artists')
      .select('release_groups!inner(title)').eq('artist_id', s.id).limit(1000);
    if (error) { console.log(`  ?  ${s.artist} :: ${s.title}   (lookup failed: ${error.message})`); continue; }
    const titles = (data ?? []).map((d: any) => d.release_groups.title as string);
    const av = titleVariants(s.title, [s.artist]);
    const hit = titles.find(t => titlesMatch(av, titleVariants(t, [s.artist])));
    if (hit) { held++; console.log(`  HELD  ${s.artist} :: "${s.title}"\n          we already have "${hit}"`); }
    else console.log(`  new   ${s.artist} :: "${s.title}"   (artist has ${titles.length} rows)`);
  }

  console.log(`\n  ${held}/${sample.length} sampled writes are already in the catalogue`);
  if (held === 0) console.log('  no duplicates in the sample — consistent with the report being safe to write');
  else console.log('  duplicates present — do NOT write; the matcher is still missing cases');
}

if (process.argv[1] && process.argv[1].endsWith('verify-writepass-sample.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
