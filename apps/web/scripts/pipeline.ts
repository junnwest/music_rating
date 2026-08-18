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
 *   • NEWRELEASES — daily MB date-window sweep ("what came out since X?") that flags the catalog
 *     artists credited on anything new as due, so FRESHNESS re-polls artists that ACTUALLY have a
 *     new release. This is what makes whole-catalog recency achievable at all: per-artist polling
 *     of 67.5k artists is ~200k MB requests (~2.3 days/cycle); the window sweep is ~250.
 * Plus per-lane heartbeat + startup stale-reset + freshness bootstrap.
 *
 * Tuning (env): DISCOVER_LOW_WATER, DISCOVER_TARGET, DISCOVER_CEILING, DISCOVER_POLL_MS,
 * FRESHNESS_EVERY, QC_POLL_MS, QC_MAX_ATTEMPTS, GAPFILL_POLL_MS, GAPFILL_GROUP_BATCH,
 * GAPFILL_ARTIST_BATCH, GAPFILL_BLOCK_COOLDOWN_MS, NEWRELEASES, NEWRELEASES_INTERVAL_MS,
 * NEWRELEASES_LOOKBACK_DAYS, NEWRELEASES_LOOKAHEAD_DAYS. Flags: --no-discover, --no-qc, --no-embed,
 * --no-gapfill, --discover-only, --once, --limit=N, --fresh-focus.
 *
 * Recency-first preset — new releases for artists we already have, minimal catalog growth:
 *   npm run pipeline -- --fresh-focus --no-embed
 * (= --no-discover + AREA_DISCOVERY=0 + FRESHNESS_EVERY=3, with NEWRELEASES still on.)
 *
 * Why a single INGEST worker: MusicBrainz is a hard global ~1 req/s limit, so more
 * workers can't go faster — they'd just contend. State lives in the DB
 * (artist_ingestion_queue + the MBID-idempotent writer), so a crash/restart resumes
 * cleanly: stale 'processing' rows are reset to 'pending' on startup.
 */

import { getDB, resolveArtist, ingestArtist, nextCheckAt, HeavilyFeaturedError, type DB } from './mb-ingest';
import { embedReleaseGroupsBatch, embeddingsEnabled } from './mb-enrich';
import { listenBrainzTopUp } from './mb-discover';
import { wikipediaTopUp, REGIONS } from './build-global-queue';
import { integrityCheck, requeueFailures, recomputePriorities } from './mb-qc';
import { gapfillGroups, gapfillSkippedArtists, MigrationNeeded } from './mb-gapfill';
import { runDeezerFallback, pickArtist, ingestDeezerArtist } from './mb-deezer-fallback';
import { searchArtists as dzSearchArtists } from './deezer-client';
import { ItunesBlockedError, resetBlock, itunesBlocked } from './itunes-client';
import { mbLastActivityAt } from './mb-client';
import { SEED } from './seed-artists';
import { scanArtistRecency, type RecencyArtist } from './discover-itunes-recency';
import { reconcileItunesMb } from './reconcile-itunes-mb';
import { discoverArea } from './discover-mb-area';
import { discoverNewReleases } from './discover-mb-newreleases';
import fs from 'node:fs';
import path from 'node:path';

const ONCE = process.argv.includes('--once');
const DISCOVER_ONLY = process.argv.includes('--discover-only');
const NO_EMBED = process.argv.includes('--no-embed');
// --fresh-focus: spend the MB budget on NEW RELEASES for the artists we already have, instead of
// on growing the catalog. Turns off both expansion lanes (DISCOVER top-up, AREA sweep) and
// interleaves freshness re-polls far more often. Everything it does is also settable one knob at a
// time (--no-discover / AREA_DISCOVERY=0 / FRESHNESS_EVERY); this is just the one-flag preset.
const FRESH_FOCUS = process.argv.includes('--fresh-focus');
const NO_DISCOVER = process.argv.includes('--no-discover') || FRESH_FOCUS; // disable the self-feeding lane (drain-only)
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

