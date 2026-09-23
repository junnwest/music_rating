/**
 * Find release groups already in the catalogue that MusicBrainz holds NO official edition for.
 *
 * WHY. Until 2026-09-22 the ingest filtered on release-group TYPE only. MusicBrainz statuses each
 * RELEASE (Official / Promotion / Bootleg / Pseudo-Release / Cancelled / Withdrawn), release groups
 * carry no status at all, and we read that status, used it to pick which edition to keep, then threw
 * it away. So a group whose every edition is a bootleg was ingested and displayed as a normal album.
 *
 * Reported from the app: "Ye" showed 87 albums where MusicBrainz's own site shows 13 (the site
 * filters to official; we did not filter). Re-running the new gate against Ye drops him from 191
 * release groups to 93 -- "Yeezus II", "So Help Me God", "Cruel Winter", "YE-VANGELION" and the like,
 * every one typed `album` with no `live` secondary type, which is exactly why a TYPE filter could
 * never catch them. Same root cause as Nirvana's "Greatest Hits Broadcast Collection" ranking
 * alongside Nevermind.
 *
 * mb-ingest.ts now gates on this at write time. This script is the other half: the ~13% already
 * ingested (sampled across 8 prolific artists: 65 of 512 release groups, 0%-29% by artist).
 *
 * WHY PER-ARTIST. browseArtistReleases returns EVERY edition for an artist with its status in a
 * couple of paged requests, so one artist answers the question for all their release groups at once.
 * Per-release-group lookups would be ~495,000 requests at MusicBrainz's 1 req/sec; per-artist is
 * ~23,000 artists.
 *
 * REPORT-ONLY BY DEFAULT. Deleting a release group destroys any rating attached to it, so this
 * writes nothing without --apply, and even then refuses any group carrying user data. It also
 * backfills releases.status as it goes, which makes the decision auditable and lets a later run skip
 * work already verified.
 *
 *   npx tsx --env-file=.env.local scripts/audit-unofficial-rgs.ts --limit=50
 *   npx tsx --env-file=.env.local scripts/audit-unofficial-rgs.ts --min-rgs=20
 *   npx tsx --env-file=.env.local scripts/audit-unofficial-rgs.ts --apply
 */
import * as fs from 'node:fs';
import { getDB, type DB } from './itunes-ingest-core';
import { browseArtistReleasesDetailed } from './mb-client';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit') ?? Infinity);
const MIN_RGS = Number(arg('--min-rgs') ?? 1);
const OUT = arg('--out') ?? 'scripts/data/unofficial-rgs.json';
// SEPARATE STATE PER MODE. saveDone() runs whether or not --apply was passed, so a shared file let a
// report-only run mark artists done and the subsequent --apply silently skip exactly the artists you
// had just reviewed -- the run would look clean because it never examined them. backfill-rg-covers-caa
// splits its state the same way for the same reason.
const STATE = APPLY ? 'scripts/data/unofficial-rgs-state.json' : 'scripts/data/unofficial-rgs-state.report.json';

interface Finding {
  artist: string; artistId: string; rgId: string; mbid: string; title: string;
  type: string; statuses: string[]; ratings: number;
}

// Read-only SQL through the Management API, for the aggregate questions PostgREST can only answer
// with one request per row.
// RETRIED, because this is called once per artist across a run that takes tens of minutes at
// MusicBrainz's 1 req/sec, and a single transient blip used to destroy the whole thing: the
// 2026-09-22 rerun died on `ConnectTimeoutError: api.supabase.com:443` at artist ~50 of 220, after
// ~20 minutes of MusicBrainz budget, and left the previous run's report in place — so the findings
// file looked fresh while describing a superseded run.
async function sql<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });
      // 4xx is a bad query and will fail identically on every retry; only 5xx is worth repeating.
      if (!res.ok) {
        const body = await res.text();
        if (res.status < 500) throw new Error(`query failed: ${res.status} ${body}`);
        lastErr = new Error(`query failed: ${res.status} ${body}`);
        continue;
      }
      return (await res.json()) as T[];
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message.startsWith('query failed: 4')) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function loadDone(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done as string[]); } catch { return new Set(); }
}
function saveDone(s: Set<string>) { fs.writeFileSync(STATE, JSON.stringify({ done: [...s] })); }

/**
 * Delete exactly the findings of a report that was already reviewed.
 *
 * WHY NOT JUST RE-RUN WITH --apply. Because that re-derives the set from MusicBrainz, so what gets
 * deleted is not necessarily what was read: the catalogue moves, MusicBrainz edits land, and a
 * truncated listing or a 503 in the second pass silently changes the answer. Reviewing report A and
 * deleting set B is not review at all. It also costs a second full pass at 1 req/sec while the
 * ingest pipeline sits paused for it.
 *
 * Re-checks ratings at delete time rather than trusting the report's count, because a rating can be
 * added between the report and the apply and a rating is the one thing here that cannot be undone.
 */
