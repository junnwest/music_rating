/**
 * Build the stub-resolution work list, ordered by how VISIBLE each stub is in the app.
 *
 * WHY THIS EXISTS. Every MB ingest writes a `credit_stub` artist row for each collaborator on the
 * release it ingested, and those rows are inert: only 'tracks_done' artists are claimed by the
 * freshness/QC lanes, so nothing ever fetches the stub's own catalogue. The result is an artist
 * page showing one release -- the release they were credited on -- and nothing else. Reported from
 * the app as "i still see 1 release under john k".
 *
 * THE POPULATION IS NOT A BACKLOG, IT IS A TREADMILL. Measured 2026-09-25: 38,739 stubs, 12,481
 * created in three days against 9,725 drained. MusicBrainz's 1 req/sec retires ~3,200/day and
 * creates ~4,160/day in the same motion, so the queue grows while it drains and never converges.
 * The bulk queue order (priority 0, FIFO) therefore cannot be the answer for any particular artist:
 * John K sat 25,000 rows deep while a user was looking at his empty page.
 *
 * WHY iTUNES. Resolution here runs against iTunes, not MusicBrainz, so it is ADDITIVE rather than
 * competing for the same 1 req/sec. Measured from the kr-scene sweep: 5,359 artists in ~17 hours,
 * about 7,500/day at --per-min=25. Combined with the pipeline's ~3,200/day that clears the ~4,160
 * daily creation rate with room to spare -- which is the difference between a queue that converges
 * and one that does not. (An earlier estimate of 36,000/day was wrong: --per-min is a REQUEST
 * budget and each artist costs several requests.)
 *
 * ORDERING IS UNRESOLVED -- DO NOT RUN THIS IN BULK AS-IS. Credits-descending puts London Symphony
 * Orchestra (387 credits), Ravel, Debussy and Karajan at the top, and those are precisely the
 * heavily-featured entities resolve-stub-itunes refuses as TOO_LARGE; an orchestra's "own
 * discography" is not a meaningful thing to fetch. Worse, 71.3% of the 38,508 visible stubs have
 * exactly ONE credit -- John K among them -- so credit count barely discriminates across the
 * population that actually matters, and the artist who prompted this work would have been reached
 * LAST. A usable order needs a different signal (user demand, or the popularity of the releases a
 * stub is credited on); this script exists for the measurement, not yet as a work plan.
 *
 * ORDERED BY VISIBILITY, NOT BY ID. A stub credited on a release someone can click is a stub a user
 * can actually land on; one credited on nothing is invisible no matter how long it waits. 38,497 of
 * the 38,739 are visible, so this is mostly a reordering, but it puts the artists people reach
 * first. Within that, more credits first -- a collaborator on twelve releases is reachable from
 * twelve pages.
 *
 *   npx tsx --env-file=.env.local scripts/build-stub-targets.ts
 *   npx tsx --env-file=.env.local scripts/build-stub-targets.ts --limit=5000 --out=scripts/data/x.json
 */
import * as fs from 'node:fs';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(arg('--limit') ?? 40000);
const OUT = arg('--out') ?? 'scripts/data/stub-targets-all.json';

async function sql<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function main() {
  // A stub is worth resolving when it has an MBID (so identity is already settled), owns nothing
  // itself, and is credited on at least one release the app can surface.
  const rows = await sql<{ id: string; name: string; credits: number }>(`
    select a.id::text, a.name, count(rga.release_group_id) as credits
      from artists a
      join artist_external_ids x on x.artist_id = a.id and x.source = 'musicbrainz'
      join release_group_artists rga on rga.artist_id = a.id
     where a.ingest_state = 'resolved'
       and not exists (select 1 from release_groups rg where rg.primary_artist_id = a.id)
     group by 1, 2
     order by credits desc, a.name
     limit ${LIMIT}`);

  fs.writeFileSync(OUT, JSON.stringify(rows.map(r => r.id)));
  fs.writeFileSync(OUT.replace(/\.json$/, '-detail.json'), JSON.stringify(rows, null, 2));

  const total = rows.reduce((n, r) => n + Number(r.credits), 0);
  console.log(`  visible stubs        ${rows.length}`);
  console.log(`  total credit edges   ${total}  (each stub is reachable from this many release pages)`);
  console.log(`\n  most reachable first:`);
  for (const r of rows.slice(0, 12)) console.log(`    ${String(r.credits).padStart(4)}  ${r.name}`);
  console.log(`\n  ids  → ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith('build-stub-targets.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