// Watchdog: the supervisor only restarts a lane that THROWS; a lane hung on an unguarded
// await (e.g. a Supabase call with no timeout) never throws → it stalls forever. For the MB
// worker we arm a watchdog that forces a restart once it's been idle this long — judged by
// BOTH no heartbeat AND no MB request dispatch, so a slow/throttled artist (still making MB
// calls between beats) is never mistaken for a hang. 0 disables it.
const INGEST_STALE_MS    = envInt('INGEST_STALE_MS', 600_000); // 10 min
// A permanently-hung artist would otherwise restart-loop forever: watchdog fires → the stranded
// row resets to pending → claimNext re-serves the same (oldest) row → hangs again, blocking the
// whole queue. Auto-skip it after this many watchdog-forced hangs (0 disables). 3 is chosen so a
// merely-slow artist that recovers within a couple of transient MB stalls is NOT skipped.
const INGEST_MAX_HANGS   = envInt('INGEST_MAX_HANGS', 3);

// ── FRESHNESS + QC tuning (env-overridable) ────────────────────────────────────
// FRESHNESS shares the single MB worker (one re-poll every FRESHNESS_EVERY new ingests,
// plus whenever the queue is empty) so growth never fully starves re-checks. QC is
// DB-only, so it runs as its own concurrent lane.
const FRESHNESS_EVERY = envInt('FRESHNESS_EVERY', FRESH_FOCUS ? 3 : 20); // 1 re-poll per N new ingests (0 = off)
// When a user searches for an artist MusicBrainz doesn't have (common for niche/underground
// acts — MB's coverage is thinnest exactly there), recover it from Deezer instead of dropping
// the miss. Demand-driven + confident-match-only, so it's naturally bounded and clean. Default
// on (set MISS_DEEZER_FALLBACK=0 to disable). This is the standing answer to "we can't rely
// 100% on MusicBrainz" — it fills MB's gaps with what real users actually look for.
const MISS_DEEZER_FALLBACK = process.env.MISS_DEEZER_FALLBACK !== '0';
// The Deezer miss-fallback only fires on GENUINE, REPEATED demand for something we truly lack:
//   • db_count = 0 (the catalog returned NOTHING — a low-but-nonzero count usually means we DO
//     have it under a variant, i.e. a matching bug, not a data gap), and
//   • the same query missed >= this many times (a one-off typo shouldn't trigger an ingest).
const MISS_MIN_DEMAND = envInt('MISS_MIN_DEMAND', 2);
const QC_POLL_MS      = envInt('QC_POLL_MS', 3_600_000);        // QC cadence (default 1h)
const QC_MAX_ATTEMPTS = envInt('QC_MAX_ATTEMPTS', 5);           // give up requeuing a row after N tries
const TIER_INTERVAL_MS= envInt('TIER_INTERVAL_MS', 86_400_000); // re-derive freshness tiers daily

// ── GAPFILL tuning (iTunes — kept deliberately slow/bounded; iTunes IP-blocks on volume) ─
const GAPFILL_POLL_MS    = envInt('GAPFILL_POLL_MS', 1_800_000);     // idle cadence (default 30m)
const GAPFILL_GROUP_BATCH= envInt('GAPFILL_GROUP_BATCH', 25);        // cover/tracklist groups per cycle
const GAPFILL_ARTIST_BATCH = envInt('GAPFILL_ARTIST_BATCH', 3);      // MB-skipped artists per cycle
const GAPFILL_BLOCK_COOLDOWN_MS = envInt('GAPFILL_BLOCK_COOLDOWN_MS', 7_200_000); // back off 2h on a 403 block
const GAPFILL_RECOVER_ARTISTS = process.env.GAPFILL_RECOVER_ARTISTS === '1'; // job C (iTunes skipped-artist recovery) — OFF: pollutes with shadow artists

