/**
 * seed-missing-from-external.ts
 *
 * Finds every mb_release_group_id in external_scores that has no matching row
 * in release_groups, looks up the primary artist via the MusicBrainz API, and
 * queues those artists for ingestion in artist_ingestion_queue.
 *
 * Why: kr_masterpiece_100 / jp_mino_100 etc. have MBIDs in external_scores but
 * the corresponding artists were never ingested, so the leaderboard JOIN finds
 * nothing. This script closes that gap automatically — no hardcoded list needed.
 *
 * Run on Windows (pipeline machine), then restart the pipeline:
 *   npm run seed:missing-from-external          # queue all missing
 *   npm run seed:missing-from-external:dry      # preview without writing
 *   npm run pipeline                            # pipeline picks them up
 *   npm run backfill:rg-credits                 # link MBIDs on any existing rows
 */

import { getDB } from './itunes-ingest-core';
import { getReleaseGroupCredits } from './mb-client';

const DRY   = process.argv.includes('--dry-run');
// Same backdate as seed:missing — lands ahead of the prestige-backfill tail.
const BACKDATE = '2019-01-01T00:00:00Z';

async function main() {
  const db = getDB();

  // ── 1. All MBIDs present in external_scores ─────────────────────────────────
  // NB: page every fetch — a plain select caps at PostgREST's 1000-row default, which would
  // silently truncate both sides of the gap (3.2k external rows, 86k release_groups).
  console.log('Fetching external_scores MBIDs…');
  const extByMbid = new Map<string, { title: string; artist: string; source: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('external_scores')
      .select('mb_release_group_id, album_title, artist, source')
      .not('mb_release_group_id', 'is', null)
      .order('mb_release_group_id').range(from, from + 999);
    if (error) { console.error('external_scores query failed:', error.message); process.exit(1); }
    if (!data?.length) break;
    for (const r of data) {
      if (!extByMbid.has(r.mb_release_group_id)) {
        extByMbid.set(r.mb_release_group_id, { title: r.album_title, artist: r.artist, source: r.source });
      }
    }
    if (data.length < 1000) break;
  }
  console.log(`  ${extByMbid.size} unique release-group MBIDs in external_scores`);

  // ── 2. MBIDs already linked in release_groups ────────────────────────────────
  const inDB = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('release_groups')
      .select('mb_release_group_id')
      .not('mb_release_group_id', 'is', null)
      .order('mb_release_group_id').range(from, from + 999);
    if (error) { console.error('release_groups query failed:', error.message); process.exit(1); }
    if (!data?.length) break;
    for (const r of data) inDB.add(r.mb_release_group_id as string);
    if (data.length < 1000) break;
  }
  console.log(`  ${inDB.size} already linked in release_groups`);

  // ── 3. The gap ───────────────────────────────────────────────────────────────
  const missing = [...extByMbid.entries()].filter(([id]) => !inDB.has(id));
  console.log(`\n${missing.length} release groups not yet in DB:\n`);

  if (missing.length === 0) {
    console.log('Nothing to do — all external MBIDs are already in the DB.');
    return;
  }

  // ── 4. Resolve primary artist for each missing release group via MB ──────────
  const toQueue: { name: string; mbid: string }[] = [];
  const seenArtist = new Set<string>(); // one queue row per artist MBID

  for (const [rgMbid, meta] of missing) {
    process.stdout.write(`  [${meta.source}] ${meta.artist} — ${meta.title} … `);

    let credits;
    try {
      credits = await getReleaseGroupCredits(rgMbid);
    } catch (e: any) {
      console.log(`✗ MB error: ${e.message}`);
      continue;
    }

    const primary = credits[0];
    if (!primary?.mbid) {
      console.log('✗ no primary artist MBID in MB');
      continue;
    }

    if (seenArtist.has(primary.mbid)) {
      console.log(`↩  already queued (${primary.name})`);
      continue;
    }

    seenArtist.add(primary.mbid);
    toQueue.push({ name: primary.name, mbid: primary.mbid });
    console.log(`✓  ${primary.name}  (${primary.mbid})`);
  }

  console.log(`\n${toQueue.length} distinct artists to queue.`);

  if (DRY) {
    console.log('\n[dry-run] would queue:');
    for (const a of toQueue) console.log(`  ${a.name.padEnd(25)} ${a.mbid}`);
    console.log('\nNothing written (--dry-run).');
    return;
  }

  // ── 5. Upsert into artist_ingestion_queue ───────────────────────────────────
  const rows = toQueue.map(a => ({
    name:       a.name,
    source:     'mbid',
    source_id:  a.mbid,
    status:     'pending',
    created_at: BACKDATE,
  }));

  const { error: qErr } = await db
    .from('artist_ingestion_queue')
    .upsert(rows, { onConflict: 'name,source', ignoreDuplicates: true });
  if (qErr) { console.error('\nQueue insert failed:', qErr.message); process.exit(1); }

  console.log(`\nQueued ${rows.length} artists in artist_ingestion_queue (source=mbid).`);
  console.log('Next: restart the pipeline, then run backfill:rg-credits once ingestion finishes.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
