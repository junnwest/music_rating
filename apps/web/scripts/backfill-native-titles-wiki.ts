/**
 * Backfill release_groups.native_title for Korean albums/EPs from Korean Wikipedia interlanguage
 * links — the high-PRECISION tier of the Korean-native-title effort (Task 1 of HANDOFF-WINDOWS.md).
 *
 * For a Korean-artist release whose title we only have in Latin/romanized form, the EN Wikipedia
 * article's `ko` langlink gives the real Korean title (e.g. "A Flower Bookmark" → "꽃갈피"). Public
 * API, no scraping. Wikipedia only covers famous albums — that's fine, they're the high-value ones
 * users actually see, and precision matters far more than coverage here.
 *
 * THREE STACKED GUARDS so a wrong title can never be written (per the "no erroneous data" mandate):
 *   1. EXACT title match — the Wikipedia hit's (disambig-stripped) title must equal ours. No fuzzy.
 *   2. ARTIST-CATEGORY match — the article must be categorized as *this artist's* album/EP/single
 *      (e.g. "IU (entertainer) EPs"), proving it's the right artist's release, not a title collision.
 *   3. HANGUL guard — only write when the ko-langlink actually contains Hangul. Albums with a
 *      genuinely Latin title ("Palette", "Love poem") return Latin and are correctly skipped.
 *
 * Scope: release_groups (album/ep) whose primary artist is Korean-native (native_language='ko') and
 * native_title IS NULL. Resumable/idempotent. Append-only (writes only where native_title IS NULL).
 * DB-write-light; Wikipedia round-trips are the cost.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-wiki.ts --dry-run --limit=40
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-wiki.ts
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const STATE = `${__dirname}/backfill-native-titles-wiki-state.json`;
const WIKI_BASE = 'https://en.wikipedia.org/w/api.php';
const WIKI_DELAY = 350;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hasHangul = (s: string) => /[가-힣]/.test(s);
// loose norm (word chars + single spaces) for title comparison; tight norm (alnum only) for cats.
const normLoose = (s: string) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const normTight = (s: string) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const stripDisambig = (t: string) => t.replace(/\s*\([^)]+\)\s*$/, '').trim();
// Our DB titles sometimes carry a format suffix; try both forms when matching.
const stripFormat = (t: string) => t.replace(/\s*[-–—]\s*(EP|Single|LP|Album)\s*$/i, '').trim();

function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

async function wikiGet(params: Record<string, string>, attempt = 0): Promise<any> {
  await sleep(WIKI_DELAY);
  const url = new URL(WIKI_BASE);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' } });
  // Retry transient rate-limits/server errors so they cause a re-check, not a silent "no match".
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(2000 * 2 ** attempt);
    return wikiGet(params, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

// Guard 2: does any category prove this article is `artistLatin`'s album/EP/single?
function categoryTiesToArtist(cats: string[], artistLatin: string): boolean {
  const a = normTight(artistLatin);
  if (a.length < 2) return false;
  return cats.some(c => normTight(c).startsWith(a) && /\b(album|ep|eps|single|singles)\b/i.test(c));
}

/**
 * Returns the Korean-script title for (title, artistLatin), or null. Applies all three guards.
 */
export async function findKoAlbumTitle(title: string, artistLatin: string): Promise<string | null> {
  const wanted = new Set([normLoose(title), normLoose(stripFormat(title))].filter(Boolean));
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: `${stripFormat(title)} ${artistLatin} album`, srlimit: '6', srnamespace: '0' });
  const results: any[] = search?.query?.search ?? [];
  if (!results.length) return null;

  // Guard 1: exact (disambig-stripped) title match only.
  const hit = results.find(r => wanted.has(normLoose(stripDisambig(r.title))) || wanted.has(normLoose(r.title)));
  if (!hit) return null;

  const meta = await wikiGet({ action: 'query', titles: hit.title, prop: 'langlinks|categories', lllimit: '500', cllimit: '100', redirects: '1' });
  const page = (Object.values(meta?.query?.pages ?? {}) as any[])[0];
  if (!page || page.missing) return null;
  const cats = (page.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));

  // Guard 2: must be categorized as this artist's release.
  if (!categoryTiesToArtist(cats, artistLatin)) return null;

  const koLink = (page.langlinks ?? []).find((l: any) => l.lang === 'ko');
  if (!koLink) return null;
  const ko = stripDisambig(koLink['*']);

  // Guard 3: only accept genuinely Korean-script titles (Latin titles self-skip → no false data).
  return hasHangul(ko) ? ko : null;
}

async function main() {
  console.log(`\n  sillajuku Korean native-title backfill (Wikipedia)${DRY ? ' [DRY RUN]' : ''}\n`);
  const done = loadState();

  // Korean-native artists → their album/EP release groups missing a native title.
  const koIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('artists').select('id').eq('native_language', 'ko').order('id').range(from, from + 999);
    if (!data?.length) break;
    koIds.push(...data.map((a: any) => a.id));
    if (data.length < 1000) break;
  }
  console.log(`  ${koIds.length} Korean-native artists\n`);

  let rows: { id: string; title: string; artist_display: string }[] = [];
  for (let i = 0; i < koIds.length; i += 100) {
    const slice = koIds.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('release_groups')
        .select('id, title, artist_display')
        .in('primary_artist_id', slice)
        .is('native_title', null)
        .in('release_group_type', ['album', 'ep'])
        .order('id').range(from, from + 999);
      if (error) { console.error('fetch error:', error.message); break; }
      if (!data?.length) break;
      rows.push(...(data as any[]));
      if (data.length < 1000) break;
    }
  }
  rows = rows.filter(r => !done.has(r.id) && r.title?.trim() && r.artist_display?.trim());
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`  ${rows.length} album/EP release groups to try\n`);

  let filled = 0, miss = 0, processed = 0;
  for (const r of rows) {
    let ko: string | null = null;
    try { ko = await findKoAlbumTitle(r.title, r.artist_display); } catch { ko = null; }
    processed++;
    if (ko) {
      console.log(`  ✓ ${r.artist_display} — ${r.title}  →  ${ko}`);
      if (!DRY) {
        const { error } = await db.from('release_groups').update({ native_title: ko }).eq('id', r.id).is('native_title', null);
        if (error) console.warn(`    ! ${r.id}: ${error.message}`);
      }
      filled++;
    } else miss++;
    done.add(r.id);
    if (processed % 20 === 0) { if (!DRY) saveState(done); console.log(`  … ${processed}/${rows.length}  filled=${filled}`); }
  }
  if (!DRY) saveState(done);
  console.log(`\n  DONE — processed ${processed}, filled ${filled}, no-match ${miss} (${(100 * filled / Math.max(processed, 1)).toFixed(0)}%)\n`);
}

if (process.argv[1]?.includes('backfill-native-titles-wiki')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
