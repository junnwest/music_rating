/**
 * Pipeline dashboard — `npm run pipeline:status`. Read-only snapshot of lane
 * heartbeats, the queue, and catalog counts. Run anytime while the pipeline loops.
 */
import { getDB } from './itunes-ingest-core';

async function count(db: ReturnType<typeof getDB>, table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count } = await q;
  return count ?? 0;
}

async function main() {
  const db = getDB();

  const { data: lanes } = await db.from('pipeline_lanes').select('*').order('lane');
  const [pending, processing, done, skipped, failed] = await Promise.all([
    count(db, 'artist_ingestion_queue', q => q.eq('status', 'pending')),
    count(db, 'artist_ingestion_queue', q => q.eq('status', 'processing')),
    count(db, 'artist_ingestion_queue', q => q.eq('status', 'done')),
    count(db, 'artist_ingestion_queue', q => q.eq('status', 'skipped')),
    count(db, 'artist_ingestion_queue', q => q.eq('status', 'failed')),
  ]);
  const [artists, groups, releases, recordings, tracks, embedded, covered] = await Promise.all([
    count(db, 'artists'), count(db, 'release_groups'), count(db, 'releases'),
    count(db, 'recordings'), count(db, 'release_tracks'),
    count(db, 'release_groups', q => q.not('embedding', 'is', null)),
    count(db, 'release_groups', q => q.not('cover_url', 'is', null)),
  ]);

  console.log('\n  ── lanes ──');
  for (const l of lanes ?? []) {
    const age = l.last_active ? `${Math.round((Date.now() - new Date(l.last_active).getTime()) / 1000)}s ago` : '—';
    console.log(`    ${String(l.lane).padEnd(10)} ${String(l.status ?? '').padEnd(8)} ${age.padEnd(10)} done=${l.items_done ?? 0} err=${l.errors ?? 0}${l.current_item ? `  «${l.current_item}»` : ''}`);
  }
  if (!lanes?.length) console.log('    (no heartbeats yet)');

  console.log('\n  ── queue ──');
  console.log(`    pending ${pending} · processing ${processing} · done ${done} · skipped ${skipped} · failed ${failed}`);

  console.log('\n  ── catalog ──');
  console.log(`    artists ${artists} · release_groups ${groups} · releases ${releases} · recordings ${recordings} · release_tracks ${tracks}`);
  console.log(`    enrichment: embedded ${embedded}/${groups} · covered ${covered}/${groups}`);

  // ── throughput ── drain rate from queue.processed_at (DB-persistent → survives restarts).
  // This is the rate that actually reduces `pending`, so the ETA reflects when the 5k finishes.
  const since = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const processedSince = (m: number) => count(db, 'artist_ingestion_queue', q => q.gte('processed_at', since(m)).in('status', ['done', 'skipped', 'failed']));
  const [drain10, drain60, rec60] = await Promise.all([
    processedSince(10), processedSince(60),
    count(db, 'recordings', q => q.gte('created_at', since(60))),
  ]);
  const rate10 = drain10 * 6;          // last-10-min rate, extrapolated to /hr (most current)
  const rateHr = drain60 || rate10;    // prefer the full-hour sample; fall back to the 10-min one
  const etaDays = rateHr > 0 ? pending / rateHr / 24 : null;
  console.log('\n  ── throughput ──');
  console.log(`    drained: last 10m ${drain10} (~${rate10}/hr) · last 60m ${drain60}/hr · recordings ~${rec60}/hr`);
  console.log(`    ETA: ${pending} pending ÷ ${rateHr}/hr ≈ ${etaDays === null ? '—' : etaDays.toFixed(1) + ' days'} to drain\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
