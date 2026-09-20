/**
 * Detection lane for the Instagram "out now" pipeline — finds new releases from
 * artists on the ig_famous_artists watchlist.
 *
 * Modeled directly on discover-mb-newreleases.ts's core technique (ask MusicBrainz
 * ONCE per date window "what came out since X?" instead of polling per-artist —
 * ~1 request per 100 release groups vs. ~3 requests PER ARTIST), but intersects
 * the credited-artist MBIDs against ig_famous_artists instead of the owned rating
 * catalog. Famous artists are the easy case for MB freshness: entries for major
 * releases are typically added same-day by one of many editors watching that
 * artist, unlike the underground-catalog lag this technique was built to bridge.
 *
 * Deliberately a re-swept WINDOW, not an incremental cursor — MB search can only
 * filter on the release DATE, not on when the row was added, and editors add
 * back-dated releases late. The (famous_artist_id, release_group_mbid) unique
 * index on ig_detected_releases is what actually prevents duplicate inserts
 * across repeated overlapping sweeps.
 *
 *   npx tsx --env-file=.env.local scripts/discover-ig-newreleases.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-ig-newreleases.ts --ingest
 *   npx tsx --env-file=.env.local scripts/discover-ig-newreleases.ts --ingest --lookback=7
 *
 * DEFAULT IS REPORT-ONLY. Writing requires the explicit --ingest flag.
 */
import { getDB, type DB } from './itunes-ingest-core';
import { searchReleaseGroupsByQuery } from './mb-client';

export interface IgNewReleasesOpts {
  since?: string | null;
  until?: string | null;
  lookbackDays?: number;   // default 14 — tighter than the catalog lane's 45, since famous-artist
                            // MB entries land fast; widen if you suspect a miss.
  lookaheadDays?: number;  // default 14 (announced-but-unreleased)
  maxPages?: number;
  dryRun?: boolean;
  log?: (m: string) => void;
}
export interface IgNewReleasesResult {
  query: string;
  groups: number;
  famousHits: number;   // release groups credited to a watchlist artist
  inserted: number;     // new ig_detected_releases rows actually written
  truncated: boolean;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function discoverIgNewReleases(db: DB, o: IgNewReleasesOpts = {}): Promise<IgNewReleasesResult> {
  const log = o.log ?? (() => {});
  const now = new Date();
  const since = o.since ?? isoDay(new Date(now.getTime() - (o.lookbackDays ?? 14) * 86_400_000));
  const until = o.until ?? isoDay(new Date(now.getTime() + (o.lookaheadDays ?? 14) * 86_400_000));
  const maxPages = o.maxPages ?? 600;
  const query = `firstreleasedate:[${since} TO ${until}]`;

  // ── 1. load the watchlist (mbid -> row id) ────────────────────────────────
  const { data: watchlist, error: wErr } = await db
    .from('ig_famous_artists').select('id, mbid').eq('active', true).not('mbid', 'is', null);
  if (wErr) throw new Error(`watchlist load: ${wErr.message}`);
  const byMbid = new Map<string, string>((watchlist ?? []).map((a: any) => [a.mbid as string, a.id as string]));
  if (byMbid.size === 0) { log('watchlist has no resolved MBIDs yet — run resolve-famous-artists.ts --write first'); }

  // ── 2. page MB, collecting release groups credited to a watchlist artist ──
  type Hit = { famousArtistId: string; mbid: string; title: string; artistCredit: string; primaryType: string | null; date: string | null };
  const hits: Hit[] = [];
  let groups = 0, truncated = false;
  const PER = 100;
  for (let page = 0; ; page++) {
    if (page >= maxPages) { truncated = true; log(`hit maxPages=${maxPages} — window truncated`); break; }
    const res = await searchReleaseGroupsByQuery(query, PER, page * PER);
    if (!res.groups.length) break;
    groups += res.groups.length;
    for (const g of res.groups) {
      for (const mbid of g.artistMbids) {
        const famousArtistId = byMbid.get(mbid);
        if (famousArtistId) {
          hits.push({ famousArtistId, mbid: g.id, title: g.title, artistCredit: g.artistCredit, primaryType: g.primaryType, date: g.firstReleaseDate });
          break; // one hit per group is enough even if 2 watchlist artists are co-credited
        }
      }
    }
    if (page === 0) log(`window ${since} → ${until}: ${res.count} release groups (~${Math.ceil(res.count / PER)} pages)`);
    if (page * PER + res.groups.length >= res.count) break;
  }
  log(`swept ${groups} release group(s) → ${hits.length} credited to a watchlist artist`);

  if (o.dryRun) {
    for (const h of hits) log(`  [would insert] ${h.date ?? '?'}  ${h.artistCredit} — ${h.title} (${h.primaryType ?? '?'})`);
    return { query, groups, famousHits: hits.length, inserted: 0, truncated };
  }

  // ── 3. upsert, relying on the (famous_artist_id, release_group_mbid) unique
  //        index to no-op repeat sightings across overlapping sweeps ──────────
  let inserted = 0;
  for (const h of hits) {
    const { data, error } = await db.from('ig_detected_releases').upsert(
      {
        famous_artist_id: h.famousArtistId, release_group_mbid: h.mbid, title: h.title,
        artist_credit: h.artistCredit, primary_type: h.primaryType, release_date: h.date,
      },
      { onConflict: 'famous_artist_id,release_group_mbid', ignoreDuplicates: true },
    ).select('id');
    if (error) throw new Error(`insert ${h.mbid}: ${error.message}`);
    if (data && data.length > 0) { inserted++; log(`  + ${h.date ?? '?'}  ${h.artistCredit} — ${h.title}`); }
  }
  log(`inserted ${inserted} new release(s) (${hits.length - inserted} already known)`);

  return { query, groups, famousHits: hits.length, inserted, truncated };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const num = (f: string) => (arg(f) ? parseInt(arg(f)!, 10) : undefined);
  const db = getDB();
  const r = await discoverIgNewReleases(db, {
    since: arg('--since') ?? null,
    until: arg('--until') ?? null,
    lookbackDays: num('--lookback'),
    lookaheadDays: num('--lookahead'),
    maxPages: num('--max-pages'),
    dryRun: !args.includes('--ingest'),
    log: (m) => console.log('[ig-newreleases] ' + m),
  });
  console.log(`\n  query      ${r.query}`);
  console.log(`  groups     ${r.groups}${r.truncated ? ' (TRUNCATED — raise --max-pages)' : ''}`);
  console.log(`  famous     ${r.famousHits} hit(s) on the watchlist · ${r.inserted} newly inserted`);
  if (!args.includes('--ingest')) console.log(`\n  REPORT-ONLY — re-run with --ingest to write.`);
}

if (process.argv[1]?.endsWith('discover-ig-newreleases.ts')) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
