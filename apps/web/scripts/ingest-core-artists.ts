/**
 * Ingest the artists MAX_INGEST_RGS permanently refuses, in album/EP-only mode.
 *
 * THE PROBLEM (CATALOG_GAP_REPORT.md cause 2). Ingest refuses any artist with more than 800
 * MusicBrainz release groups, and that refusal is terminal: the queue row goes to `skipped` and
 * freshness parks next_check_at a decade out. 37 artists are stuck there. 29 are empty stubs --
 * Frank Sinatra, Johnny Cash, Grateful Dead, Ennio Morricone, Herbert von Karajan, the Berliner
 * Philharmoniker and most classical composers -- so nine Sinatra Grammy albums and Grateful Dead's
 * American Beauty are simply absent. Six more are frozen on a partial June ingest: Bruce
 * Springsteen is missing 11 studio albums including Wrecking Ball and Letter to You, Bob Dylan is
 * missing Tempest and Rough and Rowdy Ways, and U2's next re-poll is scheduled for 2036.
 *
 * WHY STUDIO ALBUM/EP RATHER THAN A HIGHER CAP. Raising the cap would reintroduce exactly the
 * watchdog restart-loop it exists to prevent. Studio album/EP is both what a listener looks for and
 * small enough to fit -- and the official-edition gate still applies, so bootlegs stay out.
 *
 * The first run of this script dropped only singles and refused 18 of the 33 all over again on the
 * same cap, because outside pop music a release-group count is not made of singles: Prokofiev went
 * 1318 -> 1314, Handel 1722 -> 1715, Frank Sinatra 1203 -> 925. Requiring an empty secondary-type
 * list -- no compilations, live albums, soundtracks or remix sets -- is what actually reduces them,
 * and ingestArtist now truncates rather than refusing when even that is over the cap, so a composer
 * gets his 800 oldest studio recordings instead of nothing.
 *
 * Report-only unless --apply. Re-runnable: ingestArtist is MBID-idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-core-artists.ts
 *   npx tsx --env-file=.env.local scripts/ingest-core-artists.ts --apply
 */
import { getDB, ingestArtist, nextCheckAt } from './mb-ingest';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit') ?? Infinity);

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
  const db = getDB();

  // Two populations, same cause: queue rows refused as heavily-featured, and artists already in the
  // catalogue whose freshness was parked far out for the same reason (a partial June ingest that
  // can never be topped up).
  const rows = await sql<{ mbid: string; name: string; own: number; src: string }>(`
    select distinct on (mbid) mbid, name, own, src from (
      select q.source_id as mbid, q.name, 0 as own, 'queue-skipped' as src
        from artist_ingestion_queue q
       where q.status = 'skipped' and q.error ilike '%heavily%' and q.source = 'mbid'
      union all
      select x.external_id as mbid, a.name,
             (select count(*) from release_groups rg where rg.primary_artist_id = a.id) as own,
             'frozen-far-future' as src
        from artists a
        join artist_external_ids x on x.artist_id = a.id and x.source = 'musicbrainz'
       where a.next_check_at > now() + interval '2 years'
    ) t
     order by mbid, own desc`);

  const targets = Number.isFinite(LIMIT) ? rows.slice(0, LIMIT) : rows;
  console.log(`[core-ingest] ${targets.length} artist(s)${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  for (const t of targets) console.log(`    ${t.src.padEnd(18)} own=${String(t.own).padStart(4)}  ${t.name}`);
  if (!APPLY) { console.log('\n  report only — re-run with --apply'); return; }

  let ok = 0, failed = 0, added = 0;
  for (const t of targets) {
    try {
      const before = t.own;
      const r = await ingestArtist(db, t.mbid, true);   // coreOnly
      const delta = Math.max(0, r.rgCount - before);
      added += delta;
      ok++;
      console.log(`  + ${t.name}: ${r.rgCount} groups (${delta > 0 ? '+' + delta : 'no change'}), ${r.recCount} recordings`);
      // Un-park freshness so the artist re-polls normally from now on.
      await db.from('artists').update({ next_check_at: nextCheckAt('known') }).eq('id', r.artistId);
      await db.from('artist_ingestion_queue')
        .update({ status: 'done', error: null, releases_added: r.rgCount })
        .eq('source_id', t.mbid);
    } catch (e) {
      failed++;
      console.warn(`  ! ${t.name}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`\n  ingested ${ok}, failed ${failed}, release groups added ${added}`);
}

if (process.argv[1] && process.argv[1].endsWith('ingest-core-artists.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
