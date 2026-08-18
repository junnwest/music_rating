/**
 * NEW RELEASES sweep — keep the WHOLE catalog current, not a famous subset.
 *
 * The problem this solves: the FRESHNESS lane asks MusicBrainz "does this artist have anything
 * new?" once per artist. That costs ~3 MB requests each (getArtist + browseReleaseGroups +
 * browseArtistReleases), so covering all ~67.5k catalog artists is ~200k requests ≈ 2.3 DAYS of
 * solid MB time at the hard ~1 req/s limit — per cycle, forever. New releases were therefore
 * always weeks stale, and no amount of tier tuning fixes that; it's a throughput ceiling.
 *
 * Invert the question. Instead of 67.5k per-artist polls, ask MB ONCE per date window: "what came
 * out since X?" MB indexes `firstreleasedate` on release-group search, and the result carries the
 * credited artist MBIDs directly. Measured 2026-08-10: ~340 new release groups/day worldwide, so a
 * 75-day window is ~25k groups ≈ 255 paged requests ≈ 4-5 minutes. That is ~3,000× less MB time
 * than the per-artist sweep, and it covers EVERY artist we own rather than a prioritised slice.
 *
 * This script does NOT ingest. It only flags: any catalog artist credited on a release group in
 * the window gets `next_check_at = now()`, so the existing (idempotent, well-tested) FRESHNESS
 * re-poll path picks them up on its next turn. So the expensive per-artist re-poll still happens —
 * but only for artists that demonstrably have something new, instead of blindly cycling 67.5k.
 *
 * Deliberately a WINDOW, not an incremental cursor. MB search can only filter on the release DATE,
 * not on when the row was added, and editors routinely add back-dated releases weeks late. A
 * cursor that advanced to "last swept" would permanently miss those. Re-sweeping a wide overlapping
 * window every run costs minutes and is immune to it. LOOKAHEAD covers announced future dates.
 *
 * Artists NOT already in the catalog are counted and reported but never queued — this lane is
 * freshness, not expansion (that's DISCOVER/AREA's job).
 *
 *   npx tsx --env-file=.env.local scripts/discover-mb-newreleases.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-mb-newreleases.ts --lookback=45
 *   npx tsx --env-file=.env.local scripts/discover-mb-newreleases.ts --since=2026-07-01 --until=2026-08-10
 */
import { getDB, type DB } from './itunes-ingest-core';
import { searchReleaseGroupsByQuery } from './mb-client';

