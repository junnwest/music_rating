/**
 * Catalog expansion #2/#3 — resolve a list of artist NAMES to MBIDs and queue the confident ones.
 *
 * Shared by:
 *   #2 curated scene seed:  --list=kr-scene     (reads scripts/data/<list>.ts → NAMES export)
 *   #3 search-miss recovery: --misses           (reads the search_misses table)
 *
 * Each name goes through the alias-aware resolver (mb-ingest.resolveArtist). Only a confident,
 * UNAMBIGUOUS match is queued (source='mbid' → MBID-direct ingest, so a later name-search can't
 * drift). Ambiguous / no-match names are reported for manual review (add them to
 * data/missing-artists.ts with an explicit MBID). Hits MusicBrainz (~1 req/s) — small batches are
 * fine alongside the pipeline; for a big curated list, pause the pipeline first.
 *
 *   npx tsx --env-file=.env.local scripts/queue-by-name.ts --misses --dry-run
 *   npx tsx --env-file=.env.local scripts/queue-by-name.ts --list=kr-scene --region=KR
 */
import { getDB, resolveArtist } from './mb-ingest';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MISSES = args.includes('--misses');
const LIST = args.find(a => a.startsWith('--list='))?.split('=')[1];
const REGION = args.find(a => a.startsWith('--region='))?.split('=')[1] ?? null;

async function loadNames(db: ReturnType<typeof getDB>): Promise<string[]> {
  if (MISSES) {
    const { data } = await db.from('search_misses').select('query');
    return [...new Set((data ?? []).map((r: any) => String(r.query).trim()).filter(Boolean))];
  }
  if (LIST) {
    const mod = await import(`./data/${LIST}`);
    return (mod.NAMES ?? []) as string[];
  }
  throw new Error('pass --misses or --list=<name>');
}

async function main() {
  const db = getDB();
  const names = await loadNames(db);
  console.log(`[queue-by-name] ${names.length} names${REGION ? ` (region ${REGION})` : ''}${DRY ? '  [DRY RUN]' : ''}`);

  const { data: existing } = await db.from('artist_ingestion_queue').select('source_id').eq('source', 'mbid');
  const queued = new Set((existing ?? []).map((r: any) => r.source_id));
  const usedNames = new Set<string>();
  const rows: { name: string; source: string; source_id: string; status: string }[] = [];
  const ambiguous: string[] = [], nomatch: string[] = [];

  for (const name of names) {
    const r = await resolveArtist(name, REGION);
    if (!r.best) { nomatch.push(name); continue; }
    if (r.ambiguous) { ambiguous.push(`${name} → ${r.best.name} [${r.best.id}] (AMBIGUOUS, skipped)`); continue; }
    if (queued.has(r.best.id)) continue;
    let qn = name;
    if (usedNames.has(qn.toLowerCase())) qn = `${name} (${r.best.id.slice(0, 6)})`;
    usedNames.add(qn.toLowerCase());
    rows.push({ name: qn, source: 'mbid', source_id: r.best.id, status: 'pending' });
    console.log(`  ✓ ${name.padEnd(24)} → ${r.best.name}${r.best.disambiguation ? ` (${r.best.disambiguation})` : ''} [${r.best.country ?? '--'}]`);
  }

  if (ambiguous.length) console.log(`\n  AMBIGUOUS (skipped — add to data/missing-artists.ts with explicit MBID):\n   ${ambiguous.join('\n   ')}`);
  if (nomatch.length)   console.log(`\n  NO MATCH (${nomatch.length}): ${nomatch.join(', ')}`);
  console.log(`\n[queue-by-name] ${rows.length} to queue, ${ambiguous.length} ambiguous, ${nomatch.length} no-match`);

  if (DRY || !rows.length) { if (DRY) console.log('  dry run — nothing written.'); return; }
  const { error } = await db.from('artist_ingestion_queue').upsert(rows, { onConflict: 'name,source', ignoreDuplicates: true });
  if (error) { console.error('  ! insert failed:', error.message); process.exit(1); }
  console.log(`[queue-by-name] queued ${rows.length} as source='mbid'.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
