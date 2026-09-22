/**
 * Collapse near-simultaneous duplicate release groups: same artist, same type, same normalized
 * title, first_release_date within N days (default 31).
 *
 * WHY THE DATE WINDOW. Same-artist/same-title/same-type alone matches 7,310 sets (11,110 removable
 * rows), but many of those are NOT duplicates -- MusicBrainz modelled them as separate release
 * groups on purpose:
 *
 *   $uicideboy$  "G.R.E.Y.G.O.D.S."  2015-05-27 x2        same day    -> duplicate
 *   ¥$           "LIFESTYLE"         2024-08-03 / 08-05   2 days      -> duplicate
 *   10cc         "10cc" 1997 / "10cc" 1998 / "10c.c."     years apart -> different compilations
 *   10 Years     "The Optimist"      2022 / 2024          years apart -> probably distinct singles
 *
 * Collapsing the last two would destroy editorial information. Restricting to a tight window keeps
 * only the cases where two rows plausibly describe one release: 1,829 pairs within 31 days versus
 * 3,697 within a year and 5,134 where a date is missing entirely. Undated rows are never touched,
 * because "no date" is not evidence of sameness.
 *
 * SURVIVOR CHOICE matters because deleting a release group cascades to its releases, and from there
 * to release_tracks. Picking the emptier row as winner would destroy tracklists. Order:
 *   1. has user ratings   (and any rated row is never deleted at all, even as a loser)
 *   2. most editions
 *   3. most tracks
 *   4. earliest date      (the original pressing rather than a reissue)
 *   5. lowest id          (stable tie-break so re-runs agree)
 *
 * REPORT-ONLY unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/dedup-same-title-rgs.ts --window=31
 *   npx tsx --env-file=.env.local scripts/dedup-same-title-rgs.ts --window=31 --apply
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const WINDOW = Number(arg('--window') ?? 31);
const OUT = arg('--out') ?? 'scripts/data/dedup-same-title.json';

interface Row {
  id: string; title: string; type: string; date: string | null;
  artist: string; artist_id: string; editions: number; tracks: number; ratings: number;
}

async function main() {
  const db = getDB();

  // One pass in SQL: build the candidate sets, with the counts the survivor rule needs.
  const sql = `
    with n as (
      select rg.id, rg.primary_artist_id, rg.release_group_type t, rg.title, rg.first_release_date d,
             lower(regexp_replace(rg.title, '[^[:alnum:]]+', '', 'g')) k
        from release_groups rg
       where rg.primary_artist_id is not null and rg.first_release_date is not null
    ),
    grp as (select primary_artist_id, t, k from n group by 1,2,3 having count(*) > 1)
    select n.id, n.title, n.t as type, n.d::text as date, n.primary_artist_id as artist_id,
           a.name as artist,
           (select count(*) from releases r where r.release_group_id = n.id) as editions,
           (select count(*) from release_tracks rt join releases r2 on r2.id = rt.release_id
             where r2.release_group_id = n.id) as tracks,
           (select count(*) from ratings rr where rr.release_group_id = n.id) as ratings,
           n.k
      from n
      join grp on grp.primary_artist_id = n.primary_artist_id and grp.t = n.t and grp.k = n.k
      join artists a on a.id = n.primary_artist_id`;

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as (Row & { k: string })[];

  // Bucket, then split each bucket into date-clusters no wider than WINDOW days.
  const buckets = new Map<string, (Row & { k: string })[]>();
  for (const r of rows) {
    const key = `${r.artist_id}|${r.type}|${r.k}`;
    const b = buckets.get(key); if (b) b.push(r); else buckets.set(key, [r]);
  }

  const plans: { keep: Row; drop: Row[] }[] = [];
  for (const [, b] of buckets) {
    b.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
    let cluster: (Row & { k: string })[] = [];
    const flush = () => {
      if (cluster.length > 1) {
        const ranked = [...cluster].sort((x, y) =>
          (y.ratings - x.ratings) || (y.editions - x.editions) || (y.tracks - x.tracks) ||
          (x.date ?? '').localeCompare(y.date ?? '') || x.id.localeCompare(y.id));
        const keep = ranked[0];
        // A rated row is never deleted, even when it loses the ranking.
        const drop = ranked.slice(1).filter(r => r.ratings === 0);
        if (drop.length) plans.push({ keep, drop });
      }
      cluster = [];
    };
    for (const r of b) {
      if (!cluster.length) { cluster.push(r); continue; }
      const days = Math.abs(Date.parse(r.date!) - Date.parse(cluster[0].date!)) / 86_400_000;
      if (days <= WINDOW) cluster.push(r); else { flush(); cluster = [r]; }
    }
    flush();
  }

  const dropCount = plans.reduce((n, p) => n + p.drop.length, 0);
  console.log(`[dedup] window ${WINDOW}d — ${plans.length} set(s), ${dropCount} row(s) to remove${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  fs.writeFileSync(OUT, JSON.stringify(plans, null, 2));

  console.log('\nsample:');
  for (const p of plans.slice(0, 12)) {
    console.log(`  ${p.keep.artist} — "${p.keep.title}" [${p.keep.type}]`);
    console.log(`     KEEP ${p.keep.date} ed${p.keep.editions} tr${p.keep.tracks} rat${p.keep.ratings}`);
    for (const d of p.drop) console.log(`     drop ${d.date} ed${d.editions} tr${d.tracks} rat${d.ratings}  "${d.title}"`);
  }

  if (APPLY) {
    let deleted = 0;
    const ids = plans.flatMap(p => p.drop.map(d => d.id));
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await db.from('release_groups').delete().in('id', ids.slice(i, i + 100));
      if (error) console.warn(`  ! batch ${i}: ${error.message}`); else deleted += ids.slice(i, i + 100).length;
    }
    console.log(`\n  DELETED ${deleted} release group(s)`);
  } else {
    console.log(`\n  report → ${OUT}`);
    console.log('  report only — re-run with --apply to delete');
  }
}

if (process.argv[1] && process.argv[1].endsWith('dedup-same-title-rgs.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
