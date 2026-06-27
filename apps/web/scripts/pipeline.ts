/**
 * sillajuku data pipeline — the single long-running orchestrator (RENOVATION_PLAN §5).
 *
 *   npm run pipeline            # discover + ingest, loops forever (leave it running)
 *   npm run pipeline -- --once  # drain the queue once, then exit
 *   npm run pipeline:status     # live dashboard (separate command)
 *
 * Lanes (this file):
 *   • DISCOVER — curated seed at startup + self-feeding top-up (ListenBrainz + Wikipedia)
 *     that keeps the queue fed so the catalog grows over a week instead of idling.
 *   • INGEST — drain the queue via MusicBrainz (single 1-req/s worker), with FRESHNESS
 *     woven in: every Nth ingest (and whenever the queue is empty) it re-polls a due
 *     artist (next_check_at passed) for new releases. Both share the one MB worker.
 *   • EMBEDDINGS — Jina, concurrent.
 *   • QC — DB-only, concurrent: snapshots integrity (the mb-audit invariants) and
 *     auto-requeues transiently-failed rows (self-healing), capped by attempt_count.
 *   • GAPFILL — iTunes fallback (covers, empty tracklists, MB-missing artists), append-only
 *     + source-tagged. Slow/bounded with a NON-FATAL 403 breaker (backs off, never exits).
 * Plus per-lane heartbeat + startup stale-reset + freshness bootstrap.
 *
 * Tuning (env): DISCOVER_LOW_WATER, DISCOVER_TARGET, DISCOVER_CEILING, DISCOVER_POLL_MS,
 * FRESHNESS_EVERY, QC_POLL_MS, QC_MAX_ATTEMPTS, GAPFILL_POLL_MS, GAPFILL_GROUP_BATCH,
 * GAPFILL_ARTIST_BATCH, GAPFILL_BLOCK_COOLDOWN_MS. Flags: --no-discover, --no-qc, --no-embed,
 * --no-gapfill, --discover-only, --once, --limit=N.
 *
 * Why a single INGEST worker: MusicBrainz is a hard global ~1 req/s limit, so more
 * workers can't go faster — they'd just contend. State lives in the DB
 * (artist_ingestion_queue + the MBID-idempotent writer), so a crash/restart resumes
 * cleanly: stale 'processing' rows are reset to 'pending' on startup.
 */

import { getDB, resolveArtist, ingestArtist, nextCheckAt, type DB } from './mb-ingest';
import { embedReleaseGroupsBatch, embeddingsEnabled } from './mb-enrich';
import { listenBrainzTopUp } from './mb-discover';
import { wikipediaTopUp, REGIONS } from './build-global-queue';
import { integrityCheck, requeueFailures, recomputePriorities } from './mb-qc';
import { gapfillGroups, gapfillSkippedArtists, MigrationNeeded } from './mb-gapfill';
import { runDeezerFallback } from './mb-deezer-fallback';
import { ItunesBlockedError, resetBlock } from './itunes-client';
import { SEED } from './seed-artists';

const ONCE = process.argv.includes('--once');
const DISCOVER_ONLY = process.argv.includes('--discover-only');
const NO_EMBED = process.argv.includes('--no-embed');
const NO_DISCOVER = process.argv.includes('--no-discover'); // disable the self-feeding lane (drain-only)
const NO_QC = process.argv.includes('--no-qc');             // disable the QC lane
const NO_GAPFILL = process.argv.includes('--no-gapfill');   // disable the iTunes GAPFILL lane
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const DRAIN_ONCE = ONCE || Number.isFinite(LIMIT); // bounded runs: drain then exit
const IDLE_MS = 30_000;

