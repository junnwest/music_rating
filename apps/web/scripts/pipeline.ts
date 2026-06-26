/**
 * sillajuku data pipeline — the single long-running orchestrator (RENOVATION_PLAN §5).
 *
 *   npm run pipeline            # discover + ingest, loops forever (leave it running)
 *   npm run pipeline -- --once  # drain the queue once, then exit
 *   npm run pipeline:status     # live dashboard (separate command)
 *
 * v1 spine (this file): DISCOVER (seed the queue) + INGEST (drain via MusicBrainz) +
 * heartbeat + startup stale-reset. Enrichment lanes (EMBEDDINGS / COVERS / QC) +
 * iTunes GAPFILL are added next; they run concurrently because they hit other resources.
 *
 * Why a single INGEST worker: MusicBrainz is a hard global ~1 req/s limit, so more
 * workers can't go faster — they'd just contend. State lives in the DB
 * (artist_ingestion_queue + the MBID-idempotent writer), so a crash/restart resumes
 * cleanly: stale 'processing' rows are reset to 'pending' on startup.
 */

import { getDB, resolveArtist, ingestArtist, type DB } from './mb-ingest';
import { embedReleaseGroupsBatch, embeddingsEnabled } from './mb-enrich';
import { SEED } from './seed-artists';

const ONCE = process.argv.includes('--once');
const DISCOVER_ONLY = process.argv.includes('--discover-only');
const NO_EMBED = process.argv.includes('--no-embed');
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const DRAIN_ONCE = ONCE || Number.isFinite(LIMIT); // bounded runs: drain then exit
const IDLE_MS = 30_000;

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
const now = () => new Date().toISOString();

// ── heartbeat ───────────────────────────────────────────────────────────────
async function beat(db: DB, lane: string, patch: Record<string, unknown>) {
  await db.from('pipeline_lanes').upsert(
    { lane, updated_at: now(), ...patch },
    { onConflict: 'lane' },
  );
}

// ── DISCOVER: top up the queue with curated seed artists (deduped) ─────────────
// Wikipedia/ListenBrainz discovery plugs in here later; for v1 it seeds the curated list.
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

async function ingestLoop(db: DB) {
  let done = 0, skipped = 0, failed = 0;
  for (;;) {
    const row = await claimNext(db);
    if (!row) {
      await beat(db, 'ingest', { status: 'idle', last_active: now(), items_done: done, errors: failed });
      if (ONCE) { console.log(`\n  [ingest] queue drained — done ${done}, skipped ${skipped}, failed ${failed}`); return; }
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
    const n = await embedReleaseGroupsBatch(db, 64);
    if (n > 0) { done += n; await beat(db, 'embeddings', { status: 'running', last_active: now(), items_done: done, errors: errs }); continue; }
    if (n < 0) { // transient Jina error
      errs++; await beat(db, 'embeddings', { status: 'error', last_active: now(), items_done: done, errors: errs });
      if (DRAIN_ONCE) return;
      await sleep(IDLE_MS); continue;
    }
    await beat(db, 'embeddings', { status: 'idle', last_active: now(), items_done: done, errors: errs });
    if (DRAIN_ONCE) return;
    await sleep(IDLE_MS);
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

async function main() {
  console.log(`\n  sillajuku pipeline${ONCE ? ' [--once]' : ' [loop]'}\n`);
  const db = getDB();
  await resetStale(db);
  await discoverSeed(db);
  if (DISCOVER_ONLY) return;
  // INGEST (MB) + EMBEDDINGS (Jina) run concurrently — different resources, no contention.
  await Promise.all([ingestLoop(db), embeddingsLoop(db)]);
}

main().catch(e => { console.error(e); process.exit(1); });
