/**
 * Catalog status dashboard — read-only. Run anytime to watch expansion progress.
 *
 *   npx tsx --env-file=.env.local scripts/catalog-status.ts
 *
 * Reports:
 *   • Ingestion queue: rows by status, and per-region (source) with releases added
 *   • Artists: total in the catalog
 *   • Releases: total + by type (Album / EP / Single / Live / Compilation)
 *   • Releases by country signal: native_language (exact) + region (genre-keyword approx)
 *   • Releases by genre family (genre-keyword approx)
 *
 * Country/region for releases is approximate: there is no country column, so we
 * use native_language (precise but sparse) plus genre-keyword buckets (broad).
 * All release breakdowns use COUNT-only queries (head:true) so this stays fast
 * even at ~350k rows — backed by the genres GIN trigram index.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase env not set');
const db = createClient(url, key);

const RELEASE_TYPES = ['Album', 'EP', 'Single', 'Live', 'Compilation'];

// Region buckets via genre keywords (broad, overlapping — approximation only).
const REGION_KEYWORDS: Record<string, string[]> = {
  korea:      ['k-pop', 'korean', 'k-rap', 'k-indie', 'k-r&b', 'k-ballad', 'trot'],
  japan:      ['j-pop', 'j-rock', 'japanese', 'city pop', 'anime', 'visual kei'],
  china:      ['mandopop', 'cantopop', 'c-pop', 'chinese'],
  sea:        ['thai', 'vietnam', 'indonesia', 'pinoy', 'opm', 'malay', 'tagalog'],
  south_asia: ['bollywood', 'indian', 'hindi', 'punjabi', 'bhangra', 'desi'],
  latin:      ['latin', 'reggaeton', 'urbano latino'],
  brazil:     ['brazil', 'bossa', 'samba', 'mpb', 'baile funk'],
  africa:     ['afro', 'amapiano', 'highlife', 'soukous'],
  france:     ['french', 'chanson'],
};

// Genre families via keywords (broad, overlapping — e.g. "pop" matches k/j-pop).
const GENRE_KEYWORDS: Record<string, string[]> = {
  pop:         ['pop'],
  rock:        ['rock'],
  'hip-hop':   ['hip-hop', 'hip hop', 'rap'],
  'r&b/soul':  ['r&b', 'soul', 'neo-soul'],
  electronic:  ['electronic', 'house', 'techno', 'trance', 'edm'],
  jazz:        ['jazz'],
  classical:   ['classical', 'orchestra', 'baroque'],
  folk:        ['folk', 'singer-songwriter'],
  country:     ['country', 'americana'],
  metal:       ['metal'],
  punk:        ['punk'],
  reggae:      ['reggae', 'dancehall', 'ska'],
  funk:        ['funk', 'disco'],
};

async function total(): Promise<number> {
  const { count } = await db.from('releases').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

async function countType(t: string): Promise<number> {
  const { count } = await db.from('releases').select('*', { count: 'exact', head: true }).eq('release_type', t);
  return count ?? 0;
}

async function countLang(lang: string | null): Promise<number> {
  let q = db.from('releases').select('*', { count: 'exact', head: true });
  q = lang === null ? q.is('native_language', null) : q.eq('native_language', lang);
  const { count } = await q;
  return count ?? 0;
}

// COUNT of releases whose genres match any of the keywords (ILIKE substring).
async function countGenre(keywords: string[]): Promise<number> {
  const orStr = keywords.map(k => `genres.ilike.*${k}*`).join(',');
  const { count, error } = await db.from('releases').select('*', { count: 'exact', head: true }).or(orStr);
  if (error) { process.stderr.write(`  [warn] genre count failed for [${keywords.join('|')}]: ${error.message}\n`); return 0; }
  return count ?? 0;
}

async function countArtists(): Promise<number> {
  const { count } = await db.from('artists').select('*', { count: 'exact', head: true });
  return count ?? 0;
}

interface QueueRow { status: string | null; source: string | null; releases_added: number | null }
async function fetchQueue(): Promise<QueueRow[]> {
  const rows: QueueRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('artist_ingestion_queue')
      .select('status, source, releases_added')
      .range(from, from + 999);
    if (error) { console.error('queue fetch error:', error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...(data as any));
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

function bar(n: number, max: number, width = 30): string {
  if (max <= 0) return '';
  return '█'.repeat(Math.max(0, Math.round((n / max) * width)));
}

function pct(n: number, d: number): string {
  return d > 0 ? `${(100 * n / d).toFixed(1)}%` : '—';
}

async function main() {
  console.log('\n  ══════════ sillajuku catalog status ══════════\n');

  // ── Queue ──
  const queue = await fetchQueue();
  const byStatus: Record<string, number> = {};
  const byRegion: Record<string, { queued: number; done: number; releases: number }> = {};
  for (const r of queue) {
    const s = r.status ?? 'null';
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    const region = (r.source ?? 'unknown')
      .replace('wikipedia_', '')
      .replace('wikipedia', 'korea(seed)')
      .replace('lastfm_global', 'lastfm(global)')
      .replace('lastfm_similar', 'lastfm(legacy)');
    byRegion[region] ??= { queued: 0, done: 0, releases: 0 };
    byRegion[region].queued++;
    if (r.status === 'done') byRegion[region].done++;
    byRegion[region].releases += r.releases_added ?? 0;
  }

  console.log('  INGESTION QUEUE');
  console.log(`    total rows: ${queue.length.toLocaleString()}`);
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${s.padEnd(12)} ${n.toLocaleString().padStart(8)}`);
  }
  console.log('\n    by source / region        queued     done   releases');
  for (const [r, v] of Object.entries(byRegion).sort((a, b) => b[1].releases - a[1].releases)) {
    console.log(`      ${r.padEnd(20)} ${v.queued.toLocaleString().padStart(8)} ${v.done.toLocaleString().padStart(8)} ${v.releases.toLocaleString().padStart(10)}`);
  }

  // ── Artists ──
  const artists = await countArtists();
  console.log(`\n  ARTISTS (in catalog): ${artists.toLocaleString()}`);

  // ── Releases by type ──
  const tot = await total();
  const typeCounts = await Promise.all(RELEASE_TYPES.map(countType));
  console.log(`\n  RELEASES (total): ${tot.toLocaleString()}`);
  RELEASE_TYPES.forEach((t, i) => {
    console.log(`      ${t.padEnd(12)} ${typeCounts[i].toLocaleString().padStart(8)}  ${pct(typeCounts[i], tot)}`);
  });
  const recommendable = typeCounts[0] + typeCounts[1];
  console.log(`      ${'(Album+EP)'.padEnd(12)} ${recommendable.toLocaleString().padStart(8)}  ${pct(recommendable, tot)}`);

  // ── Releases by native_language ──
  const [ko, ja, zh, nullLang] = await Promise.all([countLang('ko'), countLang('ja'), countLang('zh'), countLang(null)]);
  console.log('\n  RELEASES by native_language (precise, but sparsely tagged)');
  console.log(`      ko ${ko.toLocaleString()}   ja ${ja.toLocaleString()}   zh ${zh.toLocaleString()}   none/latin ${nullLang.toLocaleString()}`);

  // ── Releases by region (genre-keyword approx) ──
  const regionEntries = Object.entries(REGION_KEYWORDS);
  const regionCounts = await Promise.all(regionEntries.map(([, kws]) => countGenre(kws)));
  const regionPairs = regionEntries.map(([name], i) => [name, regionCounts[i]] as [string, number]).sort((a, b) => b[1] - a[1]);
  const regionMax = Math.max(...regionPairs.map(p => p[1]), 1);
  console.log('\n  RELEASES by region (genre-keyword approx; overlaps possible)');
  for (const [name, n] of regionPairs) {
    console.log(`      ${name.padEnd(12)} ${n.toLocaleString().padStart(8)}  ${pct(n, tot).padStart(6)}  ${bar(n, regionMax)}`);
  }

  // ── Releases by genre family (genre-keyword approx) ──
  const genreEntries = Object.entries(GENRE_KEYWORDS);
  const genreCounts = await Promise.all(genreEntries.map(([, kws]) => countGenre(kws)));
  const genrePairs = genreEntries.map(([name], i) => [name, genreCounts[i]] as [string, number]).sort((a, b) => b[1] - a[1]);
  const genreMax = Math.max(...genrePairs.map(p => p[1]), 1);
  console.log('\n  RELEASES by genre family (genre-keyword approx; overlaps possible)');
  for (const [name, n] of genrePairs) {
    console.log(`      ${name.padEnd(12)} ${n.toLocaleString().padStart(8)}  ${pct(n, tot).padStart(6)}  ${bar(n, genreMax)}`);
  }

  console.log('\n  ══════════════════════════════════════════════\n');
}

main().catch(e => { console.error(e); process.exit(1); });
