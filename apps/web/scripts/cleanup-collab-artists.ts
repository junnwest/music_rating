/**
 * Cleans up collaboration artist entries from the DB.
 *
 * Targets names like "Coldplay & BTS", "Drake feat. 21 Savage",
 * "Billy Woods, Kenny Segal" — Last.fm collab nodes that are not
 * real standalone artist entities.
 *
 * Actions:
 *   - artist_ingestion_queue: deletes all collab entries (any status)
 *   - artists table: deletes collab entries with no ratings attached
 *   - releases: untouched — collab releases (e.g. "My Universe") stay in DB
 *
 * Run:
 *   npm run cleanup:collabs              (dry run by default)
 *   npm run cleanup:collabs -- --fix     (apply changes)
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--fix');

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

const LEGIT_COMPOUND_ACTS = new Set([
  'hall & oates', 'simon & garfunkel', 'sly & the family stone',
  'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash',
  'toots & the maytals', 'all natural lemon & lime flavors',
  'eric b. & rakim', 'pete rock & c.l. smooth',
  'above & beyond', 'pig&dan',
  'ampers&one', '15&', 'gd & top', 'h&d',
  'irene & seulgi', 'red velvet – irene & seulgi', 'red velvet - irene & seulgi',
  'moonbin & sanha', 'super junior-d&e', 'jinjin & rocky',
  'longguo & shihyun', 'soohyun & hoon',
  'kiha & the faces', 'shin jung hyun & yup juns',
  'richard & linda thompson',
]);

function isCollaborationArtist(name: string): boolean {
  if (LEGIT_COMPOUND_ACTS.has(name.toLowerCase())) return false;
  if (/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(name)) return true;
  if (/&/.test(name)) return true;
  if (/\s\+\s/.test(name)) return true;
  return false;
}

async function main() {
  const db = getDB();
  console.log(`\n  sillajuku collab artist cleanup${DRY_RUN ? ' [DRY RUN — pass --fix to apply]' : ''}\n`);

  // ── 1. artist_ingestion_queue ──────────────────────────────────────────────

  console.log('  [1] Scanning artist_ingestion_queue…\n');

  const collabQueue: { id: string; name: string; status: string }[] = [];
  let from = 0;
  while (true) {
    const { data } = await db
      .from('artist_ingestion_queue')
      .select('id, name, status')
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) {
      if (isCollaborationArtist(r.name)) collabQueue.push(r);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  const byStatus: Record<string, number> = {};
  for (const r of collabQueue) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  console.log(`  Found ${collabQueue.length} collab entries in queue:`);
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`    ${status.padEnd(12)} ${count}`);
  }
  console.log(`\n  Sample names:`);
  collabQueue.slice(0, 10).forEach(r => console.log(`    [${r.status}] ${r.name}`));

  if (!DRY_RUN && collabQueue.length > 0) {
    const ids = collabQueue.map(r => r.id);
    // Delete in batches of 100
    for (let i = 0; i < ids.length; i += 100) {
      await db.from('artist_ingestion_queue').delete().in('id', ids.slice(i, i + 100));
    }
    console.log(`\n  ✅ Deleted ${ids.length} collab entries from queue.`);
  }

  // ── 2. artists table ───────────────────────────────────────────────────────

  console.log('\n  [2] Scanning artists table…\n');

  const { data: allArtists } = await db.from('artists').select('id, name');
  const collabArtists = (allArtists ?? []).filter((a: any) => isCollaborationArtist(a.name));

  console.log(`  Found ${collabArtists.length} collab entries in artists table.`);
  if (collabArtists.length > 0) {
    console.log(`  Sample: ${collabArtists.slice(0, 5).map((a: any) => a.name).join(', ')}`);
  }

  if (!DRY_RUN && collabArtists.length > 0) {
    let deleted = 0;
    for (const artist of collabArtists) {
      // Only delete if no releases OR ratings reference this artist
      const [{ count: releaseCount }, { count: ratingCount }] = await Promise.all([
        db.from('releases').select('*', { count: 'exact', head: true }).eq('artist_id', artist.id),
        db.from('ratings').select('*', { count: 'exact', head: true }).eq('artist_id', artist.id),
      ]);
      if ((releaseCount ?? 0) === 0 && (ratingCount ?? 0) === 0) {
        await db.from('artists').delete().eq('id', artist.id);
        deleted++;
      } else {
        console.log(`    skipped ${artist.name} — ${releaseCount} releases, ${ratingCount} ratings`);
      }
    }
    console.log(`  ✅ Deleted ${deleted} collab artists (${collabArtists.length - deleted} skipped — have linked data).`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log('\n  ─────────────────────────────────────────────');
  if (DRY_RUN) {
    console.log('  Dry run complete. Run with --fix to apply changes.');
  } else {
    console.log('  Cleanup complete.');
  }
  console.log();
}

main().catch(err => { console.error(err); process.exit(1); });