// ── RECENCY + RECONCILE lanes (iTunes) — bridge MB's lag on recent KR releases ──
// RECENCY sweeps owned artists in small batches, auto-ingesting recent releases iTunes has but MB
// doesn't yet, through the multi-signal dedup gate (see discover-itunes-recency.ts — "auto but
// safe"). RECONCILE fills mb_release_group_id on those rows once MB catches up so MB's upsert
// dedups against them. Both bounded + gentle (iTunes IP-blocks on volume; shares the block state
// with GAPFILL). ON by default; set RECENCY=0 to disable both.
const RECENCY = process.env.RECENCY !== '0';
const RECENCY_COUNTRY   = process.env.RECENCY_COUNTRY ?? 'KR';
const RECENCY_BATCH     = envInt('RECENCY_BATCH', 5);            // artists scanned per cycle
const RECENCY_POLL_MS   = envInt('RECENCY_POLL_MS', 1_800_000); // 30m between cycles (slow full sweep)
const RECENCY_SINCE_MONTHS = envInt('RECENCY_SINCE_MONTHS', 12);
const RECONCILE_POLL_MS = envInt('RECONCILE_POLL_MS', 86_400_000); // daily
const RECENCY_STATE = path.resolve('scripts/pipeline-recency-state.json');

// ── DEEZER fallback lane (recover genuinely MB-missing artists from Deezer) — OFF by
// default; opt in with DEEZER_FALLBACK=1 once standalone runs prove it clean. Clean by
// construction (no shadow artists possible) + guarded, but it's a blind auto-writer, so
// it's gated like job C until trusted. Generic names still go to mb-overrides, not here.
const DEEZER_FALLBACK = process.env.DEEZER_FALLBACK === '1';
const DEEZER_BATCH    = envInt('DEEZER_BATCH', 5);
const DEEZER_POLL_MS  = envInt('DEEZER_POLL_MS', 1_800_000); // 30m idle cadence

// ── AREA discovery lane (MB country/area sweep) — keeps KR coverage tracking MusicBrainz over ──
// time so newly-catalogued artists get queued without a manual re-run (the gap that let 민수/음율/
// miiro slip through). Idempotent (queues only genuinely-new MBIDs) + INFREQUENT: a full sweep pages
// ~15k artists at MB's ~1 req/s (~4m of MB calls), so it runs at most weekly and is gated by a
// persisted last-run timestamp (survives restarts — a plain sleep-first loop would never fire on a
// pipeline that restarts more often than the interval). ON by default; AREA_DISCOVERY=0 disables.
const AREA_DISCOVERY = process.env.AREA_DISCOVERY !== '0' && !FRESH_FOCUS;
const AREA_COUNTRY   = process.env.AREA_DISCOVERY_COUNTRY ?? 'KR';
const AREA_CITIES    = process.env.AREA_DISCOVERY_CITIES ?? 'Seoul,Busan,Incheon,Daegu,Gwangju,Daejeon'; // country-null residual
const AREA_INTERVAL_MS = envInt('AREA_DISCOVERY_INTERVAL_MS', 604_800_000); // run at most once a week
const AREA_CHECK_MS  = envInt('AREA_DISCOVERY_CHECK_MS', 3_600_000);        // re-check the due-gate hourly
const AREA_STATE = path.resolve('scripts/pipeline-area-state.json');

// ── NEWRELEASES lane (MB date-window sweep) — how the WHOLE catalog stays current ──
// FRESHNESS alone can't do this: ~3 MB requests per artist × 67.5k artists ≈ 2.3 days of solid MB
// time per full cycle, so new releases were always weeks stale. This lane asks MB the inverted
// question — "what came out since X?" — at ~1 request per 100 release groups (~340/day worldwide),
// then flags ONLY the catalog artists credited on those groups as due now. FRESHNESS then re-polls
// artists that demonstrably have something new instead of blindly cycling everyone. See
// discover-mb-newreleases.ts for why it's a re-swept WINDOW and not an incremental cursor.
// ON by default; NEWRELEASES=0 disables. Gated by a persisted timestamp like AREA, so restarting
// the pipeline often doesn't re-sweep on every boot.
const NEWRELEASES = process.env.NEWRELEASES !== '0';
const NEWRELEASES_INTERVAL_MS = envInt('NEWRELEASES_INTERVAL_MS', 86_400_000); // daily
const NEWRELEASES_CHECK_MS    = envInt('NEWRELEASES_CHECK_MS', 3_600_000);     // re-check the due-gate hourly
const NEWRELEASES_LOOKBACK    = envInt('NEWRELEASES_LOOKBACK_DAYS', 45);
const NEWRELEASES_LOOKAHEAD   = envInt('NEWRELEASES_LOOKAHEAD_DAYS', 30);
const NEWRELEASES_STATE = path.resolve('scripts/pipeline-newreleases-state.json');

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
const now = () => new Date().toISOString();

