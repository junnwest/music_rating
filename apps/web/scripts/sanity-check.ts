/**
 * Pipeline sanity checks — verifies data integrity after each pipeline step.
 *
 * Checks:
 *   1. Overall catalog size + source breakdown
 *   2. queue:ingest   — releases have required fields, no invalid types, no bad dates
 *   3. backfill:genres — genre coverage and format
 *   4. backfill:native:releases — native name writes landed
 *   5. check:completeness — re-queued artists are now done
 *   6. Duplicate detection — same title+artist, multiple itunes_ids
 *   7. Data quality — null covers, bad dates, release_type distribution
 *   8. Queue state — pending / done / failed / skipped breakdown
 *
 * Run:
 *   npm run sanity
 */

import { createClient } from '@supabase/supabase-js';

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

type DB = ReturnType<typeof getDB>;

const PASS = '  ✅';
const FAIL = '  ❌';
const WARN = '  ⚠️ ';
const INFO = '  ℹ️ ';

function fmt(n: number | null) { return (n ?? 0).toLocaleString(); }

async function countWhere(db: DB, table: string, filters: Record<string, any> = {}): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) q = (q as any).is(k, null);
    else if (typeof v === 'object' && v.__not_null) q = (q as any).not(k, 'is', null);
    else q = (q as any).eq(k, v);
  }
  const { count } = await q;
  return count ?? 0;
}

const NOT_NULL = { __not_null: true };

