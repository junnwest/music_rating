/**
 * DISCOVERY (breadth) — ListenBrainz similar-artists snowball (CC0, MBID-based).
 * Replaces the rejected Last.fm path. For artists we already have, fetch similar
 * artists from ListenBrainz and queue the NEW ones (source='listenbrainz', source_id=MBID)
 * so the pipeline's INGEST lane picks them up and ingests them directly by MBID.
 *
 * CONTROLLED on purpose (uncontrolled snowball is what drifted the old catalog):
 *   --from=N    source artists to snowball from (default 200)
 *   --per=N     similar artists to take per source (default 8)
 *   --limit=N   max NEW artists to queue this run (default 500)
 *
 *   npm run mb:discover
 *
 * The core is exported as `listenBrainzTopUp` so the pipeline's self-feeding DISCOVER
 * lane can call it in bounded batches (see pipeline.ts). The CLI below is a thin wrapper.
 *
 * (Wikipedia breadth is separate: `wikipediaTopUp` in build-global-queue.ts, also
 *  wired into the DISCOVER lane and runnable standalone via `npm run queue:build:global`.)
 */
import { getDB } from './itunes-ingest-core';

type DB = ReturnType<typeof getDB>;

const LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const num = (f: string, d: number) => { const a = process.argv.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface LbArtist { artist_mbid: string; name: string; score: number }

async function similarArtists(mbid: string): Promise<LbArtist[]> {
  await sleep(1100); // be polite to ListenBrainz labs
  try {
    const res = await fetch(`https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${mbid}&algorithm=${LB_ALGO}`, {
      headers: { 'User-Agent': 'sillajuku/1.0 ( admin@sillajuku.com )' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export interface ListenBrainzTopUpOpts {
  from?: number;     // source artists to snowball from (default 200)
  per?: number;      // similar artists to take per source (default 8)
  limit?: number;    // max NEW artists to queue this call (default 500)
  log?: (msg: string) => void; // optional progress sink (no-op in the pipeline lane)
}

/**
 * Snowball one bounded batch of similar artists off the catalog we already have and
 * queue the NEW ones (source='listenbrainz', source_id=MBID). Idempotent across calls
 * (dedupes against both the catalog and already-queued listenbrainz rows). Returns the
 * number of new artists queued.
 *
 * Note on drift control: snowball *sources* are taken from the artists we already have,
 * so while the catalog is Asian-curated the candidates stay on-genre. The hard backstop
 * against runaway Western drift is the DISCOVER lane's lifetime ceiling (pipeline.ts) plus
 * Wikipedia's region-curated counterweight — not this function.
 */
export async function listenBrainzTopUp(db: DB, opts: ListenBrainzTopUpOpts = {}): Promise<number> {
  const FROM = opts.from ?? 200;
  const PER = opts.per ?? 8;
  const LIMIT = opts.limit ?? 500;
  if (LIMIT <= 0) return 0;

  // CRITICAL: a bare PostgREST .select() is capped at 1000 rows. These two sets are the
  // dedup that stops discovery from re-queuing artists we already own (and haveMbids is also
  // the snowball SEED set below). Un-paginated, they saw only the first 1000 of ~34k artists,
  // so ~97% of the catalog was invisible to the dedup and every top-up re-queued famous
  // already-owned artists (measured 2026-07-10: 323/523 = 62% of a top-up was already-owned).
  // Page through the full set in 1000-row windows.
  // orderBy MUST be a stable (unique) column: PostgREST gives no ordering guarantee across
  // .range() pages without an explicit sort, so an unsorted paginate silently skips AND
  // double-counts rows (verified: it returned 32,476 of 34,359 real rows). Sorting by a
  // unique key makes each page a clean, non-overlapping window.
  async function allColumn(table: string, column: string, source: string, orderBy: string): Promise<string[]> {
    const out: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(column).eq('source', source).order(orderBy).range(from, from + 999);
      if (error) throw new Error(`${table}.${column} page@${from}: ${error.message}`);
      if (!data?.length) break;
      out.push(...data.map((r: any) => r[column] as string));
      if (data.length < 1000) break;
    }
    return out;
  }
  // Artists we already have (MBID) — both the snowball sources and the dedup set.
  // (source,external_id) is unique → external_id is a stable sort key within source.
  const haveMbids = new Set(await allColumn('artist_external_ids', 'external_id', 'musicbrainz', 'external_id'));
  // Already-queued ListenBrainz MBIDs (avoid re-queuing across runs). source_id can repeat
  // across name variants, so sort by the row's unique id instead.
  const queued = new Set((await allColumn('artist_ingestion_queue', 'source_id', 'listenbrainz', 'id')).filter(Boolean));

  // Random sample of FROM sources (not the first N): a fixed window dries up once its
  // neighbours are queued, so we vary it each call to keep discovery productive as the
  // catalog grows.
  const all = [...haveMbids];
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const sources = all.slice(0, FROM);
  const collected = new Map<string, string>(); // mbid → name (dedup this run)

  for (let i = 0; i < sources.length && collected.size < LIMIT; i++) {
    const sims = await similarArtists(sources[i]);
    for (const s of sims.slice(0, PER)) {
      if (!s.artist_mbid || !s.name) continue;
      if (haveMbids.has(s.artist_mbid) || queued.has(s.artist_mbid) || collected.has(s.artist_mbid)) continue;
      collected.set(s.artist_mbid, s.name);
      if (collected.size >= LIMIT) break;
    }
    opts.log?.(`  [lb] [${i + 1}/${sources.length}] +${collected.size} new candidates…`);
  }

  const rows = [...collected].map(([mbid, name]) => ({ name, source: 'listenbrainz', source_id: mbid, status: 'pending' }));
  for (let i = 0; i < rows.length; i += 500) {
    // UNIQUE(name, source) makes this idempotent on name collisions.
    await db.from('artist_ingestion_queue').upsert(rows.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
  }
  return rows.length;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const db = getDB();
  const dry = process.argv.includes('--dry-run');
  const from = num('--from', 200), per = num('--per', 8), limit = num('--limit', 500);
  console.log(`\n  ListenBrainz discovery — from ${from} artists, ${per} similar each, max ${limit} new\n`);
  if (dry) {
    console.log('  [dry-run] not supported for the refactored top-up; run without --dry-run.\n');
    return;
  }
  const n = await listenBrainzTopUp(db, { from, per, limit, log: m => process.stdout.write(`\r${m}`) });
  console.log(`\n\n  queued ${n} new artists (source=listenbrainz)\n`);
}

if (process.argv[1] && process.argv[1].endsWith('mb-discover.ts')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