// ── self-feeding DISCOVER lane tuning (env-overridable) ────────────────────────
// The lane tops up the queue when `pending` runs low, so the catalog GROWS over a
// week instead of idling once the curated seed drains. Kept controlled (the old
// uncontrolled Last.fm snowball is what drifted the catalog Western):
//   • bounded per top-up (refill toward TARGET, never more),
//   • a lifetime CEILING on auto-discovered rows (a hard backstop against runaway),
//   • region-curated Wikipedia rotation as the counterweight to ListenBrainz drift.
const envInt = (name: string, d: number) => { const v = process.env[name]; const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) ? n : d; };
const DISCOVER_LOW_WATER = envInt('DISCOVER_LOW_WATER', 40);   // top up when pending < this
const DISCOVER_TARGET    = envInt('DISCOVER_TARGET', 200);     // refill pending toward this
const DISCOVER_CEILING   = envInt('DISCOVER_CEILING', 12000);  // lifetime cap on auto-discovered rows
const DISCOVER_POLL_MS   = envInt('DISCOVER_POLL_MS', 60_000); // re-check cadence while above low-water

// ── FRESHNESS + QC tuning (env-overridable) ────────────────────────────────────
// FRESHNESS shares the single MB worker (one re-poll every FRESHNESS_EVERY new ingests,
// plus whenever the queue is empty) so growth never fully starves re-checks. QC is
// DB-only, so it runs as its own concurrent lane.
const FRESHNESS_EVERY = envInt('FRESHNESS_EVERY', 20);          // 1 re-poll per N new ingests (0 = off)
const QC_POLL_MS      = envInt('QC_POLL_MS', 3_600_000);        // QC cadence (default 1h)
const QC_MAX_ATTEMPTS = envInt('QC_MAX_ATTEMPTS', 5);           // give up requeuing a row after N tries
const TIER_INTERVAL_MS= envInt('TIER_INTERVAL_MS', 86_400_000); // re-derive freshness tiers daily

// ── GAPFILL tuning (iTunes — kept deliberately slow/bounded; iTunes IP-blocks on volume) ─
const GAPFILL_POLL_MS    = envInt('GAPFILL_POLL_MS', 1_800_000);     // idle cadence (default 30m)
const GAPFILL_GROUP_BATCH= envInt('GAPFILL_GROUP_BATCH', 25);        // cover/tracklist groups per cycle
const GAPFILL_ARTIST_BATCH = envInt('GAPFILL_ARTIST_BATCH', 3);      // MB-skipped artists per cycle
const GAPFILL_BLOCK_COOLDOWN_MS = envInt('GAPFILL_BLOCK_COOLDOWN_MS', 7_200_000); // back off 2h on a 403 block
const GAPFILL_RECOVER_ARTISTS = process.env.GAPFILL_RECOVER_ARTISTS === '1'; // job C (iTunes skipped-artist recovery) — OFF: pollutes with shadow artists

// ── DEEZER fallback lane (recover genuinely MB-missing artists from Deezer) — OFF by
// default; opt in with DEEZER_FALLBACK=1 once standalone runs prove it clean. Clean by
// construction (no shadow artists possible) + guarded, but it's a blind auto-writer, so
// it's gated like job C until trusted. Generic names still go to mb-overrides, not here.
const DEEZER_FALLBACK = process.env.DEEZER_FALLBACK === '1';
const DEEZER_BATCH    = envInt('DEEZER_BATCH', 5);
const DEEZER_POLL_MS  = envInt('DEEZER_POLL_MS', 1_800_000); // 30m idle cadence

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
const now = () => new Date().toISOString();

// ── heartbeat ───────────────────────────────────────────────────────────────
async function beat(db: DB, lane: string, patch: Record<string, unknown>) {
  await db.from('pipeline_lanes').upsert(
    { lane, updated_at: now(), ...patch },
    { onConflict: 'lane' },
  );
}

