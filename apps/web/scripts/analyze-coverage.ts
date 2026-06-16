/**
 * One-off catalog coverage analysis. Read-only. Aggregates genre tokens,
 * native_language, decade, and release_type across all releases to surface
 * cultural / genre gaps.
 *
 * npx tsx --env-file=.env.local scripts/analyze-coverage.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase env not set');
const db = createClient(url, key);

// --albums-only restricts the analysis to the recommendable set (Album + EP),
// which is what users actually browse and rate. Singles (66% of raw rows) skew
// every percentage, so composition targets should be judged on this set.
const ALBUMS_ONLY = process.argv.includes('--albums-only');

// Probe keywords for cultures/scenes we want to know coverage for.
// Matched as case-insensitive substrings against the genres token + (separately)
// against native_language for the CJK ones.
const CULTURE_PROBES: Record<string, string[]> = {
  'Latin / Reggaeton':       ['latin', 'reggaeton', 'regional mexican', 'corrido', 'banda', 'salsa', 'bachata', 'cumbia', 'ranchera'],
  'Brazilian / MPB':         ['brazil', 'bossa', 'samba', 'mpb', 'sertanejo', 'forró', 'funk carioca'],
  'African / Afrobeats':     ['afro', 'afrobeat', 'amapiano', 'highlife', 'soukous', 'naija'],
  'Indian / South Asian':    ['bollywood', 'indian', 'hindi', 'punjabi', 'desi', 'bhangra', 'carnatic', 'filmi'],
  'Arabic / MENA':           ['arab', 'arabic', 'rai', 'khaleeji', 'turkish', 'persian'],
  'French / Chanson':        ['french', 'chanson', 'variété', 'francais'],
  'German / Schlager':       ['german', 'schlager', 'krautrock', 'neue deutsche'],
  'Spanish (Spain) / Flamenco': ['flamenco', 'spanish pop', 'rumba'],
  'Caribbean / Reggae':      ['reggae', 'dancehall', 'ska', 'dub', 'soca', 'calypso'],
  'Country / Americana':     ['country', 'americana', 'bluegrass', 'honky'],
  'Chinese / Mandopop':      ['mandopop', 'cantopop', 'c-pop', 'chinese'],
  'SE Asian':                ['thai', 'vietnam', 'indonesia', 'pinoy', 'opm', 'tagalog', 'malay'],
  'Classical':               ['classical', 'orchestra', 'baroque', 'opera', 'symphony'],
  'Jazz':                    ['jazz', 'bebop', 'swing', 'big band'],
  'Electronic / Dance':      ['electronic', 'techno', 'house', 'edm', 'trance', 'drum and bass', 'dubstep'],
  'Metal':                   ['metal', 'metalcore', 'death metal', 'black metal'],
  'Gospel / Christian':      ['gospel', 'christian', 'worship', 'ccm'],
  'Blues':                   ['blues', 'delta blues', 'rhythm and blues'],
};

async function fetchAllColumns(): Promise<{ genres: string; native_language: string | null; release_date: string | null; release_type: string | null }[]> {
  const rows: any[] = [];
  let from = 0;
  while (true) {
    let q = db
      .from('releases')
      .select('genres, native_language, release_date, release_type');
    if (ALBUMS_ONLY) q = q.in('release_type', ['Album', 'EP']);
    const { data, error } = await q.range(from, from + 999);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    process.stdout.write(`\r  fetched ${rows.length.toLocaleString()} rows…`);
    if (data.length < 1000) break;
    from += 1000;
  }
  process.stdout.write('\n');
  return rows;
}

async function main() {
  console.log(`\n  sillajuku catalog coverage analysis${ALBUMS_ONLY ? ' [ALBUMS + EPs ONLY]' : ' [ALL releases incl. singles]'}\n`);
  const rows = await fetchAllColumns();
  const total = rows.length;

  // ── release_type ──
  const byType: Record<string, number> = {};
  for (const r of rows) { const t = (r.release_type ?? 'null'); byType[t] = (byType[t] ?? 0) + 1; }

  // ── native_language ──
  const byLang: Record<string, number> = {};
  for (const r of rows) { const l = r.native_language ?? '(none/latin)'; byLang[l] = (byLang[l] ?? 0) + 1; }

  // ── decade ──
  const byDecade: Record<string, number> = {};
  for (const r of rows) {
    const y = r.release_date ? parseInt(r.release_date.slice(0, 4)) : NaN;
    const d = isNaN(y) ? 'unknown' : `${Math.floor(y / 10) * 10}s`;
    byDecade[d] = (byDecade[d] ?? 0) + 1;
  }

  // ── genre tokens ──
  const tokenCounts: Record<string, number> = {};
  let nullGenre = 0;
  for (const r of rows) {
    if (!r.genres) { nullGenre++; continue; }
    for (const tok of r.genres.toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean)) {
      tokenCounts[tok] = (tokenCounts[tok] ?? 0) + 1;
    }
  }
  const topTokens = Object.entries(tokenCounts).sort((a, b) => b[1] - a[1]).slice(0, 40);

  // ── culture probes ──
  const genreBlob = rows.map(r => (r.genres ?? '').toLowerCase());
  const probeCounts: [string, number][] = Object.entries(CULTURE_PROBES).map(([label, kws]): [string, number] => {
    const n = genreBlob.filter(g => kws.some(k => g.includes(k))).length;
    return [label, n];
  }).sort((a, b) => a[1] - b[1]);

  // ── output ──
  console.log(`  TOTAL releases: ${total.toLocaleString()}\n`);

  console.log('  By release_type:');
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(14)} ${n.toLocaleString().padStart(8)}  ${(100 * n / total).toFixed(1)}%`);
  }

  console.log('\n  By native_language:');
  for (const [l, n] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${l.padEnd(14)} ${n.toLocaleString().padStart(8)}  ${(100 * n / total).toFixed(1)}%`);
  }

  console.log('\n  By decade:');
  for (const [d, n] of Object.entries(byDecade).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${d.padEnd(14)} ${n.toLocaleString().padStart(8)}  ${(100 * n / total).toFixed(1)}%`);
  }

  console.log(`\n  Null genre: ${nullGenre.toLocaleString()} (${(100 * nullGenre / total).toFixed(1)}%)`);
  console.log('\n  Top 40 genre tokens:');
  for (const [tok, n] of topTokens) {
    console.log(`    ${tok.padEnd(26)} ${n.toLocaleString().padStart(8)}`);
  }

  console.log('\n  Culture / scene coverage (releases whose genres match probe keywords), least → most:');
  for (const [label, n] of probeCounts) {
    const bar = '█'.repeat(Math.min(40, Math.round(n / Math.max(1, total) * 400)));
    console.log(`    ${label.padEnd(30)} ${n.toLocaleString().padStart(7)}  ${(100 * n / total).toFixed(2)}%  ${bar}`);
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
