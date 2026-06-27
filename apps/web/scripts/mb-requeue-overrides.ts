/**
 * Maintenance for the generic-name MBID overrides (mb-overrides.ts).
 *
 * When a generic stage name was ingested as a WRONG artist before its override existed
 * (e.g. seed "TXT" → "Depeche Mode remixer"), this script:
 *   1) deletes the wrong, false-match artist row — only when it carries 0 release_groups
 *      (i.e. no real catalog data to lose; safe anytime, even while the pipeline runs);
 *   2) with --requeue, resets that name's seed queue row → pending so the INGEST lane
 *      re-resolves it through the override.
 *
 *   npx tsx --env-file=.env.local scripts/mb-requeue-overrides.ts            # cleanup only (safe live)
 *   npx tsx --env-file=.env.local scripts/mb-requeue-overrides.ts --requeue  # + reset queue rows
 *
 * ⚠️ Run --requeue only when the pipeline is NOT running the OLD code (i.e. right before
 *    you restart `npm run pipeline`). The override is read at process start, so a still-
 *    running old worker would just re-create the wrong row. Cleanup (no flag) is always safe.
 */
import { getDB, normalizeStr } from './itunes-ingest-core';
import { MB_ARTIST_OVERRIDES } from './mb-overrides';

const REQUEUE = process.argv.includes('--requeue');

async function main() {
  const db = getDB();
  const keys = Object.keys(MB_ARTIST_OVERRIDES);
  console.log(`\n  mb-requeue-overrides — ${keys.length} override names${REQUEUE ? ' [--requeue]' : ' [cleanup only]'}\n`);

  // 1) delete wrong false-match artist rows (linked to a non-override MBID, 0 release_groups)
  const { data: artists } = await db.from('artists').select('id, name');
  for (const a of artists ?? []) {
    const key = normalizeStr(a.name);
    const want = MB_ARTIST_OVERRIDES[key];
    if (!want) continue;
    const { data: ext } = await db.from('artist_external_ids')
      .select('external_id').eq('artist_id', a.id).eq('source', 'musicbrainz');
    const mbid = ext?.[0]?.external_id as string | undefined;
    if (mbid === want) continue; // already the right artist
    const { count: rgCount } = await db.from('release_groups')
      .select('id', { count: 'exact', head: true }).eq('artist_id', a.id);
    if ((rgCount ?? 0) > 0) {
      console.log(`  ! "${a.name}" linked to ${mbid ?? '(none)'} but has ${rgCount} release_groups — NOT deleting (manual review)`);
      continue;
    }
    await db.from('artist_aliases').delete().eq('artist_id', a.id);
    await db.from('artist_external_ids').delete().eq('artist_id', a.id);
    await db.from('artists').delete().eq('id', a.id);
    console.log(`  ✓ deleted wrong "${a.name}" (was ${mbid ?? '(none)'}, 0 release_groups)`);
  }

  // 2) requeue the seed rows for override names so they re-resolve through the override
  if (REQUEUE) {
    const { data: rows } = await db.from('artist_ingestion_queue')
      .select('id, name, source, status').neq('status', 'pending');
    let reset = 0;
    for (const r of rows ?? []) {
      if (!MB_ARTIST_OVERRIDES[normalizeStr(r.name)]) continue;
      await db.from('artist_ingestion_queue')
        .update({ status: 'pending', processed_at: null, error: null }).eq('id', r.id);
      console.log(`  ↺ requeued "${r.name}" (was ${r.status}, source=${r.source})`);
      reset++;
    }
    console.log(`\n  requeued ${reset} rows → pending\n`);
  } else {
    console.log('\n  (cleanup only — pass --requeue at restart to reset queue rows)\n');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
