/**
 * Catalog expansion — URGENCY-based discovery (fame first, not region first).
 *
 * Fills the catalog with the most-listened artists we don't have yet, GLOBALLY, so a famous
 * megastar never waits behind an obscure act. Signal = Last.fm charts (mainstream-weighted +
 * MBID-carrying): the worldwide `chart.getTopArtists` plus per-country `geo.getTopArtists` for
 * regional balance (J-pop, Latin, etc.). Ranked by listeners; queued so the FIFO ingest drains
 * most-famous-first (created_at staggered by rank, backdated ahead of the existing tail).
 *
 * Korea is intentionally NOT covered here (Last.fm has no KR chart) — it's handled comprehensively
 * by `discover:area --country=KR`. This engine closes the famous-non-Korean (and globally-charting
 * Korean) gap with priority.
 *
 * Hits Last.fm (fast) + MusicBrainz for the minority of chart entries without an MBID → run during
 * a pipeline pause to avoid MB throttling.
 *
 * SOURCE-AGNOSTIC (2026-07-11): a charting artist MusicBrainz doesn't have is no longer dropped —
 * it's recovered from Deezer (famous-first), so collection priority is POPULARITY, not source.
 * The Deezer ingest is cross-source-dedup + album-cap guarded, so it can't duplicate an MB artist.
 * (Being anti-commercial in taste doesn't mean it's OK to be missing artists people actually look
 * for.) --no-deezer disables that step; --deezer-limit caps it.
 *
 *   npx tsx --env-file=.env.local scripts/discover-popularity.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-popularity.ts --limit=3000 --deezer-limit=200
 */
import { getDB, resolveArtist } from './mb-ingest';
import { pickArtist, ingestDeezerArtist } from './mb-deezer-fallback';
import { searchArtists as dzSearchArtists } from './deezer-client';