// ── heartbeat ───────────────────────────────────────────────────────────────
const laneLastBeat = new Map<string, number>(); // in-process heartbeat clock for the watchdog
async function beat(db: DB, lane: string, patch: Record<string, unknown>) {
  laneLastBeat.set(lane, Date.now());
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
// Tier order is deliberate and NOT the same as ordering by next_check_at alone. Sorting purely by
// "most overdue" inverts the priority we actually want: after any long pipeline pause a dormant
// artist scheduled 90 days ago looks more urgent than a hot artist scheduled yesterday, so the
// backlog drains least-important-first. Query tier by tier instead (the composite index
// idx_artists_priority (ingest_priority, next_check_at) exists for exactly this), falling through
// only when a tier has nothing due. Within a tier it's still oldest-due-first.
const FRESHNESS_TIERS = ['hot', 'active', 'known', 'dormant'] as const;
async function claimDueFreshness(db: DB): Promise<{ id: string; name: string; mbid: string } | null> {
  let data: { id: string; name: string } | null = null;
  for (const tier of FRESHNESS_TIERS) {
    const { data: row } = await db.from('artists')
      .select('id, name')
      .eq('ingest_state', 'tracks_done')
      .eq('ingest_priority', tier)
      .not('next_check_at', 'is', null)
      .lte('next_check_at', now())
      .order('next_check_at', { ascending: true })
      .limit(1).maybeSingle();
    if (row) { data = row as { id: string; name: string }; break; }
  }
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
  // When the queue is idle, spend MB time resolving logged search misses → queue confident
  // matches by MBID (self-healing: the catalog fills where real users looked and found nothing).
  // Marks every miss queued_at (even ambiguous/no-match) so it's tried once, not forever.
  const tryMisses = async (): Promise<boolean> => {
    if (DRAIN_ONCE) return false;
    const { data, error } = await db.from('search_misses')
      .select('id, query, db_count').is('queued_at', null).order('searched_at').limit(5);
    if (error || !data?.length) return false; // table without queued_at → migration not applied yet
    for (const m of data as { id: string; query: string; db_count: number | null }[]) {
      try {
        const r = await resolveArtist(m.query, null);
        if (r.best && !r.ambiguous) {
          await db.from('artist_ingestion_queue').upsert(
            { name: m.query, source: 'mbid', source_id: r.best.id, status: 'pending' },
            { onConflict: 'name,source', ignoreDuplicates: true });
          console.log(`  [misses] ${m.query} → ${r.best.name} [${r.best.country ?? '--'}]`);
        } else if (MISS_DEEZER_FALLBACK && (m.db_count ?? 0) === 0) {
          // MB has no confident match AND the catalog returned NOTHING → the artist may simply
          // not be in MusicBrainz. Recover it from Deezer — but only on REPEATED demand (guards
          // against a one-off typo) and confident-match only (guards against wrong artist).
          const { count } = await db.from('search_misses').select('id', { count: 'exact', head: true }).eq('query', m.query);
          if ((count ?? 0) >= MISS_MIN_DEMAND) {
            const hit = pickArtist(await dzSearchArtists(m.query, 8), m.query);
            if (hit) {
              const g = await ingestDeezerArtist(db, hit, null); // -1 = already in catalog (cross-source guard)
              if (g >= 0) console.log(`  [misses] ${m.query} → Deezer "${hit.name}" (${hit.nbFan} fans) — ${g} groups [MB-missing, ${count}× demand]`);
            }
          }
        }
      } catch { /* transient → leave queued_at null, retry next idle */ continue; }
      await db.from('search_misses').update({ queued_at: now() }).eq('id', m.id);
    }
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
      // Queue empty → use the idle MB time for freshness, then for search-miss recovery.
      if (await tryFreshness()) continue;
      if (await tryMisses()) continue;
      await sleep(IDLE_MS);
      continue;
    }
    const region = regionOf(row);
    process.stdout.write(`  [ingest] ${row.name.padEnd(24)} `);
    await beat(db, 'ingest', { status: 'running', last_active: now(), current_item: row.name, items_done: done, errors: failed });
    try {
      // Rows that already carry an MBID → ingest directly (no name resolve). This is the
      // ListenBrainz discovery path AND the curated `mbid` source (hand-seeded artists where a
      // name search would mis-resolve, e.g. "Zico" → a French rapper). Both put the MBID in source_id.
      let mbid: string | null =
        ((row.source === 'listenbrainz' || row.source === 'mbid') && row.source_id) ? row.source_id : null;
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
      // Heavily-featured (composer/VA-tier) → skip terminally, don't fail+requeue into a loop.
      if (e instanceof HeavilyFeaturedError) {
        await mark(db, row.id, 'skipped', { error: 'heavily_featured' });
        skipped++; console.log(`skipped (heavily featured)`);
        continue;
      }
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

// ── RECENCY lane: sweep owned artists for recent iTunes releases MB lacks, auto-ingest the
// confidently-missing (multi-signal dedup gate inside scanArtistRecency). Rotates through the
// whole COUNTRY set via a persisted id cursor, then wraps and re-sweeps. iTunes-only (no MB
// contention); shares the iTunes block state with GAPFILL. ──
function recencyCursor(): string { try { return JSON.parse(fs.readFileSync(RECENCY_STATE, 'utf8')).afterId ?? ''; } catch { return ''; } }
function saveRecencyCursor(id: string) { try { fs.writeFileSync(RECENCY_STATE, JSON.stringify({ afterId: id })); } catch { /* best-effort */ } }

async function recencyLoop(db: DB) {
  if (!RECENCY) { await beat(db, 'recency', { status: 'off', last_active: now() }); return; }
  let ingested = 0, scanned = 0, errs = 0;
  for (;;) {
    try {
      if (itunesBlocked()) { // shared with GAPFILL — either lane tripping a 403 backs both off
        await beat(db, 'recency', { status: 'blocked (iTunes 403)', last_active: now(), errors: errs });
        await sleep(GAPFILL_BLOCK_COOLDOWN_MS); continue;
      }
      const after = recencyCursor();
      const { data: artists } = await db.from('artists')
        .select('id, name, name_native, native_language')
        .eq('country', RECENCY_COUNTRY).eq('ingest_state', 'tracks_done')
        .gt('id', after).order('id').limit(RECENCY_BATCH);
      if (!artists?.length) { // swept the whole set → wrap and re-sweep next cycle
        saveRecencyCursor('');
        await beat(db, 'recency', { status: 'idle (swept)', last_active: now(), items_done: ingested, current_item: `full sweep done · ${ingested} ingested` });
        await sleep(RECENCY_POLL_MS); continue;
      }
      let batch = 0;
      for (const a of artists) {
        const r = await scanArtistRecency(db, a as RecencyArtist, { sinceMonths: RECENCY_SINCE_MONTHS, ingest: true, country: RECENCY_COUNTRY });
        scanned++; batch += r.ingested; ingested += r.ingested;
        for (const g of r.gaps) console.log(`  [recency] +"${(a as any).name}" — ${g.date} ${g.title}`);
        saveRecencyCursor(a.id as string); // advance per-artist so a crash resumes mid-batch
      }
      await beat(db, 'recency', { status: batch ? 'running' : 'idle', last_active: now(), items_done: ingested, errors: errs, current_item: `scanned ${scanned} · +${batch} batch · ${ingested} total` });
      await sleep(RECENCY_POLL_MS);
    } catch (e) {
      if (e instanceof ItunesBlockedError) {
        errs++; resetBlock();
        await beat(db, 'recency', { status: 'blocked (iTunes 403)', last_active: now(), errors: errs, current_item: `cooldown ${Math.round(GAPFILL_BLOCK_COOLDOWN_MS / 60000)}m` });
        console.log(`  [recency] iTunes IP-blocked — backing off ${Math.round(GAPFILL_BLOCK_COOLDOWN_MS / 60000)}m`);
        await sleep(GAPFILL_BLOCK_COOLDOWN_MS); continue;
      }
      errs++;
      await beat(db, 'recency', { status: 'error', last_active: now(), errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [recency] ERROR: ${(e as Error).message}`);
      await sleep(RECENCY_POLL_MS);
    }
  }
}

// ── RECONCILE lane: fill mb_release_group_id on source='itunes' groups MB has now caught up on, so
// MB's upsert-by-mbid dedups against them (the MB-later duplicate never forms). Daily; MB-scoped
// (browse), so it touches the global MB-activity clock only in a brief burst — negligible vs the
// ingest watchdog, which also requires a stale heartbeat before firing. ──
async function reconcileLoop(db: DB) {
  if (!RECENCY) { await beat(db, 'reconcile', { status: 'off', last_active: now() }); return; }
  let linked = 0, errs = 0;
  for (;;) {
    try {
      const r = await reconcileItunesMb(db, { apply: true, limit: 200, log: (m) => console.log(`  [reconcile] ${m}`) });
      linked += r.linked;
      const worked = r.linked > 0 || r.dupNeedsMerge > 0;
      if (worked) console.log(`  [reconcile] linked +${r.linked}, merge-needed ${r.dupNeedsMerge}, no-match ${r.noMatch}`);
      await beat(db, 'reconcile', { status: worked ? 'running' : 'idle', last_active: now(), items_done: linked, errors: errs, current_item: `linked ${linked} total` });
      await sleep(RECONCILE_POLL_MS);
    } catch (e) {
      errs++;
      await beat(db, 'reconcile', { status: 'error', last_active: now(), errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [reconcile] ERROR: ${(e as Error).message}`);
      await sleep(RECONCILE_POLL_MS);
    }
  }
}

// ── AREA lane: re-sweep MB for KR (country + city areas) at most weekly, queuing genuinely-new
// artists (source='mbid') so coverage self-maintains. Timestamp-gated (persisted) so it fires ~weekly
// regardless of restart cadence, and so it does NOT redundantly re-page MB on every pipeline start. ──
function areaCursor(): number { try { return Date.parse(JSON.parse(fs.readFileSync(AREA_STATE, 'utf8')).lastRunAt) || 0; } catch { return 0; } }
function saveAreaCursor() { try { fs.writeFileSync(AREA_STATE, JSON.stringify({ lastRunAt: now() })); } catch { /* best-effort */ } }

async function areaLoop(db: DB) {
  if (!AREA_DISCOVERY) { await beat(db, 'area', { status: 'off', last_active: now() }); return; }
  let queuedTotal = 0, errs = 0;
  for (;;) {
    try {
      const dueIn = AREA_INTERVAL_MS - (Date.now() - areaCursor());
      if (dueIn > 0) { // not due yet — idle-beat and re-check the gate later
        await beat(db, 'area', { status: 'idle', last_active: now(), items_done: queuedTotal, current_item: `next sweep in ~${Math.round(dueIn / 3_600_000)}h` });
        await sleep(AREA_CHECK_MS); continue;
      }
      await beat(db, 'area', { status: 'running', last_active: now(), current_item: 'sweeping MB…' });
      const log = (m: string) => console.log(`  [area] ${m}`);
      const c = await discoverArea(db, { country: AREA_COUNTRY, log });                 // country:KR (~15k)
      const a = AREA_CITIES ? await discoverArea(db, { area: AREA_CITIES, log }) : { queued: 0 }; // country-null residual
      const n = c.queued + a.queued;
      queuedTotal += n;
      saveAreaCursor(); // stamp AFTER a clean sweep so a mid-sweep crash retries next cycle
      console.log(`  [area] swept ${AREA_COUNTRY} — queued +${n} net-new (${c.queued} country, ${a.queued} area)`);
      await beat(db, 'area', { status: 'idle', last_active: now(), items_done: queuedTotal, current_item: `+${n} queued; next in ~${Math.round(AREA_INTERVAL_MS / 3_600_000)}h` });
      await sleep(AREA_CHECK_MS);
    } catch (e) {
      errs++;
      await beat(db, 'area', { status: 'error', last_active: now(), errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [area] ERROR: ${(e as Error).message}`);
      await sleep(AREA_CHECK_MS);
    }
  }
}

// ── NEWRELEASES lane: sweep MB's release-group index by date window and flag the catalog artists
// credited on anything new, so FRESHNESS re-polls them next. MB-scoped but CHEAP (~250 requests for
// a 75-day window vs ~200k for a per-artist sweep of the same coverage), and it only ever writes
// artists.next_check_at — the actual ingest still goes through the existing idempotent path. ──
function newReleasesCursor(): number { try { return Date.parse(JSON.parse(fs.readFileSync(NEWRELEASES_STATE, 'utf8')).lastRunAt) || 0; } catch { return 0; } }
function saveNewReleasesCursor() { try { fs.writeFileSync(NEWRELEASES_STATE, JSON.stringify({ lastRunAt: now() })); } catch { /* best-effort */ } }

async function newReleasesLoop(db: DB) {
  if (!NEWRELEASES || DRAIN_ONCE) { await beat(db, 'newreleases', { status: NEWRELEASES ? 'idle (drain-only)' : 'off', last_active: now() }); return; }
  let flaggedTotal = 0, errs = 0;
  for (;;) {
    try {
      const dueIn = NEWRELEASES_INTERVAL_MS - (Date.now() - newReleasesCursor());
      if (dueIn > 0) { // not due yet — idle-beat and re-check the gate later
        await beat(db, 'newreleases', { status: 'idle', last_active: now(), items_done: flaggedTotal, current_item: `next sweep in ~${Math.round(dueIn / 3_600_000)}h` });
        await sleep(NEWRELEASES_CHECK_MS); continue;
      }
      await beat(db, 'newreleases', { status: 'running', last_active: now(), current_item: 'sweeping MB…' });
      const r = await discoverNewReleases(db, {
        lookbackDays: NEWRELEASES_LOOKBACK,
        lookaheadDays: NEWRELEASES_LOOKAHEAD,
        log: (m) => console.log(`  [newreleases] ${m}`),
      });
      flaggedTotal += r.flagged;
      saveNewReleasesCursor(); // stamp AFTER a clean sweep so a mid-sweep crash retries next cycle
      console.log(`  [newreleases] ${r.groups} groups → flagged ${r.flagged} catalog artist(s) for re-poll (${r.unowned} credited artists not in the catalog)`);
      await beat(db, 'newreleases', { status: 'idle', last_active: now(), items_done: flaggedTotal, errors: errs, current_item: `+${r.flagged} flagged; next in ~${Math.round(NEWRELEASES_INTERVAL_MS / 3_600_000)}h` });
      await sleep(NEWRELEASES_CHECK_MS);
    } catch (e) {
      errs++;
      await beat(db, 'newreleases', { status: 'error', last_active: now(), errors: errs, current_item: (e as Error).message.slice(0, 120) });
      console.log(`  [newreleases] ERROR: ${(e as Error).message}`);
      await sleep(NEWRELEASES_CHECK_MS);
    }
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

// ── watchdog restart: reset the stranded row, and auto-skip a repeat offender ────
// Unlike the startup resetStale (a clean-shutdown recovery — no blame), a watchdog-forced restart
// means the row we were processing genuinely stalled the MB worker. We count hangs per row IN
// MEMORY — deliberately NOT `attempt_count`, which is the shared cap budget the QC/gapfill/deezer
// fallback lanes spend (bumping it here would starve them). In-memory also self-forgives: a full
// process restart clears the counts, so only a within-run repeat offender is penalized. Once a row
// has hung INGEST_MAX_HANGS times, flip it to 'skipped' (NOT 'failed' — QC would requeue a failed
// row straight back into the same hang) so claimNext (pending-only) stops re-serving it. The row
// isn't lost: it's set aside, error-annotated, and re-queueable by hand. This is what stops one
// poison-pill artist from restart-looping forever and blocking the entire queue behind it.
const ingestHangs = new Map<string, number>();
async function penalizeStaleAndReset(db: DB, maxHangs: number) {
  const { data } = await db.from('artist_ingestion_queue')
    .select('id, name').eq('status', 'processing');
  if (!data?.length) return;
  let reset = 0, skipped = 0;
  for (const row of data as { id: string; name: string }[]) {
    const c = (ingestHangs.get(row.id) ?? 0) + 1;
    if (maxHangs > 0 && c >= maxHangs) {
      await db.from('artist_ingestion_queue')
        .update({ status: 'skipped', error: `auto-skipped: hung the MB worker ${c}x this run (watchdog)` })
        .eq('id', row.id).eq('status', 'processing');
      ingestHangs.delete(row.id);
      skipped++;
      console.log(`  [ingest] auto-skipped "${row.name}" after ${c} hangs → set aside (unblocks the queue; re-queueable)`);
    } else {
      await db.from('artist_ingestion_queue')
        .update({ status: 'pending' }).eq('id', row.id).eq('status', 'processing');
      ingestHangs.set(row.id, c);
      reset++;
    }
  }
  if (reset || skipped) console.log(`  [ingest] watchdog reset ${reset} stale row(s)${skipped ? `, auto-skipped ${skipped} poison-pill(s)` : ''}`);
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
async function supervise(db: DB, name: string, loop: (db: DB) => Promise<void>, onRestart?: () => Promise<void>, staleMs = 0) {
  for (;;) {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      laneLastBeat.set(name, Date.now()); // seed so a slow first beat isn't flagged
      const work = loop(db);
      if (staleMs > 0) {
        // Watchdog: reject (→ restart) only when BOTH the heartbeat and MB activity are stale.
        // The dangling hung promise from `work` is harmless — it's frozen and the restarted
        // loop re-claims via onRestart; writes are MBID-idempotent.
        const watchdog = new Promise<never>((_, reject) => {
          timer = setInterval(() => {
            const beatAge = Date.now() - (laneLastBeat.get(name) ?? Date.now());
            const mbAge = Date.now() - mbLastActivityAt();
            if (beatAge > staleMs && mbAge > staleMs) {
              reject(new Error(`watchdog: idle ${Math.round(beatAge / 1000)}s, no MB activity ${Math.round(mbAge / 1000)}s — forcing restart`));
            }
          }, 30_000);
          (timer as { unref?: () => void }).unref?.();
        });
        await Promise.race([work, watchdog]);
      } else {
        await work;
      }
      return;
    } catch (e) {
      if (DRAIN_ONCE) throw e;
      const stalled = (e as Error).message.startsWith('watchdog:');
      console.error(`  [${name}] lane ${stalled ? 'stalled' : 'crashed'}: ${(e as Error).message} — restarting in 30s`);
      await beat(db, name, { status: 'restarting', last_active: now(), current_item: (e as Error).message.slice(0, 120) }).catch(() => {});
      await sleep(30_000);
      await onRestart?.().catch(() => {});
    } finally {
      if (timer) clearInterval(timer);
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
    supervise(db, 'ingest', ingestLoop, () => penalizeStaleAndReset(db, INGEST_MAX_HANGS), INGEST_STALE_MS), // watchdog-armed; re-claim the stranded row, auto-skip a repeat offender
    supervise(db, 'embeddings', embeddingsLoop),
    supervise(db, 'discover', discoverLoop),
    supervise(db, 'qc', qcLoop),
    supervise(db, 'gapfill', gapfillLoop),
    supervise(db, 'deezer', deezerLoop),
    supervise(db, 'recency', recencyLoop),     // iTunes — recent KR releases MB lacks (auto but safe)
    supervise(db, 'reconcile', reconcileLoop), // link source='itunes' rows to MB once it catches up
    supervise(db, 'area', areaLoop),           // MB country/area re-sweep — keeps KR coverage current (weekly)
    supervise(db, 'newreleases', newReleasesLoop), // MB date-window sweep — flags artists with actual new releases (daily)
  ]);
}

main().catch(e => { console.error(e); process.exit(1); });
