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
 * (Wikipedia breadth is separate: `npm run queue:build:global` already queues
 *  wikipedia_<region> rows that INGEST resolves via MB.)
 */
import { getDB } from './itunes-ingest-core';

const LB_ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const num = (f: string, d: number) => { const a = process.argv.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const FROM = num('--from', 200);
const PER = num('--per', 8);
const LIMIT = num('--limit', 500);
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

async function main() {
  const db = getDB();
  console.log(`\n  ListenBrainz discovery — from ${FROM} artists, ${PER} similar each, max ${LIMIT} new\n`);

  // Artists we already have (MBID) — both the snowball sources and the dedup set.
  const { data: ext } = await db.from('artist_external_ids').select('external_id').eq('source', 'musicbrainz');
  const haveMbids = new Set((ext ?? []).map(r => r.external_id as string));
  // Already-queued ListenBrainz MBIDs (avoid re-queuing across runs).
  const { data: q } = await db.from('artist_ingestion_queue').select('source_id').eq('source', 'listenbrainz');
  const queued = new Set((q ?? []).map(r => r.source_id as string).filter(Boolean));

  const sources = [...haveMbids].slice(0, FROM);
  const collected = new Map<string, string>(); // mbid → name (dedup this run)

  for (let i = 0; i < sources.length && collected.size < LIMIT; i++) {
    const sims = await similarArtists(sources[i]);
    let added = 0;
    for (const s of sims.slice(0, PER)) {
      if (!s.artist_mbid || !s.name) continue;
      if (haveMbids.has(s.artist_mbid) || queued.has(s.artist_mbid) || collected.has(s.artist_mbid)) continue;
      collected.set(s.artist_mbid, s.name);
      added++;
      if (collected.size >= LIMIT) break;
    }
    process.stdout.write(`\r  [${i + 1}/${sources.length}] +${collected.size} new candidates…`);
  }

  const rows = [...collected].map(([mbid, name]) => ({ name, source: 'listenbrainz', source_id: mbid, status: 'pending' }));
  if (rows.length && !process.argv.includes('--dry-run')) {
    // Chunk inserts; UNIQUE(name, source) makes it idempotent on name collisions.
    for (let i = 0; i < rows.length; i += 500) {
      await db.from('artist_ingestion_queue').upsert(rows.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
    }
  }
  console.log(`\n\n  queued ${rows.length} new artists (source=listenbrainz)${process.argv.includes('--dry-run') ? ' [dry run]' : ''}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