// ── DISCOVER (seed): load the curated seed list once at startup (deduped). Ongoing
// breadth is handled by discoverLoop (ListenBrainz + Wikipedia) once the seed drains.
async function discoverSeed(db: DB) {
  const rows = SEED.map(s => ({ name: s.name, source: 'seed', source_id: s.region ?? null, status: 'pending' }));
  // UNIQUE(name, source) makes this idempotent — existing rows are ignored.
  await db.from('artist_ingestion_queue').upsert(rows, { onConflict: 'name,source', ignoreDuplicates: true });
  const { count } = await db.from('artist_ingestion_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  await beat(db, 'discover', { status: 'idle', last_active: now(), current_item: `${count ?? 0} pending` });
  console.log(`  [discover] seed loaded — ${count ?? 0} pending in queue`);
}

const WIKI_REGION: Record<string, string> = {
  wikipedia_japan: 'JP', wikipedia_korea: 'KR', wikipedia_greater_china: 'TW',
  wikipedia_south_asia: 'IN', wikipedia_sea: null as unknown as string,
};
function regionOf(row: { source: string; source_id: string | null }): string | null {
  if (row.source === 'seed') return row.source_id;
  return WIKI_REGION[row.source] ?? null;
}

// ── DISCOVER (self-feeding): keep the queue fed so the catalog grows over a week ─
// Concurrent with INGEST: it hits ListenBrainz + Wikipedia (NOT MusicBrainz), so it
// never contends with the 1-req/s INGEST worker. Controlled: bounded per top-up +
// a lifetime ceiling on auto-discovered rows + region-rotated Wikipedia counterweight.
async function queueCount(db: DB, filter: (q: any) => any): Promise<number> {
  const { count } = await filter(db.from('artist_ingestion_queue').select('id', { count: 'exact', head: true }));
  return count ?? 0;
}

async function discoverLoop(db: DB) {
  if (NO_DISCOVER || DRAIN_ONCE) {
    await beat(db, 'discover', { status: NO_DISCOVER ? 'off' : 'idle (drain-only)', last_active: now() });
    return;
  }
  const regionNames = REGIONS.map(r => r.region);
  let regionIdx = 0, totalQueued = 0, errs = 0;
  for (;;) {
    const pending = await queueCount(db, q => q.eq('status', 'pending'));
    const auto = await queueCount(db, q => q.neq('source', 'seed')); // everything not curated-seed

    if (auto >= DISCOVER_CEILING) {
      await beat(db, 'discover', { status: 'idle (ceiling)', last_active: now(), items_done: totalQueued, errors: errs, current_item: `${pending} pending · ${auto}/${DISCOVER_CEILING} ceiling` });
      await sleep(DISCOVER_POLL_MS); continue;
    }
    if (pending >= DISCOVER_LOW_WATER) {
      await beat(db, 'discover', { status: 'idle', last_active: now(), items_done: totalQueued, errors: errs, current_item: `${pending} pending · ${auto}/${DISCOVER_CEILING}` });
      await sleep(DISCOVER_POLL_MS); continue;
    }

    // pending is low and we're under the ceiling → one bounded top-up.
    const want = Math.max(0, Math.min(DISCOVER_TARGET - pending, DISCOVER_CEILING - auto));
    if (want <= 0) { await sleep(DISCOVER_POLL_MS); continue; }
    const region = regionNames[regionIdx++ % regionNames.length];
    await beat(db, 'discover', { status: 'topping up', last_active: now(), items_done: totalQueued, errors: errs, current_item: `want ${want} (lb + wiki:${region})` });
    console.log(`  [discover] pending ${pending} < ${DISCOVER_LOW_WATER} — top up ~${want} (lb + wiki:${region})`);

    let added = 0;
    try {
      const lb = await listenBrainzTopUp(db, { from: 200, per: 6, limit: want });
      added += lb;
      const remaining = want - lb;
      if (remaining > 0) added += await wikipediaTopUp(db, { regions: [region], limit: remaining, fetchNative: false });
      totalQueued += added;
      console.log(`  [discover] queued ${added} new (lb ${lb})`);
    } catch (e) {
      errs++;
      await beat(db, 'discover', { status: 'error', last_active: now(), items_done: totalQueued, errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [discover] ERROR: ${(e as Error).message}`);
      await sleep(DISCOVER_POLL_MS); continue;
    }
    await beat(db, 'discover', { status: 'idle', last_active: now(), items_done: totalQueued, errors: errs, current_item: `+${added} queued` });
    // Yielded nothing (sources momentarily exhausted) → back off a full poll; otherwise
    // loop promptly to keep INGEST fed.
    await sleep(added > 0 ? 5_000 : DISCOVER_POLL_MS);
  }
}

// ── INGEST: claim one pending artist → MB resolve → full ingest → mark done ─────
async function claimNext(db: DB): Promise<{ id: string; name: string; source: string; source_id: string | null } | null> {
  const { data } = await db.from('artist_ingestion_queue')
    .select('id, name, source, source_id').eq('status', 'pending').order('created_at').limit(1).maybeSingle();
  if (!data) return null;
  // Single-worker lease: flip to processing (conditional on still pending).
  const { data: claimed } = await db.from('artist_ingestion_queue')
    .update({ status: 'processing' }).eq('id', data.id).eq('status', 'pending').select('id').maybeSingle();
  return claimed ? data : null; // null if another run grabbed it
}

// ── FRESHNESS: re-poll artists whose next_check_at has passed for new releases ───
// Shares the single MB worker (interleaved inside ingestLoop), since it hits MB too.
// ingestArtist is MBID-idempotent, so a re-poll just adds any new release groups and
// reschedules next_check_at from the artist's priority tier.
async function countArtistRGs(db: DB, artistId: string): Promise<number> {
  const { count } = await db.from('release_groups').select('id', { count: 'exact', head: true }).eq('primary_artist_id', artistId);
  return count ?? 0;
}
async function claimDueFreshness(db: DB): Promise<{ id: string; name: string; mbid: string } | null> {
  const { data } = await db.from('artists')
    .select('id, name')
    .eq('ingest_state', 'tracks_done')
    .not('next_check_at', 'is', null)
    .lte('next_check_at', now())
    .order('next_check_at', { ascending: true })
    .limit(1).maybeSingle();
  if (!data) return null;
  const { data: ext } = await db.from('artist_external_ids')
    .select('external_id').eq('artist_id', data.id).eq('source', 'musicbrainz').limit(1).maybeSingle();
  if (!ext?.external_id) return null;
  return { id: data.id, name: data.name, mbid: ext.external_id as string };
}
async function refreshArtist(db: DB, a: { id: string; name: string; mbid: string }, fcount: number): Promise<void> {
  const before = await countArtistRGs(db, a.id);
  const res = await ingestArtist(db, a.mbid); // idempotent; resets last_ingested_at + next_check_at
  const delta = Math.max(0, (await countArtistRGs(db, a.id)) - before);
  console.log(`  [freshness] ${a.name} — ${delta > 0 ? `+${delta} new groups` : 'no change'} (${res.rgCount} total)`);
  await beat(db, 'freshness', { status: 'running', last_active: now(), items_done: fcount, current_item: `${a.name} ${delta > 0 ? `+${delta}` : '·'}` });
}

async function ingestLoop(db: DB) {
  let done = 0, skipped = 0, failed = 0, freshDone = 0, sinceFresh = 0;
  const tryFreshness = async (): Promise<boolean> => {
    if (DRAIN_ONCE || FRESHNESS_EVERY <= 0) return false;
    const due = await claimDueFreshness(db);
    if (!due) return false;
    try { await refreshArtist(db, due, ++freshDone); }
    catch (e) { console.log(`  [freshness] ERROR ${due.name}: ${(e as Error).message}`); }
    return true;
  };
  await beat(db, 'freshness', { status: FRESHNESS_EVERY > 0 && !DRAIN_ONCE ? 'idle' : 'off', last_active: now() });
  for (;;) {
    // Spend one MB cycle on a due re-poll every FRESHNESS_EVERY new ingests, so catalog
    // growth (INGEST) never fully starves re-checks. No-op when nothing is due.
    if (sinceFresh >= FRESHNESS_EVERY) { sinceFresh = 0; if (await tryFreshness()) continue; }

    const row = await claimNext(db);
    if (!row) {
      await beat(db, 'ingest', { status: 'idle', last_active: now(), items_done: done, errors: failed });
      if (ONCE) { console.log(`\n  [ingest] queue drained — done ${done}, skipped ${skipped}, failed ${failed}`); return; }
      // Queue empty → use the idle MB time for freshness if anything is due.
      if (await tryFreshness()) continue;
      await sleep(IDLE_MS);
      continue;
    }
    const region = regionOf(row);
    process.stdout.write(`  [ingest] ${row.name.padEnd(24)} `);
    await beat(db, 'ingest', { status: 'running', last_active: now(), current_item: row.name, items_done: done, errors: failed });
    try {
      // ListenBrainz discovery rows already carry the MBID → ingest directly (no resolve).
      let mbid: string | null = (row.source === 'listenbrainz' && row.source_id) ? row.source_id : null;
      let label = row.name, ambig = false;
      if (!mbid) {
        const r = await resolveArtist(row.name, region);
        if (!r.best) {
          const why = r.needsReview ? 'needs_review' : 'no_match';
          await mark(db, row.id, 'skipped', { error: why });
          skipped++; console.log(why);
        } else { mbid = r.best.id; label = r.best.name; ambig = r.ambiguous; }
      }
      if (mbid) {
        const res = await ingestArtist(db, mbid);
        await mark(db, row.id, 'done', { releases_added: res.rgCount });
        done++; console.log(`→ ${label}  ${res.rgCount} groups, ${res.recCount} recordings${ambig ? ' (ambig)' : ''}`);
      }
    } catch (e) {
      await mark(db, row.id, 'failed', { error: (e as Error).message.slice(0, 255) });
      failed++; console.log(`ERROR: ${(e as Error).message}`);
    }
    sinceFresh++;
    await beat(db, 'ingest', { status: 'running', last_active: now(), items_done: done, errors: failed });
    if (done + skipped + failed >= LIMIT) { console.log(`\n  [ingest] hit --limit=${LIMIT} — done ${done}, skipped ${skipped}, failed ${failed}`); return; }
  }
}

async function mark(db: DB, id: string, status: string, extra: Record<string, unknown>) {
  await db.from('artist_ingestion_queue').update({ status, processed_at: now(), ...extra }).eq('id', id);
}

// ── EMBEDDINGS lane: Jina-bound, runs concurrently with INGEST (no MB contention) ──
async function embeddingsLoop(db: DB) {
  if (NO_EMBED || !embeddingsEnabled()) {
    await beat(db, 'embeddings', { status: NO_EMBED ? 'off' : 'disabled (no JINA_API_KEY)', last_active: now() });
    return;
  }
  let done = 0, errs = 0;
  for (;;) {
    // A transient Jina HTTP error returns -1; a raw network drop (ECONNRESET/fetch failed)
    // THROWS — catch it here so a blip never escapes the lane (the supervisor is the backstop).
    let n: number;
    try { n = await embedReleaseGroupsBatch(db, 64); }
    catch (e) {
      errs++; await beat(db, 'embeddings', { status: 'error', last_active: now(), items_done: done, errors: errs, current_item: (e as Error).message.slice(0, 80) });
      if (DRAIN_ONCE) return;
      await sleep(IDLE_MS); continue;
    }
    if (n > 0) { done += n; await beat(db, 'embeddings', { status: 'running', last_active: now(), items_done: done, errors: errs }); continue; }
    if (n < 0) { // transient Jina HTTP error (already logged inside the batch)
      errs++; await beat(db, 'embeddings', { status: 'error', last_active: now(), items_done: done, errors: errs });
      if (DRAIN_ONCE) return;
      await sleep(IDLE_MS); continue;
    }
    await beat(db, 'embeddings', { status: 'idle', last_active: now(), items_done: done, errors: errs });
    if (DRAIN_ONCE) return;
    await sleep(IDLE_MS);
  }
}

// ── QC lane: DB-only (no MB), so it runs concurrently. Each cycle snapshots integrity
// (the mb-audit invariants) and auto-requeues transiently-failed rows (self-healing). ──
async function qcLoop(db: DB) {
  if (NO_QC) { await beat(db, 'qc', { status: 'off', last_active: now() }); return; }
  let requeuedTotal = 0, lastTier = 0;
  for (;;) {
    const integ = await integrityCheck(db);
    const rq = await requeueFailures(db, QC_MAX_ATTEMPTS);
    requeuedTotal += rq.requeued;

    // FRESHNESS tiering: reprioritize artists (release recency + engagement) once a day so
    // active artists re-poll fast. Runs here because it's DB-only, like the rest of QC.
    let tierNote = '';
    if (Date.now() - lastTier >= TIER_INTERVAL_MS) {
      const t = await recomputePriorities(db);
      lastTier = Date.now();
      tierNote = t.needsMigration ? 'tiers off (apply 20260626000004)' : (t.updated ? `tiers: ${t.updated} reprioritized` : '');
    }

    const note = [
      integ.ok ? 'integrity ok' : `⚠ ${integ.anomalies.join('; ')}`,
      rq.requeued ? `requeued ${rq.requeued}` : '',
      rq.capped ? `${rq.capped} capped` : '',
      rq.needsMigration ? 'requeue off (apply attempt_count migration)' : '',
      tierNote,
    ].filter(Boolean).join(' · ');
    const status = !integ.ok ? 'warn' : rq.requeued ? 'requeued' : 'clean';
    await beat(db, 'qc', { status, last_active: now(), items_done: requeuedTotal, errors: integ.ok ? 0 : integ.anomalies.length, current_item: note });
    console.log(`  [qc] ${note}`);
    if (DRAIN_ONCE) return;
    await sleep(QC_POLL_MS);
  }
}

// ── GAPFILL lane: iTunes fallback for MB's holes (covers, tracklists, MB-missing
// artists). DB + iTunes only (no MB contention). Deliberately slow/bounded — iTunes
// IP-blocks on volume — and the breaker is NON-FATAL: on a sustained block it backs off
// for hours while the other lanes keep running, instead of killing the process. ──
async function gapfillLoop(db: DB) {
  if (NO_GAPFILL || DRAIN_ONCE) { await beat(db, 'gapfill', { status: NO_GAPFILL ? 'off' : 'idle (drain-only)', last_active: now() }); return; }
  let covers = 0, tracklists = 0, recovered = 0, errs = 0;
  for (;;) {
    try {
      const g = await gapfillGroups(db, GAPFILL_GROUP_BATCH);
      // Job C (recover MB-skipped artists from iTunes) is OFF by default: it dragged in
      // shadow artists (store-country=USA, untagged, collab-string junk) that duplicated MB
      // rows. MB-skipped generic names are recovered via mb-overrides instead (proper MB
      // identity + ISRC). Opt back in with GAPFILL_RECOVER_ARTISTS=1 only if reworked.
      const s = GAPFILL_RECOVER_ARTISTS ? await gapfillSkippedArtists(db, GAPFILL_ARTIST_BATCH) : { processed: 0, recovered: 0, groups: 0 };
      covers += g.covers; tracklists += g.tracklists; recovered += s.recovered;
      const worked = g.checked > 0 || s.processed > 0;
      if (worked) console.log(`  [gapfill] covers +${g.covers}, tracklists +${g.tracklists}, artists +${s.recovered}`);
      await beat(db, 'gapfill', { status: worked ? 'running' : 'idle', last_active: now(), items_done: covers + tracklists + recovered, errors: errs, current_item: `covers ${covers} · tracks ${tracklists} · artists ${recovered}` });
      await sleep(worked ? 5_000 : GAPFILL_POLL_MS);
    } catch (e) {
      if (e instanceof MigrationNeeded) {
        await beat(db, 'gapfill', { status: 'off (apply migration 20260626000003)', last_active: now() });
        console.log(`  [gapfill] disabled — ${(e as Error).message}`);
        return; // needs the column + a restart; no point looping
      }
      if (e instanceof ItunesBlockedError) {
        errs++; resetBlock(); // clear the counter so we can retry after the cooldown
        await beat(db, 'gapfill', { status: 'blocked (iTunes 403)', last_active: now(), errors: errs, current_item: `cooldown ${Math.round(GAPFILL_BLOCK_COOLDOWN_MS / 60000)}m` });
        console.log(`  [gapfill] iTunes IP-blocked — backing off ${Math.round(GAPFILL_BLOCK_COOLDOWN_MS / 60000)}m (other lanes continue)`);
        await sleep(GAPFILL_BLOCK_COOLDOWN_MS); continue;
      }
      errs++;
      await beat(db, 'gapfill', { status: 'error', last_active: now(), errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [gapfill] ERROR: ${(e as Error).message}`);
      await sleep(GAPFILL_POLL_MS);
    }
  }
}

// ── DEEZER lane: recover MB-skipped artists from Deezer (DB + Deezer, no MB contention).
// OFF unless DEEZER_FALLBACK=1. Bounded; the Deezer client self-throttles (429 → null, no
// fatal throw); supervised like the rest. Generic names are excluded inside runDeezerFallback. ──
async function deezerLoop(db: DB) {
  if (!DEEZER_FALLBACK || DRAIN_ONCE) { await beat(db, 'deezer', { status: DEEZER_FALLBACK ? 'idle (drain-only)' : 'off', last_active: now() }); return; }
  let ingested = 0, matched = 0;
  for (;;) {
    const r = await runDeezerFallback(db, { limit: DEEZER_BATCH, write: true, log: m => console.log(m) });
    ingested += r.ingested; matched += r.matched;
    const worked = r.processed > 0;
    if (worked) console.log(`  [deezer] matched ${r.matched}, ingested ${r.ingested} groups (generic→overrides ${r.skippedGeneric})`);
    await beat(db, 'deezer', { status: worked ? 'running' : 'idle', last_active: now(), items_done: ingested, current_item: `matched ${matched} · ${ingested} groups` });
    await sleep(worked ? 5_000 : DEEZER_POLL_MS);
  }
}

// ── startup: reset stale 'processing' (from a prior crash) back to 'pending' ────
async function resetStale(db: DB) {
  const { count } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('status', 'processing');
  if (count) {
    await db.from('artist_ingestion_queue').update({ status: 'pending' }).eq('status', 'processing');
    console.log(`  [startup] reset ${count} stale 'processing' rows → pending`);
  }
}

// ── startup: give legacy tracks_done artists (ingested before freshness scheduling) a
// next_check_at so the FRESHNESS lane can pick them up. Idempotent: only touches nulls. ──
async function bootstrapFreshness(db: DB) {
  const { data } = await db.from('artists')
    .select('id, last_ingested_at, ingest_priority')
    .eq('ingest_state', 'tracks_done').is('next_check_at', null).limit(1000);
  if (!data?.length) return;
  for (const a of data) {
    const from = a.last_ingested_at ? new Date(a.last_ingested_at as string) : new Date();
    await db.from('artists').update({ next_check_at: nextCheckAt(a.ingest_priority as string, from) }).eq('id', a.id);
  }
  console.log(`  [startup] scheduled freshness for ${data.length} artist(s) with no next_check_at`);
}

// Supervisor: keep a lane alive for a run-for-a-week deployment. A lane that returns
// normally (e.g. bounded --once) is done; one that THROWS (a transient Supabase/network
// blip in an unguarded read) is logged and restarted after a short backoff instead of
// rejecting Promise.all and killing every other lane. Bounded runs (DRAIN_ONCE) don't
// supervise — a throw there should surface immediately.
async function supervise(db: DB, name: string, loop: (db: DB) => Promise<void>, onRestart?: () => Promise<void>) {
  for (;;) {
    try { await loop(db); return; }
    catch (e) {
      if (DRAIN_ONCE) throw e;
      console.error(`  [${name}] lane crashed: ${(e as Error).message} — restarting in 30s`);
      await beat(db, name, { status: 'restarting', last_active: now(), current_item: (e as Error).message.slice(0, 120) }).catch(() => {});
      await sleep(30_000);
      await onRestart?.().catch(() => {});
    }
  }
}

async function main() {
  console.log(`\n  sillajuku pipeline${ONCE ? ' [--once]' : ' [loop]'}\n`);
  const db = getDB();
  await resetStale(db);
  await bootstrapFreshness(db);
  await discoverSeed(db);
  if (DISCOVER_ONLY) return;
  // INGEST+FRESHNESS (MB, one worker) + EMBEDDINGS (Jina) + DISCOVER (ListenBrainz/Wikipedia)
  // + QC (DB-only) + GAPFILL (iTunes) run concurrently — each hits a different resource, so
  // nothing contends with INGEST's 1-req/s MB limit. Each is supervised so a transient
  // error in one lane never takes the others down.
  await Promise.all([
    supervise(db, 'ingest', ingestLoop, () => resetStale(db)), // re-claim a row stranded by the crash
    supervise(db, 'embeddings', embeddingsLoop),
    supervise(db, 'discover', discoverLoop),
    supervise(db, 'qc', qcLoop),
    supervise(db, 'gapfill', gapfillLoop),
    supervise(db, 'deezer', deezerLoop),
  ]);
}

main().catch(e => { console.error(e); process.exit(1); });
