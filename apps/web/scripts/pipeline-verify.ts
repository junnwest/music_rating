/**
 * pipeline:verify — a repeatable verification battery for the data pipeline.
 *
 *   npm run pipeline:verify
 *
 * Each check exercises one lane's decision/write path against the LIVE DB and asserts an
 * invariant, then cleans up any test data it created. It's safe to run anytime (the only
 * write is a single disposable queue row that's deleted, plus the daily tiering recompute
 * which is idempotent). The paths that can only be observed on the long-running process
 * (FRESHNESS actually firing, the supervisor restarting a lane, DISCOVER topping up at the
 * low-water mark) are listed at the end as "soak" checks to watch in `pipeline:status`.
 */
import { randomUUID } from 'node:crypto';
import { getDB, type DB } from './itunes-ingest-core';
import { integrityCheck, requeueFailures, recomputePriorities } from './mb-qc';
import { gapfillGroups } from './mb-gapfill';
import { nextCheckAt } from './mb-ingest';

interface Result { pass: boolean; detail: string }
const ok = (detail: string): Result => ({ pass: true, detail });
const fail = (detail: string): Result => ({ pass: false, detail });

const CHECKS: { name: string; run: (db: DB) => Promise<Result> }[] = [
  // ── migrations present ───────────────────────────────────────────────────────
  { name: 'migrations', run: async (db) => {
    const probes: [string, () => PromiseLike<any>][] = [
      ['queue.attempt_count', () => db.from('artist_ingestion_queue').select('attempt_count').limit(1)],
      ['release_groups.gapfill_checked_at', () => db.from('release_groups').select('gapfill_checked_at').limit(1)],
    ];
    const missing: string[] = [];
    for (const [label, q] of probes) { const { error } = await q(); if (error) missing.push(label); }
    return missing.length ? fail(`missing: ${missing.join(', ')}`) : ok('attempt_count + gapfill_checked_at present');
  }},

  // ── INGEST data integrity (the mb-audit invariants) ─────────────────────────
  { name: 'integrity', run: async (db) => {
    const i = await integrityCheck(db);
    // Structural invariants are hard fails; empty artists are a soft review-note (often
    // legit — features-only acts have 0 core releases after the composition filter).
    const hard = i.dupArtists + i.multiCanon + i.noCanon + i.nonMbSources + i.orphanReleases;
    if (hard > 0) return fail(i.anomalies.filter(a => !a.includes('release_groups')).join('; '));
    return ok(i.emptyArtists ? `structurally clean · ${i.emptyArtists} empty artist(s) to review (often legit)` : 'no anomalies');
  }},

  // ── FRESHNESS cadence math (pure) ────────────────────────────────────────────
  { name: 'freshness-cadence', run: async () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const d = (p: string) => new Date(nextCheckAt(p, base)).getTime();
    const ordered = d('hot') < d('active') && d('active') < d('known') && d('known') < d('dormant');
    return ordered ? ok('hot<active<known<dormant') : fail('cadence ordering wrong');
  }},

  // ── TIERING (recompute RPC) ──────────────────────────────────────────────────
  { name: 'tiering', run: async (db) => {
    const t = await recomputePriorities(db);
    if (t.needsMigration) return fail('recompute_ingest_priorities not installed (apply 20260626000004)');
    const { data } = await db.from('artists').select('ingest_priority').eq('ingest_state', 'tracks_done').limit(500);
    const tiers = new Set((data ?? []).map((r: any) => r.ingest_priority));
    return ok(`ran (${t.updated} changed); tiers in use: ${[...tiers].join(', ') || 'none yet'}`);
  }},

  // ── QC auto-requeue round-trip (disposable failed row → pending → cleanup) ────
  { name: 'qc-requeue', run: async (db) => {
    const name = `__verify_${randomUUID().slice(0, 8)}`;
    const src = '__verify__';
    try {
      const { error: insErr } = await db.from('artist_ingestion_queue').insert({ name, source: src, status: 'failed', attempt_count: 0, error: 'verify' });
      if (insErr) return fail(`insert: ${insErr.message}`);
      const rq = await requeueFailures(db, 5);
      if (rq.needsMigration) return fail('attempt_count missing');
      const { data } = await db.from('artist_ingestion_queue').select('status, attempt_count').eq('name', name).eq('source', src).maybeSingle();
      const requeued = (data as any)?.status === 'pending' && (data as any)?.attempt_count === 1;
      return requeued ? ok('failed → pending, attempt_count bumped') : fail(`row state: ${JSON.stringify(data)}`);
    } finally {
      await db.from('artist_ingestion_queue').delete().eq('name', name).eq('source', src);
    }
  }},

  // ── GAPFILL wired (column present; no iTunes calls at limit 0) ────────────────
  { name: 'gapfill-wired', run: async (db) => {
    try { const g = await gapfillGroups(db, 0); return ok(`callable (checked ${g.checked})`); }
    catch (e) { return fail((e as Error).message); }
  }},

  // ── CHARTS RPCs return the drop-in shape ─────────────────────────────────────
  { name: 'charts-rpcs', run: async (db) => {
    const calls: [string, any][] = [
      ['get_charts_pulse', undefined],
      ['get_charts_top_rated', { p_limit: 5 }],
      ['get_charts_most_rated', { p_limit: 5 }],
      ['get_charts_trending', { p_limit: 5 }],
      ['get_charts_hidden_gems', { p_limit: 5 }],
      ['get_charts_top_rated_songs', { p_limit: 5 }],
      ['get_charts_most_rated_songs', { p_limit: 5 }],
      ['get_charts_trending_songs', { p_limit: 5 }],
      ['get_user_top_genres', { p_user_id: randomUUID(), p_limit: 3 }],
      ['get_charts_trending_for_genres', { p_genres: ['k-pop'], p_limit: 5 }],
    ];
    const bad: string[] = [];
    for (const [name, params] of calls) {
      const { data, error } = await db.rpc(name, params);
      if (error || !Array.isArray(data)) bad.push(`${name}${error ? `(${error.message.slice(0, 40)})` : '(non-array)'}`);
    }
    return bad.length ? fail(bad.join(', ')) : ok(`all ${calls.length} RPCs return arrays`);
  }},
];

async function main() {
  const db = getDB();
  console.log('\n  pipeline:verify\n  ─────────────');
  let passed = 0;
  for (const c of CHECKS) {
    let r: Result;
    try { r = await c.run(db); } catch (e) { r = fail((e as Error).message); }
    if (r.pass) passed++;
    console.log(`  ${r.pass ? '✓' : '✗'} ${c.name.padEnd(18)} ${r.detail}`);
  }
  console.log(`\n  ${passed}/${CHECKS.length} checks passed\n`);
  console.log('  Soak checks (watch in `npm run pipeline:status` on the live process):');
  console.log('   · DISCOVER tops up when pending < low-water (auto count climbs, region rotates)');
  console.log('   · FRESHNESS re-polls an artist once its next_check_at passes (set one to the past to force)');
  console.log('   · supervisor restarts a lane that throws (other lanes keep running)\n');
  process.exit(passed === CHECKS.length ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
