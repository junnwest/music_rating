/**
 * One-off cleanup: remove bonus-DVD video tracks (music videos, "Dance Shot" clips,
 * making-ofs, interviews...) that got ingested into release_tracks/recordings as if
 * they were songs, before mb-client.ts's parseMedia() started filtering MusicBrainz's
 * `recording.video` flag (see the StarRingChild EP investigation — same recording
 * showing up twice in a tracklist, once as the real song, once as its bonus DVD PV).
 *
 * For every MB-sourced release that currently has a release_tracks row on disc_number
 * > 1 (video content is essentially never on disc 1 — confirmed by sampling), re-fetch
 * the release from MusicBrainz (which now excludes video tracks) and diff: any
 * currently-stored recording that's no longer in MB's audio-only list gets flagged.
 * Flagged release_tracks rows are deleted; a flagged recording is deleted too (and
 * with it, cascades to any track_ratings on it) IF it's not referenced by any other
 * release_tracks row. releases.total_tracks is corrected on any touched release.
 *
 * Rate-limited by mb-client's shared <=1req/s MusicBrainz limiter — this is a slow,
 * long-running scan (tens of thousands of releases). Resumable: pass --start-after
 * <release-id> (releases are processed in id order) to pick back up after a stop.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts                        # dry-run (report)
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --write                 # delete
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --write --start-after <release-id>
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --limit 200             # cap releases processed (testing)
 *   npx tsx --env-file=.env.local scripts/cleanup-video-tracks.ts --only <release-id>     # spot-check one release, skips the full scan
 */
import { getDB } from './itunes-ingest-core';
import { getReleaseTracks } from './mb-client';

const WRITE = process.argv.includes('--write');
const startAfterIdx = process.argv.indexOf('--start-after');
const START_AFTER: string | null = startAfterIdx >= 0 ? process.argv[startAfterIdx + 1] : null;
const limitIdx = process.argv.indexOf('--limit');
const LIMIT: number | null = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : null;
const onlyIdx = process.argv.indexOf('--only');
const ONLY: string | null = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const chunk = <T>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

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
  console.log('finding candidate releases (disc_number > 1, source=musicbrainz)…');
  const multiDiscReleaseIds = new Set<string>();
  {
    const { count: total, error: countErr } = await db
      .from('release_tracks')
      .select('*', { count: 'exact', head: true })
      .gt('disc_number', 1);
    if (countErr) throw new Error(`disc>1 count: ${countErr.message}`);
    const pageSize = 1000;
    const pages = Math.ceil((total ?? 0) / pageSize);
    const ranges: [number, number][] = [];
    for (let p = 0; p < pages; p++) ranges.push([p * pageSize, p * pageSize + pageSize - 1]);

    let idx = 0;
    async function worker() {
      while (idx < ranges.length) {
        const my = idx++;
        const [from, to] = ranges[my];
        let rows: any[] | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const { data, error } = await db
              .from('release_tracks')
              .select('release_id')
              .gt('disc_number', 1)
              .range(from, to);
            if (error) throw error;
            rows = data;
            break;
          } catch (e) {
            if (attempt === 4) throw e;
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
        for (const r of rows ?? []) multiDiscReleaseIds.add((r as any).release_id);
        if (my % 50 === 0) console.log(`    disc>1 scan: page ${my}/${ranges.length}`);
      }
    }
    await Promise.all(Array.from({ length: 10 }, worker));
  }
  console.log(`  ${multiDiscReleaseIds.size} releases have a disc_number > 1 track`);

  for (const c of chunk([...multiDiscReleaseIds], 200)) {
    const { data, error } = await db
      .from('releases')
      .select('id, mb_release_id')
      .in('id', c)
      .eq('source', 'musicbrainz')
      .not('mb_release_id', 'is', null)
      .order('id');
    if (error) throw new Error(`release lookup: ${error.message}`);
    candidates.push(...((data ?? []) as any[]));
  }
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
  let ratingsAtRisk = 0;
  let checked = 0;
  const flaggedExamples: any[] = [];

  for (const rel of candidates) {
    checked++;
    if (checked % 100 === 0) {
      console.log(`  progress: ${checked}/${candidates.length} checked, ${rowsFlagged} bad rows found so far (last id ${rel.id})`);
    }

    const corrected = await getReleaseTracks(rel.mb_release_id); // already video-filtered
    const correctedMbids = new Set(corrected.map((t) => t.recordingId));

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

    releasesTouched++;
    rowsFlagged += bad.length;
    if (flaggedExamples.length < 15) {
      flaggedExamples.push({ release_id: rel.id, mb_release_id: rel.mb_release_id, bad: bad.map((b) => b.recordings?.title) });
    }

    const badRecordingIds = bad.map((b) => b.recording_id);
    const { count: ratingCount } = await db
      .from('track_ratings')
      .select('id', { count: 'exact', head: true })
      .in('recording_id', badRecordingIds);
    if (ratingCount) ratingsAtRisk += ratingCount;

    if (WRITE) {
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

  console.log(`\n  checked ${checked} releases`);
  console.log(`  ${releasesTouched} releases had bad (video) tracks`);
  console.log(`  ${rowsFlagged} bad release_tracks rows ${WRITE ? 'deleted' : 'flagged'}`);
  console.log(`  ${ratingsAtRisk} track_ratings rows ${WRITE ? 'cascade-deleted' : 'would be cascade-deleted'} (users had rated a video track)`);
  console.log(`  examples:`, JSON.stringify(flaggedExamples, null, 2));
  if (!WRITE) console.log('\n  [dry-run] no deletes. Re-run with --write.\n');
  else console.log(`\n  ✓ done. Last release id processed: ${candidates[candidates.length - 1]?.id ?? '(none)'}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
