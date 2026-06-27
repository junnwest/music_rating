/**
 * One-off cleanup: remove the shadow artists the (now-disabled) GAPFILL job C created when
 * it ingested MB-skipped artists' full iTunes discographies. Those rows are identifiable by
 * `ingest_state = 'pending_resolve'` — the iTunes-core default state, which the MB pipeline
 * never uses (MB sets 'resolved' → 'tracks_done'). They have store-country (USA), null source,
 * collab-string junk names, and duplicate real MB artists.
 *
 * Deletes each shadow artist's full entity graph (release_tracks → recordings → releases →
 * release_groups → aliases/external_ids → artist), then resets the queue rows job C had
 * marked done (error='itunes-gapfill') back to 'skipped' so they're not re-ingested and stay
 * candidates for mb-overrides recovery.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-itunes-shadows.ts            # dry-run (report)
 *   npx tsx --env-file=.env.local scripts/cleanup-itunes-shadows.ts --write    # delete
 *
 * ⚠️ Run only AFTER restarting the pipeline with job C disabled (default), so no new shadows
 * are created mid-cleanup.
 */
import { getDB } from './itunes-ingest-core';

const WRITE = process.argv.includes('--write');
const chunk = <T>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function main() {
  const db = getDB();

  // 1. shadow artists = the iTunes-core 'pending_resolve' rows (MB never uses that state)
  const { data: shadows } = await db.from('artists').select('id, name, country').eq('ingest_state', 'pending_resolve');
  const ids = (shadows ?? []).map((r: any) => r.id);
  console.log(`\n  shadow artists (ingest_state='pending_resolve'): ${ids.length}`);
  if (shadows?.length) console.log('  sample:', shadows.slice(0, 12).map((r: any) => `${r.name}[${r.country ?? '--'}]`).join(', '));

  // 2. their release_groups → releases (for the cascade)
  const rgIds: string[] = [];
  for (const c of chunk(ids)) {
    const { data } = await db.from('release_groups').select('id').in('primary_artist_id', c);
    rgIds.push(...(data ?? []).map((r: any) => r.id));
  }
  const relIds: string[] = [];
  for (const c of chunk(rgIds)) {
    const { data } = await db.from('releases').select('id').in('release_group_id', c);
    relIds.push(...(data ?? []).map((r: any) => r.id));
  }
  // queue rows job C marked done
  const { count: qDone } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('error', 'itunes-gapfill');

  console.log(`  → ${rgIds.length} release_groups, ${relIds.length} releases, + recordings/tracks`);
  console.log(`  → ${qDone ?? 0} queue rows to reset (error='itunes-gapfill' → skipped)`);

  if (!WRITE) { console.log('\n  [dry-run] no deletes. Re-run with --write.\n'); return; }
  if (!ids.length) { console.log('\n  nothing to clean.\n'); return; }

  // recording ids owned by the shadow artists
  const recIds: string[] = [];
  for (const c of chunk(ids)) {
    const { data } = await db.from('recordings').select('id').in('primary_artist_id', c);
    recIds.push(...(data ?? []).map((r: any) => r.id));
  }

  // 3. delete the graph bottom-up (release_tracks reference both releases and recordings)
  for (const c of chunk(relIds)) await db.from('release_tracks').delete().in('release_id', c);
  for (const c of chunk(recIds)) await db.from('release_tracks').delete().in('recording_id', c);
  for (const c of chunk(ids))    await db.from('recordings').delete().in('primary_artist_id', c);
  for (const c of chunk(rgIds))  await db.from('releases').delete().in('release_group_id', c);
  for (const c of chunk(ids))    await db.from('release_groups').delete().in('primary_artist_id', c);
  for (const c of chunk(ids))    await db.from('artist_aliases').delete().in('artist_id', c);
  for (const c of chunk(ids))    await db.from('artist_external_ids').delete().in('artist_id', c);
  for (const c of chunk(ids))    await db.from('artists').delete().in('id', c);

  // 4. reset the queue rows job C claimed
  await db.from('artist_ingestion_queue')
    .update({ status: 'skipped', error: 'needs_review', processed_at: null })
    .eq('error', 'itunes-gapfill');

  console.log(`\n  ✓ deleted ${ids.length} shadow artists + their ${rgIds.length} groups / ${relIds.length} releases, reset ${qDone ?? 0} queue rows.\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