async function applyFromReport(file: string) {
  const db = getDB();
  const findings: Finding[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = findings.map(f => f.rgId);
  console.log(`[apply-report] ${findings.length} finding(s) from ${file}`);

  const ratedNow = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await sql<{ release_group_id: string }>(
      `select distinct release_group_id::text from ratings
        where release_group_id in (${ids.slice(i, i + 200).map(x => `'${x}'`).join(',')})`);
    for (const r of rows) ratedNow.add(r.release_group_id);
  }

  const deletable = findings.filter(f => !ratedNow.has(f.rgId));
  console.log(`  carrying ratings, kept: ${findings.length - deletable.length}`);

  let deleted = 0;
  const delIds = deletable.map(f => f.rgId);
  for (let i = 0; i < delIds.length; i += 100) {
    const slice = delIds.slice(i, i + 100);
    const { error } = await db.from('release_groups').delete().in('id', slice);
    if (error) console.warn(`  ! batch ${i}: ${error.message}`); else deleted += slice.length;
    if ((i / 100) % 5 === 0) console.log(`  ${Math.min(i + 100, delIds.length)}/${delIds.length} deleted`);
  }
  console.log(`\n  DELETED ${deleted} release group(s)`);
}

async function main() {
  const fromReport = arg('--from-report');
  if (fromReport) return applyFromReport(fromReport);
  const db = getDB();
  const done = loadDone();

  // Artists worth checking, biggest catalogues first -- that is where bootlegs concentrate and
  // where a wrong album is most visible.
  //
  // ONE AGGREGATE, NOT N COUNTS. This used to page every tracks_done artist through PostgREST and
  // then fire a separate head-count per artist to learn their release-group total: 36,585 HTTP
  // round-trips before the script could print its first line, purely to decide which handful to
  // look at. It never got that far -- run alongside the ingest pipeline it simply sat there, and
  // both jobs suffered, because the two also share MusicBrainz's 1 req/sec-per-IP budget. Grouping
  // in SQL answers the same question in one query, and --min-rgs/--limit are applied server-side so
  // only the rows actually wanted come back.
  const rankSql = `
    select a.id::text, a.name, x.external_id as mbid, count(rg.id) as n
      from artists a
      join artist_external_ids x
        on x.artist_id = a.id and x.source = 'musicbrainz'
      join release_groups rg on rg.primary_artist_id = a.id
     where a.ingest_state = 'tracks_done'
     group by 1, 2, 3
    having count(rg.id) >= ${Number.isFinite(MIN_RGS) ? MIN_RGS : 1}
     order by n desc
     ${Number.isFinite(LIMIT) ? `limit ${LIMIT + 5000}` : ''}`;
  const ranked = await sql<{ id: string; name: string; mbid: string; n: number }>(rankSql);

  // --limit is applied after the resume filter, so a resumed run advances instead of re-offering
  // the artists it already finished.
  let targets = ranked.filter(a => !done.has(a.id));
  if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);

  console.log(`[unofficial] ${targets.length} artist(s) to check${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  const findings: Finding[] = [];
  let checked = 0, deleted = 0, keptRated = 0, truncatedSkips = 0, unknownStatus = 0;

  for (const a of targets) {
    // TRUNCATION MAKES ABSENCE UNPROVABLE. This script deletes on the strength of "MusicBrainz
    // showed us every edition of this group and none was Official". When browseArtistReleases hits
    // MAX_RELEASE_PAGES that premise is false -- the official pressing may just be past the cap. On
    // the 12 largest catalogues here, 5 of 12 truncated, the worst at 1,530 of 3,563 editions, and
    // the findings skewed heavily to `compilation` precisely because /release?artist= returns every
    // compilation the artist is featured on. Skipping these artists costs coverage; not skipping
    // them costs real release groups. The artist is NOT marked done, so a later run with a higher
    // cap (or a per-release-group check) can still do them.
    let editions: any[];
    try {
      // 1,200 is under the lowest observed real cut-off (1,530 of 3,563), so anything above it
      // would truncate anyway -- bail on page 1 instead of paying 40 requests to learn that.
      const browsed = await browseArtistReleasesDetailed(a.mbid, { maxTotal: 1200 });
      if (browsed.truncated) {
        console.warn(`  ~ ${a.name}: listing truncated at ${browsed.seen}/${browsed.total} — skipped, cannot prove absence`);
        truncatedSkips++;
        continue;
      }
      editions = browsed.releases;
    } catch (e) { console.warn(`  ! ${a.name}: ${(e as Error).message}`); continue; }

    // rgId -> statuses of every edition MB knows for it
    const byRg = new Map<string, string[]>();
    for (const r of editions) {
      if (!r.rgId) continue;
      const l = byRg.get(r.rgId); const st = r.status ?? 'null';
      if (l) l.push(st); else byRg.set(r.rgId, [st]);
    }

    // Our rows for this artist, paged -- a prolific artist can hold well over the 1,000 PostgREST
    // returns in one go, and silently seeing only the first page would under-report.
    const ours: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('release_groups')
        .select('id, title, release_group_type, mb_release_group_id')
        .eq('primary_artist_id', a.id).not('mb_release_group_id', 'is', null)
        .order('id').range(from, from + 999);
      if (error) { console.warn(`  ! ${a.name} rgs: ${error.message}`); break; }
      if (!data?.length) break;
      ours.push(...data);
      if (data.length < 1000) break;
    }

    // Which of this artist's groups carry ratings -- one query, not one per candidate. A rating is
    // the thing this script must never destroy, so it is worth knowing up front for all of them.
    const rated = new Set<string>(
      (await sql<{ release_group_id: string }>(
        `select distinct r.release_group_id::text
           from ratings r join release_groups rg on rg.id = r.release_group_id
          where rg.primary_artist_id = '${a.id}'`)).map(r => r.release_group_id));

    for (const rg of ours) {
      const st = byRg.get(rg.mb_release_group_id);
      // No editions returned => MB told us nothing, not that it is unofficial. Leave it alone.
      if (!st || st.length === 0) continue;
      if (st.some(s => s === 'Official')) continue;

      // ABSENT STATUS IS NOT AN UNOFFICIAL STATUS. MusicBrainz leaves `status` unset on a great many
      // releases -- browseArtistReleases records that as the string 'null' -- and "nobody has filled
      // this field in" says nothing about whether the release is official. Treating it as
      // not-Official made 1,606 of 4,096 findings (39%) deletable on no evidence at all, almost all
      // of them old compilations: half of Bing Crosby's catalogue came back as "unofficial" purely
      // because 1940s compilations are poorly statused. The releases_status migration says this in
      // its own comment -- "NULL = not yet known, which is NOT the same as Official" -- and the
      // check then did the opposite. Require at least one edition with a REAL unofficial status.
      const known = st.filter(s => s !== 'null');
      if (known.length === 0) { unknownStatus++; continue; }

      const ratings = rated.has(rg.id) ? 1 : 0;
      const f: Finding = {
        artist: a.name, artistId: a.id, rgId: rg.id, mbid: rg.mb_release_group_id,
        title: rg.title, type: rg.release_group_type, statuses: [...new Set(known)], ratings,
      };
      findings.push(f);

      if (APPLY) {
        if (ratings > 0) { keptRated++; continue; }   // never destroy a user's rating
        const { error } = await db.from('release_groups').delete().eq('id', rg.id);
        if (error) console.warn(`  ! delete ${rg.title}: ${error.message}`); else deleted++;
      }
    }
    checked++;
    done.add(a.id);
    if (checked % 25 === 0) {
      saveDone(done);
      console.log(`  ${checked}/${targets.length}  found=${findings.length}${APPLY ? ` deleted=${deleted} kept-rated=${keptRated}` : ''}`);
    }
  }
  saveDone(done);
  fs.writeFileSync(OUT, JSON.stringify(findings, null, 2));

  const byType: Record<string, number> = {};
  for (const f of findings) byType[f.type] = (byType[f.type] ?? 0) + 1;
  console.log(`\n  artists checked        ${checked}`);
  console.log(`  unofficial-only groups ${findings.length}`);
  console.log(`  skipped (status unset) ${unknownStatus}  — MusicBrainz records no status; unknown is not unofficial`);
  console.log(`  skipped (truncated)    ${truncatedSkips}  — absence unprovable, left for a later pass`);
  console.log(`  by type                ${JSON.stringify(byType)}`);
  console.log(`  carrying user ratings  ${findings.filter(f => f.ratings > 0).length}  (never deleted)`);
  if (APPLY) console.log(`  DELETED                ${deleted}`);
  console.log(`\n  report → ${OUT}`);
  if (!APPLY) console.log('  report only — re-run with --apply to delete (rated groups are still skipped)');
}

if (process.argv[1] && process.argv[1].endsWith('audit-unofficial-rgs.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
