/**
 * One-off cleanup: remove bonus-DVD video tracks (music videos, "Dance Shot" clips,
 * making-ofs, interviews...) that got ingested into release_tracks/recordings as if
 * they were songs, before mb-client.ts's parseMedia() started filtering MusicBrainz's
 * `recording.video` flag (see the StarRingChild EP investigation — same recording
 * showing up twice in a tracklist, once as the real song, once as its bonus DVD PV).
 *
 * For every MB-sourced release that currently has a release_tracks row on disc_number
 * > 1 (video content is essentially never on disc 1 — confirmed by sampling), re-fetch
 * the release from MusicBrainz and diff: any currently-stored recording that's no longer
 * in MB's audio-only list gets flagged.
 *
 * Flagged rows are then CLASSIFIED, because "absent from MB's audio list" has more than one
 * cause and only one of them is a bug:
 *   • video — MB positively flags the recording `video: true`. The bonus-DVD music video
 *             ingested as a song. This is the bug; deleted by --write.
 *   • gone  — absent from MB entirely for some other reason: a recording MB merged away, or a
 *             release an editor re-tracked since our ingest. That's real audio that MOVED, so
 *             deleting it is a data judgment, not a bug fix. Reported and LEFT ALONE unless
 *             you explicitly pass --include-gone.
 * The same MB response yields both lists, so classifying costs no extra requests.
 *
 * Deleted release_tracks rows take their recording with them (and any track_ratings on it) IF
 * no other release_tracks row references it. releases.total_tracks is corrected on any touched
 * release. Every classified row is written to a JSON report (--report <path>) so a later pass
 * over the `gone` class doesn't have to repeat the ~10h MB re-fetch.
 *
 * Rate-limited by mb-client's shared <=1req/s MusicBrainz limiter — this is a slow,
 * long-running scan (tens of thousands of releases). Resumable: pass --start-after
 * <release-id> (releases are processed in id order) to pick back up after a stop.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts                        # dry-run (report)
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --write                 # delete the `video` class only
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --write --include-gone  # also delete `gone` (review first!)
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --write --start-after <release-id>
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --limit 200             # cap releases processed (testing)
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --only <release-id>     # spot-check one release, skips the full scan
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --report path/to.json   # where to write the classified report
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDB } from './itunes-ingest-core';
import { getReleaseTracksSplitOrNull } from './mb-client';

const WRITE = process.argv.includes('--write');
// Every flagged row is "stored here, absent from MB's audio list" — but that has more than one
// cause, and only one of them is this tool's job:
//   video — MB positively flags the recording `video: true`. A bonus-DVD music video / making-of
//           ingested as a song. Safe to delete; this is the bug we're fixing.
//   gone  — absent from MB entirely, video or not. Could be a recording MB merged away, or a
//           release an editor re-tracked since our ingest. That's REAL AUDIO that moved, not a
//           fake song, so deleting it is a data judgment rather than a bug fix.
// Default: delete `video` only, and REPORT `gone` for human review. --include-gone opts into the
// old indiscriminate behaviour.
const INCLUDE_GONE = process.argv.includes('--include-gone');
const startAfterIdx = process.argv.indexOf('--start-after');
const START_AFTER: string | null = startAfterIdx >= 0 ? process.argv[startAfterIdx + 1] : null;
const limitIdx = process.argv.indexOf('--limit');
const LIMIT: number | null = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : null;
const onlyIdx = process.argv.indexOf('--only');
const ONLY: string | null = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
const reportIdx = process.argv.indexOf('--report');
const REPORT: string | null = reportIdx >= 0 ? process.argv[reportIdx + 1] : null;


// Fetch the full candidate list (distinct MB-sourced releases that have a disc>1
// track, with an mb_release_id) in one server-side query via the Supabase
// Management API — the same path scripts/db-exec.ts uses. PostgREST's ~8s
// statement timeout can't run this DISTINCT scan (~35s), and client-side OFFSET
// pagination over ~849k release_tracks rows times out at deep offsets. Requires
// SUPABASE_ACCESS_TOKEN (a personal access token, sbp_…) in the environment.
async function fetchCandidatesViaManagementApi(): Promise<{ id: string; mb_release_id: string }[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN missing — required for candidate discovery (see scripts/db-exec.ts).');
  if (!ref) throw new Error('Could not derive Supabase project ref from NEXT_PUBLIC_SUPABASE_URL.');
  const query =
    'select distinct r.id, r.mb_release_id from releases r ' +
    'join release_tracks rt on rt.release_id = r.id ' +
    "where rt.disc_number > 1 and r.source = 'musicbrainz' and r.mb_release_id is not null " +
    'order by r.id';
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`candidate discovery query failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const rows = (await res.json()) as { id: string; mb_release_id: string }[];
  if (!Array.isArray(rows)) throw new Error(`candidate discovery: unexpected response ${JSON.stringify(rows).slice(0, 200)}`);
  return rows;
}

async function main() {
  const db = getDB();

  let candidates: { id: string; mb_release_id: string }[] = [];

  if (ONLY) {
    const { data, error } = await db
      .from('releases')
      .select('id, mb_release_id')
      .eq('id', ONLY)
      .single();
    if (error || !data?.mb_release_id) throw new Error(`--only ${ONLY}: not found or has no mb_release_id (${error?.message})`);
    candidates = [data as any];
    console.log(`--only mode: checking just ${ONLY}\n`);
    await checkAndMaybeFix(db, candidates);
    return;
  }

  // Candidate releases: MB-sourced, has an mb_release_id (so we can re-fetch), and has
  // at least one release_tracks row on a disc beyond the first (where video content
  // actually lives — confirmed empirically during the investigation).
  //
  // Fetched in ONE server-side query via the Management API. The previous approach
  // paginated ~849k release_tracks rows client-side with OFFSET; deep pages
  // (offset ~800k) reliably exceeded PostgREST's ~8s statement timeout and crashed
  // discovery before the run even started. The Management API tolerates the ~35s
  // DISTINCT scan, so one call replaces ~1000 fragile paginated queries.
  console.log('finding candidate releases (disc_number > 1, source=musicbrainz) via one server-side query…');
  candidates = await fetchCandidatesViaManagementApi();
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (START_AFTER) candidates = candidates.filter((c) => c.id > START_AFTER);
  if (LIMIT) candidates = candidates.slice(0, LIMIT);
  console.log(`  ${candidates.length} candidate MB releases to check${START_AFTER ? ` (resuming after ${START_AFTER})` : ''}${LIMIT ? ` (capped at --limit ${LIMIT})` : ''}`);
  console.log(`  at ~1.1s/release this will take ~${Math.round(candidates.length * 1.1 / 60)} min\n`);

  await checkAndMaybeFix(db, candidates);
}

async function checkAndMaybeFix(db: ReturnType<typeof getDB>, candidates: { id: string; mb_release_id: string }[]) {
  let releasesTouched = 0;
  let rowsFlagged = 0;
  let rowsVideo = 0, rowsGone = 0;   // the two classes (see INCLUDE_GONE above)
  let ratingsAtRisk = 0;             // ratings on rows we would actually DELETE
  let ratingsOnGone = 0;             // ratings on `gone` rows (left alone by default)
  let checked = 0;
  let skippedFetchFailed = 0; // MB re-fetch failed (throttle/network) — couldn't verify
  let skippedEmpty = 0;       // MB returned zero audio tracks — degenerate, don't nuke everything
  const flaggedExamples: any[] = [];
  // Full machine-readable record of every flagged row. The expensive part of this tool is the MB
  // re-fetch of all ~33.7k candidates (~10h); persisting the result means a later pass (e.g.
  // reviewing then deleting the `gone` class) can work from the file instead of re-scanning.
  const report: { release_id: string; mb_release_id: string; recording_id: string; title: string; cls: 'video' | 'gone' }[] = [];

  for (const rel of candidates) {
    checked++;
    if (checked % 100 === 0) {
      console.log(`  progress: ${checked}/${candidates.length} checked, ${rowsFlagged} bad rows (${rowsVideo} video, ${rowsGone} gone) (last id ${rel.id})`);
    }

    const split = await getReleaseTracksSplitOrNull(rel.mb_release_id);
    const corrected = split?.audio ?? null;
    // SAFETY: never diff against an unverified list. A null means the MB fetch
    // failed (exhausted 503 retries — common under throttling); an empty list
    // means MB parsed the release to zero audio tracks. In BOTH cases the diff
    // below would flag EVERY stored track as "bad" and delete real audio +
    // cascade user ratings. Skip the release instead — leaving it untouched is
    // always safe; the release stays a candidate for a future, unthrottled run.
    if (corrected === null) { skippedFetchFailed++; continue; }
    if (corrected.length === 0) { skippedEmpty++; continue; }
    const correctedMbids = new Set(corrected.map((t) => t.recordingId));
    // MB's own `video: true` set for this release — the positive evidence that separates
    // "fake song we ingested off a bonus DVD" from "real audio that merged/moved".
    const videoMbids = new Set((split?.video ?? []).map((t) => t.recordingId));

    const { data: currentRows, error: curErr } = await db
      .from('release_tracks')
      .select('release_id, disc_number, position, recording_id, recordings(id, mb_recording_id, title)')
      .eq('release_id', rel.id);
    if (curErr) { console.error(`  ${rel.id}: current-rows lookup failed: ${curErr.message}`); continue; }

    const bad = (currentRows ?? []).filter((r: any) => {
      const mbid = r.recordings?.mb_recording_id;
      return mbid && !correctedMbids.has(mbid);
    }) as any[];
    if (bad.length === 0) continue;

    // Classify every flagged row, then act only on the class we're authorised to delete.
    const video = bad.filter((b: any) => videoMbids.has(b.recordings?.mb_recording_id));
    const gone = bad.filter((b: any) => !videoMbids.has(b.recordings?.mb_recording_id));
    releasesTouched++;
    rowsFlagged += bad.length;
    rowsVideo += video.length;
    rowsGone += gone.length;
    for (const b of video) report.push({ release_id: rel.id, mb_release_id: rel.mb_release_id, recording_id: b.recording_id, title: b.recordings?.title ?? '', cls: 'video' });
    for (const b of gone) report.push({ release_id: rel.id, mb_release_id: rel.mb_release_id, recording_id: b.recording_id, title: b.recordings?.title ?? '', cls: 'gone' });
    if (flaggedExamples.length < 15) {
      flaggedExamples.push({
        release_id: rel.id,
        mb_release_id: rel.mb_release_id,
        video: video.map((b) => b.recordings?.title),
        gone: gone.map((b) => b.recordings?.title),
      });
    }

    // Only rows we would actually delete count as "at risk"; `gone` ratings are reported apart so
    // the two numbers can't be confused when deciding whether to opt into --include-gone.
    const deletable = INCLUDE_GONE ? bad : video;
    const badRecordingIds = deletable.map((b) => b.recording_id);
    if (gone.length) {
      const { count: goneRatings } = await db
        .from('track_ratings')
        .select('id', { count: 'exact', head: true })
        .in('recording_id', gone.map((b) => b.recording_id));
      if (goneRatings) ratingsOnGone += goneRatings;
    }
    if (badRecordingIds.length) {
      const { count: ratingCount } = await db
        .from('track_ratings')
        .select('id', { count: 'exact', head: true })
        .in('recording_id', badRecordingIds);
      if (ratingCount) ratingsAtRisk += ratingCount;
    }

    if (WRITE && badRecordingIds.length) {
      const { error: delErr } = await db
        .from('release_tracks')
        .delete()
        .eq('release_id', rel.id)
        .in('recording_id', badRecordingIds);
      if (delErr) { console.error(`  ${rel.id}: delete release_tracks failed: ${delErr.message}`); continue; }

      // Delete now-orphaned recordings (no other release_tracks row references them).
      for (const recId of badRecordingIds) {
        const { count: stillUsed } = await db
          .from('release_tracks')
          .select('release_id', { count: 'exact', head: true })
          .eq('recording_id', recId);
        if (!stillUsed) {
          const { error: recDelErr } = await db.from('recordings').delete().eq('id', recId);
          if (recDelErr) console.error(`  recording ${recId} delete failed: ${recDelErr.message}`);
        }
      }

      const { count: newTotal } = await db
        .from('release_tracks')
        .select('release_id', { count: 'exact', head: true })
        .eq('release_id', rel.id);
      await db.from('releases').update({ total_tracks: newTotal ?? null }).eq('id', rel.id);
    }
  }

  const acted = INCLUDE_GONE ? rowsFlagged : rowsVideo;
  console.log(`\n  checked ${checked} releases`);
  console.log(`  ${releasesTouched} releases had flagged tracks`);
  console.log(`  ${rowsFlagged} flagged release_tracks rows total:`);
  console.log(`     ${rowsVideo} video  — MB flags recording.video=true (the bug) → ${WRITE ? 'DELETED' : 'would delete'}`);
  console.log(`     ${rowsGone} gone   — absent from MB for another reason (merged/re-edited) → ${INCLUDE_GONE ? (WRITE ? 'DELETED (--include-gone)' : 'would delete (--include-gone)') : 'LEFT ALONE, review the report'}`);
  console.log(`  ${acted} row(s) ${WRITE ? 'deleted' : 'would be deleted'}`);
  console.log(`  ${ratingsAtRisk} track_ratings ${WRITE ? 'cascade-deleted' : 'would be cascade-deleted'} on deleted rows`);
  console.log(`  ${ratingsOnGone} track_ratings sit on 'gone' rows${INCLUDE_GONE ? '' : ' (untouched — they survive)'}`);
  console.log(`  ${skippedFetchFailed} releases SKIPPED — MB re-fetch failed (throttle/network); not verified, not touched`);
  console.log(`  ${skippedEmpty} releases SKIPPED — MB returned 0 audio tracks (degenerate); not touched`);
  if (skippedFetchFailed > 0) {
    console.log(`\n  ⚠ ${skippedFetchFailed} releases could NOT be verified this run (MB throttling). They were left untouched —`);
    console.log(`    re-run (dry-run) when MB is less throttled to cover them before trusting the totals as complete.`);
  }

  // Persist the classified rows. The MB re-fetch is the expensive part (~10h for the full
  // candidate set), so a later pass over the `gone` class should read this instead of re-scanning.
  const reportPath = REPORT ?? path.resolve(`scripts/data/video-cleanup-report-${new Date().toISOString().slice(0, 10)}.json`);
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n  report: ${report.length} classified row(s) → ${reportPath}`);
  } catch (e) {
    console.error(`  report write failed (${(e as Error).message}) — the run itself was unaffected`);
  }

  console.log(`  examples:`, JSON.stringify(flaggedExamples, null, 2));
  if (!WRITE) console.log(`\n  [dry-run] no deletes. Re-run with --write${INCLUDE_GONE ? ' --include-gone' : ''}.\n`);
  else console.log(`\n  ✓ done. Last release id processed: ${candidates[candidates.length - 1]?.id ?? '(none)'}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
