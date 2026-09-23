/**
 * Re-validate a resolve-stub-itunes report against the CURRENT catalogue and the CURRENT matcher,
 * before anything is written.
 *
 * WHY THIS EXISTS. A report is a snapshot of two things that both move: the matcher that decided
 * what counted as "already held", and the catalogue itself. Both changed underneath the 2026-09-22
 * sweep:
 *
 *   • The matcher was fixed mid-run. The run started with exact-key title matching plus a
 *     .limit(60) anchor cap, so for any artist with more than 60 release groups everything past the
 *     cap looked missing -- 33% false positives overall, 65% for those artists. Two further fixes
 *     landed after the sweep had already started: generic parentheticals were being promoted to
 *     alternate titles (so every "(Original Motion Picture Soundtrack)" matched every other), and
 *     short filler like "(NOT)" did the same (matching EVANGELION 2.0 against 3.0).
 *   • The catalogue grew. The pipeline's stub drain is adding release groups continuously, so an
 *     album that was genuinely missing when the sweep saw it may have arrived since.
 *
 * Re-running the sweep to pick up the fixes would cost another ~25 hours of iTunes time. Re-filtering
 * the report it already produced costs minutes, because the expensive part (resolving each artist
 * against iTunes) is already done and recorded.
 *
 * WHAT IT DOES. For every CORROBORATED artist, re-fetches everything the catalogue currently holds
 * for them and re-tests each reported-missing album with titleVariants/titlesMatch. Anything that
 * now matches is dropped. Verdicts are NOT revisited -- corroboration rests on anchor evidence,
 * which the title fixes only make stricter, so a CORROBORATED artist stays corroborated.
 *
 * WRITES NOTHING to the database. Output is a cleaned report for ingest-stub-itunes.ts.
 *
 *   npx tsx --env-file=.env.local scripts/refilter-stub-report.ts \
 *     --in=scripts/data/kr-scene-report.json --out=scripts/data/kr-scene-report.clean.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDB } from './itunes-ingest-core';
import { titleVariants, titlesMatch } from './resolve-stub-itunes';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const IN = arg('--in') ?? 'scripts/data/kr-scene-report.json';
const OUT = arg('--out') ?? 'scripts/data/kr-scene-report.clean.json';

interface Album { primary: boolean; collides: unknown | null; displayTitle: string; title: string; [k: string]: unknown }
interface Row { id: string; name: string; verdict: string; newAlbums: Album[]; [k: string]: unknown }

async function main() {
  const inFile = path.resolve(process.cwd(), IN);
  const rows: Row[] = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const corr = rows.filter(r => r.verdict === 'CORROBORATED');
  console.log(`[refilter] ${rows.length} rows, ${corr.length} corroborated`);

  const db = getDB();
  let before = 0, after = 0, artistsTouched = 0;
  const dropped: string[] = [];

  for (const r of corr) {
    const ingestable = r.newAlbums.filter(a => a.primary && !a.collides);
    if (!ingestable.length) continue;
    before += ingestable.length;

    // Everything the catalogue holds for this artist RIGHT NOW -- including rows added since the
    // sweep saw them, which is the second reason a report goes stale.
    const { data, error } = await db.from('release_group_artists')
      .select('release_groups!inner(title)').eq('artist_id', r.id).limit(1000);
    if (error) { console.warn(`  ! ${r.name}: ${error.message} — keeping as-is`); after += ingestable.length; continue; }
    const heldVars = (data ?? []).map((d: any) => titleVariants(d.release_groups.title, [r.name]));

    let removed = 0;
    for (const a of r.newAlbums) {
      if (!a.primary || a.collides) continue;
      const av = titleVariants(a.displayTitle, [r.name]);
      if (heldVars.some(hv => titlesMatch(av, hv))) {
        // Reuse the existing `collides` channel so ingest-stub-itunes.ts needs no change: it already
        // skips anything with collides set.
        a.collides = { title: a.displayTitle, artist: r.name, date: null, reason: 'refilter: already held' } as any;
        removed++;
        if (dropped.length < 15) dropped.push(`${r.name}: "${a.displayTitle}"`);
      }
    }
    if (removed) artistsTouched++;
    after += ingestable.length - removed;
  }

  const outFile = path.resolve(process.cwd(), OUT);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));

  const pct = before ? Math.round(100 * (before - after) / before) : 0;
  console.log(`\n  ingestable before : ${before}`);
  console.log(`  ingestable after  : ${after}`);
  console.log(`  dropped as already-held: ${before - after} (${pct}%) across ${artistsTouched} artist(s)`);
  if (dropped.length) { console.log('\n  examples:'); dropped.forEach(d => console.log('    ' + d)); }
  console.log(`\n  cleaned report → ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith('refilter-stub-report.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