export interface NewReleasesOpts {
  since?: string | null;      // ISO date (YYYY-MM-DD); defaults to today - lookbackDays
  until?: string | null;      // ISO date; defaults to today + lookaheadDays
  lookbackDays?: number;      // default 45
  lookaheadDays?: number;     // default 30 (announced-but-unreleased)
  maxPages?: number;          // hard backstop against an unexpectedly huge window
  dryRun?: boolean;
  log?: (m: string) => void;
}
export interface NewReleasesResult {
  query: string;
  groups: number;          // release groups seen in the window
  artistsSeen: number;     // distinct credited artist MBIDs
  artistsOwned: number;    // …of which we have in the catalog
  flagged: number;         // …of which we actually moved next_check_at forward
  unowned: number;         // credited artists we don't have (expansion candidates — NOT queued)
  truncated: boolean;      // hit maxPages before exhausting the window
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Sweep MB for release groups in a date window and flag the catalog artists credited on them for
 * a freshness re-poll. ONE implementation shared by the CLI and the pipeline `newreleases` lane.
 * Throws on a real DB error (never process.exit) so the lane supervisor can react.
 */
export async function discoverNewReleases(db: DB, o: NewReleasesOpts = {}): Promise<NewReleasesResult> {
  const log = o.log ?? (() => {});
  const now = new Date();
  const since = o.since ?? isoDay(new Date(now.getTime() - (o.lookbackDays ?? 45) * 86_400_000));
  const until = o.until ?? isoDay(new Date(now.getTime() + (o.lookaheadDays ?? 30) * 86_400_000));
  const maxPages = o.maxPages ?? 600; // 60k groups — far above any real window
  const query = `firstreleasedate:[${since} TO ${until}]`;

  // ── 1. page MB, collecting credited artist MBIDs ──────────────────────────────
  const artistMbids = new Set<string>();
  let groups = 0, truncated = false;
  const PER = 100;
  for (let page = 0; ; page++) {
    if (page >= maxPages) { truncated = true; log(`hit maxPages=${maxPages} — window truncated`); break; }
    const res = await searchReleaseGroupsByQuery(query, PER, page * PER);
    if (!res.groups.length) break;
    groups += res.groups.length;
    for (const g of res.groups) for (const id of g.artistMbids) artistMbids.add(id);
    if (page === 0) log(`window ${since} → ${until}: ${res.count} release groups (~${Math.ceil(res.count / PER)} pages)`);
    if (page % 25 === 0 && page > 0) log(`  fetched ${groups}/${res.count} groups (${artistMbids.size} distinct artists)`);
    if (page * PER + res.groups.length >= res.count) break;
  }
  log(`swept ${groups} release group(s) → ${artistMbids.size} distinct credited artist(s)`);

  // ── 2. intersect with the catalog (MBID, so no name resolution) ───────────────
  const all = [...artistMbids];
  const owned = new Map<string, string>(); // mb artist mbid → our artists.id
  for (let i = 0; i < all.length; i += 100) {
    const { data, error } = await db.from('artist_external_ids')
      .select('artist_id, external_id').eq('source', 'musicbrainz').in('external_id', all.slice(i, i + 100));
    if (error) throw new Error(`catalog intersect batch ${i}: ${error.message}`);
    for (const r of (data ?? []) as { artist_id: string; external_id: string }[]) owned.set(r.external_id, r.artist_id);
  }
  const unowned = all.length - owned.size;
  log(`${owned.size} already in the catalog · ${unowned} not ours (expansion candidates — not queued here)`);

  if (o.dryRun) {
    log(`[DRY RUN] would flag up to ${owned.size} artist(s) for a freshness re-poll`);
    return { query, groups, artistsSeen: all.length, artistsOwned: owned.size, flagged: 0, unowned, truncated };
  }

  // ── 3. flag them due NOW so FRESHNESS re-polls them next ──────────────────────
  // Only artists that finished ingesting (tracks_done) are eligible — anything earlier in the
  // state machine is already headed through the normal ingest path. Only move next_check_at
  // BACKWARD (i.e. when it's in the future): an artist already overdue keeps its earlier slot,
  // so repeat sweeps can't shuffle the queue or starve a long-overdue artist.
  const ids = [...owned.values()];
  const dueAt = new Date().toISOString();
  let flagged = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data, error } = await db.from('artists')
      .update({ next_check_at: dueAt })
      .in('id', slice)
      .eq('ingest_state', 'tracks_done')
      .gt('next_check_at', dueAt)
      .select('id');
    if (error) throw new Error(`flag batch ${i}: ${error.message}`);
    flagged += (data ?? []).length;
  }
  log(`flagged ${flagged} artist(s) due now (${owned.size - flagged} already due or not tracks_done)`);

  return { query, groups, artistsSeen: all.length, artistsOwned: owned.size, flagged, unowned, truncated };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const num = (f: string) => (arg(f) ? parseInt(arg(f)!, 10) : undefined);
  const db = getDB();
  const r = await discoverNewReleases(db, {
    since: arg('--since') ?? null,
    until: arg('--until') ?? null,
    lookbackDays: num('--lookback'),
    lookaheadDays: num('--lookahead'),
    maxPages: num('--max-pages'),
    dryRun: args.includes('--dry-run'),
    log: (m) => console.log('[newreleases] ' + m),
  });
  console.log(`\n  query      ${r.query}`);
  console.log(`  groups     ${r.groups}${r.truncated ? ' (TRUNCATED — raise --max-pages)' : ''}`);
  console.log(`  artists    ${r.artistsSeen} seen · ${r.artistsOwned} ours · ${r.unowned} not ours`);
  console.log(`  flagged    ${r.flagged} due now for a freshness re-poll\n`);
}

// Only run the CLI when invoked directly (not when the pipeline lane imports discoverNewReleases).
if (process.argv[1]?.endsWith('discover-mb-newreleases.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
