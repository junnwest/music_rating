/**
 * Work Item D — queue the MBID-verified missing artists for direct (no-resolve) ingestion.
 *
 * Inserts source='mbid' rows (source_id = MBID) with a backdated created_at so the INGEST lane
 * claims them ahead of the long pending tail. The lane treats source='mbid' as MBID-direct
 * (pipeline.ts) — so this is SAFE ONLY AFTER the pipeline has been restarted with that code.
 * If you run this against an OLD running pipeline, those rows fall back to name-resolution and
 * "Zico"/"Paloalto" will mis-match.
 *
 *   ① restart the pipeline:  npm run pipeline      (picks up the 'mbid' source)
 *   ② then seed:             npm run seed:missing   (or --dry-run to preview)
 *
 * Idempotent: onConflict (name, source) ignoreDuplicates.
 */
import { getDB } from './itunes-ingest-core';
import { MISSING_ARTISTS, MISSING_NOT_IN_MB } from './data/missing-artists';

const DRY = process.argv.includes('--dry-run');
// Earlier than the prestige backfill (2020-01-01) so these claim first.
const BACKDATE = '2019-01-01T00:00:00Z';

async function main() {
  const db = getDB();
  const rows = MISSING_ARTISTS.map(a => ({
    name: a.name, source: 'mbid', source_id: a.mbid, status: 'pending', created_at: BACKDATE,
  }));

  console.log(`[seed:missing] ${rows.length} MBID-direct artists${DRY ? '  [DRY RUN]' : ''}:`);
  for (const a of MISSING_ARTISTS) console.log(`   ${a.name.padEnd(13)} ${a.mbid}  ${a.note ?? ''}`);
  if (MISSING_NOT_IN_MB.length) console.log(`   (not in MB, Deezer-only: ${MISSING_NOT_IN_MB.join(', ')})`);

  if (DRY) { console.log('\n[seed:missing] dry run — nothing written.'); return; }

  const { error } = await db
    .from('artist_ingestion_queue')
    .upsert(rows, { onConflict: 'name,source', ignoreDuplicates: true });
  if (error) { console.error('  ! insert failed:', error.message); process.exit(1); }

  const { count } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('source', 'mbid');
  console.log(`\n[seed:missing] done — ${count} total source='mbid' rows pending. The restarted pipeline will ingest them next.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