const KEY = process.env.LASTFM_API_KEY;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : 3000;
// Source-agnostic popularity: charting artists MB doesn't have are recovered from Deezer, so
// collection priority is POPULARITY, not source. Bounded + confident-match + cross-source-dedup
// guarded (in ingestDeezerArtist). --no-deezer disables; --deezer-limit caps the Deezer work.
const DEEZER = !args.includes('--no-deezer');
const DEEZER_LIMIT = arg('--deezer-limit') ? parseInt(arg('--deezer-limit')!, 10) : 200;
const GLOBAL_PAGES = arg('--global-pages') ? parseInt(arg('--global-pages')!, 10) : 4; // 500/page
const GEO_PAGES = arg('--geo-pages') ? parseInt(arg('--geo-pages')!, 10) : 1;
const BASE = arg('--base') ?? '2018-01-01T00:00:00Z'; // earlier than seed/prestige/tail → famous first
const COUNTRIES = (arg('--countries') ?? [
  'United States', 'United Kingdom', 'Japan', 'Brazil', 'Germany', 'France', 'Mexico', 'Canada',
  'Australia', 'Spain', 'Italy', 'Poland', 'Russian Federation', 'Sweden', 'Netherlands', 'Turkey',
  'Indonesia', 'Philippines', 'India', 'Argentina', 'Chile', 'Colombia', 'Finland', 'Ukraine',
].join('|')).split('|').filter(Boolean);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function lfm(method: string, extra: string): Promise<any> {
  await sleep(250); // polite
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?method=${method}&api_key=${KEY}&format=json&${extra}`);
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

type Cand = { mbid: string | null; name: string; listeners: number };

async function main() {
  if (!KEY) { console.error('LASTFM_API_KEY not set'); process.exit(1); }
  const db = getDB();

  // ── 1. collect chart candidates (global + per-country), keep max listeners per artist ──
  const byKey = new Map<string, Cand>(); // key = mbid || name:normalized
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const add = (a: any) => {
    const mbid = a.mbid || null;
    const listeners = parseInt(a.listeners ?? '0', 10) || 0;
    const key = mbid ? `mb:${mbid.toLowerCase()}` : `nm:${norm(a.name)}`;
    const prev = byKey.get(key);
    if (!prev || listeners > prev.listeners) byKey.set(key, { mbid, name: a.name, listeners });
  };

  for (let p = 1; p <= GLOBAL_PAGES; p++) {
    const j = await lfm('chart.gettopartists', `page=${p}&limit=500`);
    const arts = j?.artists?.artist ?? [];
    if (!arts.length) break;
    arts.forEach(add);
    process.stdout.write(`\r  global page ${p}/${GLOBAL_PAGES}  (${byKey.size} unique)   `);
  }
  for (const c of COUNTRIES) {
    for (let p = 1; p <= GEO_PAGES; p++) {
      const j = await lfm('geo.gettopartists', `country=${encodeURIComponent(c)}&page=${p}&limit=500`);
      const arts = j?.topartists?.artist ?? [];
      if (!arts.length) break;
      arts.forEach(add);
    }
    process.stdout.write(`\r  +${c}  (${byKey.size} unique)                     `);
  }
  console.log(`\n[popularity] ${byKey.size} unique chart artists`);

  // ── 2. resolve the minority without an MBID (unambiguous only) ──
  let cands = [...byKey.values()];
  const needResolve = cands.filter(c => !c.mbid);
  console.log(`  resolving ${needResolve.length} without MBID via MusicBrainz…`);
  let resolved = 0, dropped = 0;
  const nonMb: Cand[] = []; // charting but NOT in MusicBrainz → Deezer-recovery candidates (step 5)
  for (const c of needResolve) {
    const r = await resolveArtist(c.name, null);
    if (r.best && !r.ambiguous) { c.mbid = r.best.id; resolved++; } else { dropped++; nonMb.push(c); }
  }
  cands = cands.filter(c => c.mbid);
  // dedupe by MBID (an artist can chart globally AND in several countries / under name+mbid both)
  const byMbid = new Map<string, Cand>();
  for (const c of cands) { const k = c.mbid!.toLowerCase(); const p = byMbid.get(k); if (!p || c.listeners > p.listeners) byMbid.set(k, c); }
  let ranked = [...byMbid.values()].sort((a, b) => b.listeners - a.listeners);
  console.log(`  ${ranked.length} with MBID (resolved ${resolved}, dropped ${dropped} unresolved)`);

  // ── 3. skip what we already have / already queued ──
  const mbids = ranked.map(c => c.mbid!);
  const have = new Set<string>();
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_external_ids').select('external_id').eq('source', 'musicbrainz').in('external_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) have.add((r as any).external_id);
  }
  const queued = new Set<string>(); // batched .in() — a plain select caps at PostgREST's 1000-row default
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_ingestion_queue').select('source_id').eq('source', 'mbid').in('source_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) queued.add((r as any).source_id);
  }
  ranked = ranked.filter(c => !have.has(c.mbid!) && !queued.has(c.mbid!)).slice(0, LIMIT);

  // ── 4. queue, staggering created_at by rank so the FIFO ingests most-famous-first ──
  const base = new Date(BASE).getTime();
  const usedNames = new Set<string>();
  const rows = ranked.map((c, i) => {
    let name = c.name;
    if (usedNames.has(name.toLowerCase())) name = `${c.name} (${c.mbid!.slice(0, 6)})`;
    usedNames.add(name.toLowerCase());
    return { name, source: 'mbid', source_id: c.mbid!, status: 'pending', created_at: new Date(base + i * 1000).toISOString() };
  });

  console.log(`[popularity] to queue (MusicBrainz): ${rows.length} (famous-first)${DRY ? '  [DRY RUN]' : ''}`);
  if (DRY) console.log('  top 15:', ranked.slice(0, 15).map(c => `${c.name}(${(c.listeners / 1000).toFixed(0)}k)`).join(', '));
  if (!DRY) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('artist_ingestion_queue').upsert(rows.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
      if (error) { console.error(`  ! batch ${i}: ${error.message}`); process.exit(1); }
    }
    const { count } = await db.from('artist_ingestion_queue').select('id', { count: 'exact', head: true }).eq('source', 'mbid').eq('status', 'pending');
    console.log(`[popularity] queued ${rows.length}. Total source='mbid' pending: ${count}. Most-famous drain first.`);
  }

  // ── 5. source-agnostic: charting artists MusicBrainz DOESN'T have → recover from Deezer,
  //       famous-first, so collection priority is popularity (not source). The ingest is
  //       cross-source-dedup + album-cap guarded, so this can't duplicate an MB artist. ──
  if (DEEZER && nonMb.length) {
    const dzRanked = [...nonMb].sort((a, b) => b.listeners - a.listeners).slice(0, DEEZER_LIMIT);
    console.log(`[popularity] ${nonMb.length} charting artists not in MB → trying Deezer (top ${dzRanked.length})${DRY ? '  [DRY RUN]' : ''}…`);
    let dz = 0, skip = 0, none = 0;
    for (const c of dzRanked) {
      const hit = pickArtist(await dzSearchArtists(c.name), c.name);
      if (!hit) { none++; continue; }
      if (DRY) { console.log(`  [dz] ${c.name} (${(c.listeners / 1000).toFixed(0)}k) → Deezer "${hit.name}" (${hit.nbFan} fans, ${hit.nbAlbum} albums)`); dz++; continue; }
      const g = await ingestDeezerArtist(db, hit, null);
      if (g < 0) skip++; else { dz++; console.log(`  [dz] ${c.name} → "${hit.name}" — ${g} groups`); }
    }
    console.log(`[popularity] Deezer: ${dz} ${DRY ? 'matched' : 'ingested/matched'} · ${skip} already in catalog · ${none} no Deezer match`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