async function main() {
  const db = getDB();
  console.log('\n  sillajuku pipeline sanity check\n');
  console.log('  ' + '─'.repeat(56));

  // ── 1. Catalog overview ──────────────────────────────────────────────────────

  console.log('\n  [1] Catalog overview\n');

  const totalReleases = await countWhere(db, 'releases');
  const spotifyReleases = await countWhere(db, 'releases', { canonical_source: 'spotify' });
  const itunesReleases  = await countWhere(db, 'releases', { canonical_source: 'itunes' });
  const nullSource      = await countWhere(db, 'releases', { canonical_source: null });
  const totalArtists    = await countWhere(db, 'artists');
  const totalRatings    = await countWhere(db, 'ratings');

  console.log(`${INFO} Total releases : ${fmt(totalReleases)}`);
  console.log(`${INFO}   Spotify-sourced : ${fmt(spotifyReleases)}`);
  console.log(`${INFO}   iTunes-sourced  : ${fmt(itunesReleases)}`);
  console.log(`${INFO}   Unknown source  : ${fmt(nullSource)}`);
  console.log(`${INFO} Total artists   : ${fmt(totalArtists)}`);
  console.log(`${INFO} Total ratings   : ${fmt(totalRatings)}`);

  // ── 2. queue:ingest — required fields ───────────────────────────────────────

  console.log('\n  [2] queue:ingest — required fields\n');

  const nullTitle    = await countWhere(db, 'releases', { title: null });
  const nullArtist   = await countWhere(db, 'releases', { artist: null });
  const nullType     = await countWhere(db, 'releases', { release_type: null });
  const nullDate     = await countWhere(db, 'releases', { release_date: null });
  const nullCover    = await countWhere(db, 'releases', { cover_url: null });
  const nullItunesId = await countWhere(db, 'releases', { itunes_id: null });
  const hasItunesId  = totalReleases - nullItunesId;

  console.log(nullTitle  === 0 ? `${PASS} No null titles` : `${FAIL} ${fmt(nullTitle)} releases with null title`);
  console.log(nullArtist === 0 ? `${PASS} No null artists` : `${FAIL} ${fmt(nullArtist)} releases with null artist`);
  console.log(nullType   === 0 ? `${PASS} No null release_type` : `${WARN} ${fmt(nullType)} releases with null release_type`);
  console.log(`${INFO} ${fmt(hasItunesId)} / ${fmt(totalReleases)} releases have itunes_id (${Math.round(hasItunesId / totalReleases * 100)}%)`);
  console.log(`${INFO} ${fmt(nullCover)} releases without cover_url`);
  console.log(`${INFO} ${fmt(nullDate)} releases without release_date`);

  // ── 3. Release type distribution ────────────────────────────────────────────

  console.log('\n  [3] Release type distribution\n');

  const validTypes = ['Album', 'EP', 'Single', 'Live', 'Compilation'];
  const typeCounts: Record<string, number> = {};
  for (const type of validTypes) {
    typeCounts[type] = await countWhere(db, 'releases', { release_type: type });
  }
  // Check for any invalid types by subtracting known valid counts from total
  const knownTotal = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  const unknownTypes = totalReleases - nullType - knownTotal;

  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`${INFO} ${type.padEnd(15)} ${fmt(count)}`);
  }
  if (unknownTypes > 0) console.log(`${FAIL} ${fmt(unknownTypes)} releases have unrecognized release_type`);
  else console.log(`${PASS} All release_types are valid`);

  // ── 4. Date format check ─────────────────────────────────────────────────────

  console.log('\n  [4] Date format\n');

  const { data: sampleDates } = await db
    .from('releases')
    .select('release_date')
    .not('release_date', 'is', null)
    .limit(2000);

  if (sampleDates) {
    const badDates = sampleDates.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.release_date));
    console.log(badDates.length === 0
      ? `${PASS} All sampled dates are YYYY-MM-DD format`
      : `${FAIL} ${badDates.length} bad date formats in sample: ${badDates.slice(0, 3).map(r => r.release_date).join(', ')}`);
  }

  // ── 5. backfill:genres — coverage ───────────────────────────────────────────

  console.log('\n  [5] backfill:genres — coverage\n');

  const nullGenre  = await countWhere(db, 'releases', { genres: null });
  const hasGenre   = totalReleases - nullGenre;
  const genrePct   = Math.round(hasGenre / totalReleases * 100);

  console.log(`${INFO} ${fmt(hasGenre)} / ${fmt(totalReleases)} releases have genres (${genrePct}%)`);
  console.log(nullGenre === 0 ? `${PASS} Full genre coverage` : `${WARN} ${fmt(nullGenre)} releases still have null genre`);

  // Check for mixed-case genres (should all be lowercase)
  const { data: genreSample } = await db
    .from('releases')
    .select('genres')
    .not('genres', 'is', null)
    .limit(2000);

  if (genreSample) {
    const mixedCase = genreSample.filter(r => r.genres !== r.genres.toLowerCase());
    console.log(mixedCase.length === 0
      ? `${PASS} All genres are lowercase`
      : `${FAIL} ${mixedCase.length} releases have mixed-case genres: ${mixedCase.slice(0, 2).map(r => r.genres).join(', ')}`);
  }

  // ── 6. backfill:native:releases — native name writes ────────────────────────

  console.log('\n  [6] backfill:native:releases — native name writes\n');

  const hasNativeTitle  = await countWhere(db, 'releases', { title_native: NOT_NULL });
  const hasNativeArtist = await countWhere(db, 'releases', { artist_native: NOT_NULL });
  const hasNativeLang   = await countWhere(db, 'releases', { native_language: NOT_NULL });

  console.log(`${INFO} ${fmt(hasNativeTitle)} releases with title_native`);
  console.log(`${INFO} ${fmt(hasNativeArtist)} releases with artist_native`);
  console.log(`${INFO} ${fmt(hasNativeLang)} releases with native_language`);

  // Spot-check: Haruomi Hosono releases should have ja native titles (the 6 hits)
  const { data: hosonoCheck } = await db
    .from('releases')
    .select('title, title_native, native_language')
    .ilike('artist', 'Haruomi Hosono')
    .not('title_native', 'is', null);

  console.log(hosonoCheck && hosonoCheck.length > 0
    ? `${PASS} Hosono spot-check: ${hosonoCheck.length} releases have native titles (e.g. "${hosonoCheck[0].title_native}")`
    : `${WARN} Hosono spot-check: no native titles found — backfill may not have landed`);

  // ── 7. Duplicate detection ───────────────────────────────────────────────────

  console.log('\n  [7] Duplicate detection\n');

  // Paginate through all itunes_ids to detect duplicates
  const allItunesIds: string[] = [];
  {
    let from = 0;
    while (true) {
      const { data } = await db
        .from('releases')
        .select('itunes_id')
        .not('itunes_id', 'is', null)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      allItunesIds.push(...data.map((r: any) => String(r.itunes_id)));
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  {
    const seen = new Map<string, number>();
    for (const id of allItunesIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    const dups = [...seen.entries()].filter(([, c]) => c > 1);
    console.log(dups.length === 0
      ? `${PASS} No duplicate itunes_ids`
      : `${FAIL} ${dups.length} duplicate itunes_ids: ${dups.slice(0, 3).map(([id, c]) => `${id}(×${c})`).join(', ')}`);
  }

  // ── 8. check:completeness — re-queued artists are done ──────────────────────

  console.log('\n  [8] check:completeness — queue state\n');

  for (const status of ['done', 'pending', 'processing', 'skipped', 'failed']) {
    const c = await countWhere(db, 'artist_ingestion_queue', { status });
    if (c === 0) continue;
    const icon = status === 'failed' ? FAIL : status === 'pending' ? WARN : INFO;
    console.log(`${icon} ${status.padEnd(12)} ${fmt(c)}`);
  }
  const failed = await countWhere(db, 'artist_ingestion_queue', { status: 'failed' });
  console.log(failed === 0 ? `${PASS} No failed queue entries` : `${FAIL} ${fmt(failed)} failed queue entries — check errors`);

  // ── 9. Artist coverage ───────────────────────────────────────────────────────

  console.log('\n  [9] Artist coverage\n');

  const artistsWithItunes   = await countWhere(db, 'artists', { itunes_artist_id: NOT_NULL });
  const artistsWithNative   = await countWhere(db, 'artists', { name_native: NOT_NULL });
  const artistsWithNativeLang = await countWhere(db, 'artists', { native_language: NOT_NULL });

  console.log(`${INFO} ${fmt(artistsWithItunes)} / ${fmt(totalArtists)} artists have itunes_artist_id`);
  console.log(`${INFO} ${fmt(artistsWithNative)} / ${fmt(totalArtists)} artists have name_native`);
  console.log(`${INFO} ${fmt(artistsWithNativeLang)} / ${fmt(totalArtists)} artists have native_language`);

  // ── 10. Cover URL sanity ──────────────────────────────────────────────────────

  console.log('\n  [10] Cover URL sanity\n');

  const { data: coverSample } = await db
    .from('releases')
    .select('cover_url')
    .not('cover_url', 'is', null)
    .limit(500);

  if (coverSample) {
    const notHttps    = coverSample.filter(r => !r.cover_url.startsWith('https://'));
    const notUpscaled = coverSample.filter(r =>
      r.cover_url.includes('100x100') || r.cover_url.includes('100bb')
    );
    console.log(notHttps.length === 0
      ? `${PASS} All sampled cover URLs are HTTPS`
      : `${FAIL} ${notHttps.length} cover URLs are not HTTPS`);
    console.log(notUpscaled.length === 0
      ? `${PASS} All sampled covers are upscaled (not 100px thumbnails)`
      : `${WARN} ${notUpscaled.length} covers still at 100px (not upscaled)`);
  }

  console.log('\n  ' + '─'.repeat(56));
  console.log('  Sanity check complete.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
