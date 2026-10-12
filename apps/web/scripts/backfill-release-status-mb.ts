/**
 * Establish which release groups are official, so bootlegs stop leading an artist's page.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-release-status-mb.ts --artist "MF DOOM"
 *   npx tsx --env-file=.env.local scripts/backfill-release-status-mb.ts --artist "MF DOOM" --apply
 *
 * THE PROBLEM. MusicBrainz catalogues bootlegs deliberately; Spotify and YouTube Music do not. So
 * our MF DOOM page opened with Metaphorical Villainy (a Nujabes mashup), Metal Chambers (a Wu-Tang
 * mashup) and DoomStarks (never released), then 20 compilations like The Doomilation Bootleg Vol. 2
 * and The Lost Relics of Dumile I-VI. Nothing in our schema could tell those from Operation:
 * Doomsday.
 *
 * WHY THE DATA WAS NOT ALREADY THERE. `releases.status` exists and browseReleases() already parses
 * MB's 'Official' | 'Promotion' | 'Bootleg'. But it is 62% NULL and the database contains ZERO
 * 'Bootleg' rows — for MF DOOM every release is NULL. The column was added and then not filled, so
 * the information has to be fetched now, one MB call per release group.
 *
 * TARGETED ON PURPOSE. At 1.1s per call, the whole catalogue is ~500k calls (weeks), and it is not
 * worth it: bootleg clutter only matters on artists whose pages people actually open, and
 * prolific-bootleg artists are a small set. Run it per artist.
 *
 * HOW is_official IS DECIDED, and why NULL is a real answer:
 *   true  — at least one release is 'Official'
 *   false — releases exist and NONE is 'Official' (bootleg / promo only)
 *   NULL  — MB returned no releases for the group, so nothing is established. Left NULL rather than
 *           guessed, because NULL sorts WITH official: a wrong `false` hides a real album, which is
 *           far worse than failing to demote a bootleg.
 *
 * ONE MUSICBRAINZ LANE AT A TIME. The pipeline's ingest lane is also on the MB API; two concurrent
 * lanes get the whole app throttled. Run this while the pipeline is stopped.
 *
 * Report-only unless --apply. Also writes each release's status to releases.status as it goes.
 */
import { browseReleases } from './mb-client';
import { getDB } from './mb-ingest';

const argv = process.argv.slice(2);
const arg = (f: string, d = '') => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const APPLY = argv.includes('--apply');
const ONLY_ARTIST = arg('--artist');
const LIMIT = parseInt(arg('--limit', '100'), 10);

const db = getDB();

async function main() {
  if (!ONLY_ARTIST) { console.error('  --artist "Name" is required (this is deliberately not a catalogue-wide sweep)'); process.exit(1); }
  console.log(`\n  MB release status → is_official — ${ONLY_ARTIST}${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  const { data: a } = await db.from('artists').select('id, name').eq('name', ONLY_ARTIST).limit(1);
  if (!a?.length) { console.error(`  artist "${ONLY_ARTIST}" not found`); process.exit(1); }

  const { data: rgs } = await db.from('release_groups')
    .select('id, title, release_group_type, mb_release_group_id, is_official')
    .eq('primary_artist_id', a[0].id)
    .not('mb_release_group_id', 'is', null)
    .limit(LIMIT);

  const rows = (rgs ?? []) as any[];
  console.log(`  ${rows.length} release group(s) with an MB id\n`);

  let official = 0, unofficial = 0, unknown = 0;
  for (const rg of rows) {
    const releases = await browseReleases(rg.mb_release_group_id);
    if (!releases.length) {
      unknown++;
      console.log(`  ?  ${String(rg.title).slice(0, 44).padEnd(46)} (MB returned no releases — left NULL)`);
      continue;
    }
    const statuses = releases.map(r => r.status ?? '(null)');
    const isOfficial = releases.some(r => (r.status ?? '') === 'Official');
    // All-NULL statuses establish nothing either: MB has releases but no status on them.
    const allNull = releases.every(r => !r.status);
    if (allNull) {
      unknown++;
      console.log(`  ?  ${String(rg.title).slice(0, 44).padEnd(46)} (no status on any release — left NULL)`);
      continue;
    }
    if (isOfficial) official++; else unofficial++;
    const mark = isOfficial ? 'OK' : 'BOOTLEG';
    console.log(`  ${mark.padEnd(8)} ${String(rg.title).slice(0, 40).padEnd(42)} [${[...new Set(statuses)].join(',')}]`);

    if (!APPLY) continue;
    await db.from('release_groups').update({ is_official: isOfficial }).eq('id', rg.id);
    // Keep releases.status too, so a later pass does not have to re-ask MB.
    for (const r of releases) {
      if (!r.status) continue;
      await db.from('releases').update({ status: r.status }).eq('mb_release_id', r.id);
    }
  }

  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  official:    ${official}`);
  console.log(`  unofficial:  ${unofficial}   ← demoted on the artist page`);
  console.log(`  unestablished (left NULL): ${unknown}`);
  if (!APPLY) console.log('  (report only — re-run with --apply to write)');
}

main().catch(e => { console.error(e); process.exit(1); });
