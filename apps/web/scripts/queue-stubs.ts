/**
 * Catalog expansion #1 — queue the credit-stub artists for full ingestion.
 *
 * The release_group_artists backfill created ~4.6k 'resolved'+'mb_verified' stub artists: every
 * collaborator credited on an album already in the catalog, known by MBID but with no discography
 * of their own. They're the strongest non-arbitrary expansion signal — artists demonstrably
 * connected to music users already have. This queues them all as source='mbid' (MBID-direct, no
 * name resolution), so the pipeline fleshes out each one's full catalog.
 *
 * Pure DB inserts (no MusicBrainz calls) → safe to run while the pipeline is live; the running
 * pipeline (with the 'mbid' source) ingests them next.
 *
 *   npx tsx --env-file=.env.local scripts/queue-stubs.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/queue-stubs.ts
 */
import { getDB } from './itunes-ingest-core';

const DRY = process.argv.includes('--dry-run');

async function main() {
  const db = getDB();

  // Stub signature: resolved + mb_verified. (Fully-ingested artists are 'tracks_done'; a handful of
  // in-flight ingests may be transiently 'resolved' — queuing them is idempotent/harmless.)
  const PAGE = 1000;
  let stubs: { id: string; name: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('artists')
      .select('id, name')
      .eq('ingest_state', 'resolved').eq('source_status', 'mb_verified')
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    stubs.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  console.log(`[queue-stubs] ${stubs.length} stub artists found`);

  // MBID per stub (from artist_external_ids). Keep the `.in()` list small — a few hundred UUIDs
  // overflows the request URL and the query silently returns nothing.
  const byArtist = new Map<string, string>();
  for (let i = 0; i < stubs.length; i += 100) {
    const ids = stubs.slice(i, i + 100).map(s => s.id);
    const { data, error } = await db.from('artist_external_ids')
      .select('artist_id, external_id').eq('source', 'musicbrainz').in('artist_id', ids);
    if (error) { console.error(`  ! external_ids batch ${i}: ${error.message}`); continue; }
    for (const r of data ?? []) byArtist.set((r as any).artist_id, (r as any).external_id);
  }

  // Skip MBIDs already queued under source='mbid' (idempotent re-runs).
  const { data: existing } = await db.from('artist_ingestion_queue')
    .select('source_id').eq('source', 'mbid');
  const queued = new Set((existing ?? []).map((r: any) => r.source_id));

  // Build rows; (name, source) is UNIQUE, so disambiguate same-name stubs with a short MBID prefix.
  const usedNames = new Set<string>();
  const rows: { name: string; source: string; source_id: string; status: string }[] = [];
  let noMbid = 0, already = 0;
  for (const s of stubs) {
    const mbid = byArtist.get(s.id);
    if (!mbid) { noMbid++; continue; }
    if (queued.has(mbid)) { already++; continue; }
    let name = s.name;
    if (usedNames.has(name.toLowerCase())) name = `${s.name} (${mbid.slice(0, 6)})`;
    usedNames.add(name.toLowerCase());
    rows.push({ name, source: 'mbid', source_id: mbid, status: 'pending' });
  }

  console.log(`[queue-stubs] to queue: ${rows.length}  (skipped ${already} already-queued, ${noMbid} no-MBID)${DRY ? '  [DRY RUN]' : ''}`);
  if (DRY) { console.log('  sample:', rows.slice(0, 8).map(r => r.name).join(', ')); return; }

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from('artist_ingestion_queue')
      .upsert(batch, { onConflict: 'name,source', ignoreDuplicates: true });
    if (error) { console.error(`  ! batch ${i}: ${error.message}`); process.exit(1); }
    console.log(`  queued ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  const { count } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('source', 'mbid').eq('status', 'pending');
  console.log(`[queue-stubs] done — ${count} source='mbid' rows pending. The live pipeline will drain them.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
