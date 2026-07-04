/**
 * Backfill artists.name_phonetic_ko — the standard Korean phonetic spelling of an artist's name,
 * so Korean users can find non-Korean artists by how they'd type them (e.g. "드레이크" → Drake).
 *
 * Source: Korean Wikipedia interlanguage links. For each artist we look up the English Wikipedia
 * article and take its `ko` langlink title — that IS the convention Koreans use ("Drake (musician)"
 * → "드레이크 (음악가)" → strip disambig → "드레이크"). Public API, no scraping. Same request shape and
 * politeness (User-Agent + delay) as backfill-native-names.ts.
 *
 * Scope: artists that are NOT already Korean-native (native_language IS DISTINCT FROM 'ko'). A
 * genuinely-Korean artist's name_native is already their Korean spelling and search matches it;
 * phonetic_ko is for everyone else (Western, Japanese, Chinese …) whose native identity isn't Hangul.
 * We only store a result that is actually Hangul, and we reuse the music-category guard so "Nirvana"
 * resolves to the band, not the Buddhist concept.
 *
 * Idempotent + resumable — skips rows already processed (state file) or already filled. Ordered by
 * popularity desc so famous artists get done first. DB writes are single-row UPDATEs (~negligible IO
 * vs the ingest pipeline); the cost is Wikipedia round-trips, not Supabase.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-phonetic-ko.ts --dry-run --limit=30
 *   npx tsx --env-file=.env.local scripts/backfill-phonetic-ko.ts
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const STATE = `${__dirname}/backfill-phonetic-ko-state.json`;
const WIKI_BASE = 'https://en.wikipedia.org/w/api.php';
const WIKI_DELAY = 350; // two calls per artist → ~700ms effective, well under Wikipedia limits

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasHangul = (s: string) => /[가-힣]/.test(s);
const normalizeStr = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
// Strip Wikipedia disambiguation suffixes: "드레이크 (음악가)" → "드레이크", "위켄드 (가수)" → "위켄드".
// Balanced-paren aware so NESTED disambiguators are removed too — "I am ((여자)아이들의 EP)" → "I am"
// (which then fails the Hangul guard and is correctly rejected, not written as a dirty native value).
function stripDisambig(t: string): string {
  let s = (t ?? '').trim();
  while (s.endsWith(')')) {
    let depth = 0, i = s.length - 1;
    for (; i >= 0; i--) {
      if (s[i] === ')') depth++;
      else if (s[i] === '(') { depth--; if (depth === 0) break; }
    }
    if (i <= 0 || !/\s$/.test(s.slice(0, i))) break; // no matching '(' or it isn't a trailing suffix
    s = s.slice(0, i).trim();
  }
  return s;
}

function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

async function wikiGet(params: Record<string, string>): Promise<any> {
  await sleep(WIKI_DELAY);
  const url = new URL(WIKI_BASE);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' } });
  if (!res.ok) return null;
  return res.json();
}

// Same category heuristic as backfill-native-names — bias to the music article, reject concepts.
const MUSIC_RE = /singer|rapper|band|group|musician|hip.?hop|k.?pop|j.?pop|vocalist|duo|trio|quartet|discograph|album|song/i;
const FALSE_POS_RE = /buddh|religion|hindu|virtue|plant|species|genus|food|dish|cuisine|writing.?system|alphabet|calligraph|numeral|\byear\b|century/i;
function categoriesAreMusicArtist(cats: string[]): boolean | null {
  if (!cats.length) return null;
  const s = cats.join(' ');
  if (MUSIC_RE.test(s)) return true;
  if (FALSE_POS_RE.test(s)) return false;
  return null;
}

function pickKo(links: { lang: string; title: string }[]): string | null {
  const link = links.find(l => l.lang === 'ko');
  if (!link) return null;
  const name = stripDisambig(link.title);
  return hasHangul(name) ? name : null;
}

// Returns the Korean phonetic spelling for `name`, or null. Mirrors findNativeArtistName's two-step
// (direct title → music-biased search fallback) but keeps only the `ko` langlink.
export async function findKoPhonetic(name: string): Promise<string | null> {
  const direct = await wikiGet({ action: 'query', titles: name, prop: 'langlinks|categories', lllimit: '500', cllimit: '50', redirects: '1' });
  const dPage = (Object.values(direct?.query?.pages ?? {}) as any[])[0];

  if (dPage && !dPage.missing) {
    const links = (dPage.langlinks ?? []).map((l: any) => ({ lang: l.lang, title: l['*'] }));
    const cats = (dPage.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));
    const isDisambig = /disambigu/i.test(cats.join(' '));
    const ko = pickKo(links);
    if (ko) {
      const isMusic = categoriesAreMusicArtist(cats);
      if (isMusic === true && !isDisambig) return ko;
      if (isMusic === false) return null;
      // ambiguous / disambiguation page → fall through to search
    }
    // Has langlinks but no ko (or non-Hangul ko), and it's a real (non-disambig) article → no match.
    if (links.length > 0 && !isDisambig) return null;
  }

  const search = await wikiGet({ action: 'query', list: 'search', srsearch: `${name} singer OR band OR musician OR rapper`, srlimit: '5', srnamespace: '0' });
  const results: any[] = search?.query?.search ?? [];
  if (!results.length) return null;

  const nn = normalizeStr(name), nnNoSpace = nn.replace(/\s/g, '');
  const hit =
    results.find(r => normalizeStr(r.title) === nn) ??
    results.find(r => normalizeStr(stripDisambig(r.title)) === nn) ??
    results.find(r => normalizeStr(stripDisambig(r.title)).replace(/\s/g, '') === nnNoSpace) ??
    results.find(r => normalizeStr(r.title).replace(/\s/g, '') === nnNoSpace);
  if (!hit) return null;

  const hd = await wikiGet({ action: 'query', titles: hit.title, prop: 'langlinks|categories', lllimit: '500', cllimit: '50' });
  const hPage = (Object.values(hd?.query?.pages ?? {}) as any[])[0];
  if (!hPage) return null;
  const hLinks = (hPage.langlinks ?? []).map((l: any) => ({ lang: l.lang, title: l['*'] }));
  const hCats = (hPage.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));
  if (categoriesAreMusicArtist(hCats) === false) return null;
  return pickKo(hLinks);
}

async function main() {
  console.log(`\n  sillajuku Korean phonetic backfill${DRY ? ' [DRY RUN]' : ''}\n`);
  const done = loadState();

  // Non-Korean-native artists missing a phonetic rendering, famous first.
  const PAGE = 1000;
  let rows: { id: string; name: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    // Stable PK order → correct pagination (the filter column is written during the run, but the
    // full fetch completes before any write). Popularity is mostly null for MB-ingested artists, so
    // it can't prioritize the famous ones — a full pass covers everyone regardless.
    const { data, error } = await db.from('artists')
      .select('id, name')
      .is('name_phonetic_ko', null)
      .or('native_language.is.null,native_language.neq.ko')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  rows = rows.filter(r => !done.has(r.id) && r.name?.trim());
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`  ${rows.length} artists to try (non-ko-native, no phonetic yet)\n`);

  let fixed = 0, miss = 0, processed = 0;
  for (const r of rows) {
    process.stdout.write(`  ${r.name.slice(0, 34).padEnd(36)} `);
    let ko: string | null = null;
    try { ko = await findKoPhonetic(r.name); } catch { ko = null; }
    processed++;
    if (ko) {
      process.stdout.write(`→ ${ko}\n`);
      if (!DRY) {
        const { error } = await db.from('artists').update({ name_phonetic_ko: ko }).eq('id', r.id).is('name_phonetic_ko', null);
        if (error) console.warn(`    ! ${r.id}: ${error.message}`);
      }
      fixed++;
    } else { process.stdout.write('no match\n'); miss++; }
    done.add(r.id);
    if (processed % 20 === 0 && !DRY) saveState(done);
  }
  if (!DRY) saveState(done);
  console.log(`\n  DONE — processed ${processed}, filled ${fixed}, no-match ${miss} (${(100 * fixed / Math.max(processed, 1)).toFixed(0)}%)\n`);
}
// Only run when invoked directly (not when imported by a test harness).
if (process.argv[1]?.includes('backfill-phonetic-ko')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
