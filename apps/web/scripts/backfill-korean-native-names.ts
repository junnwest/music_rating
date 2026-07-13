/**
 * Backfill Korean native (Hangul) names for KR artists UNFINDABLE by native-script search —
 * those with no Hangul in name / name_native / name_phonetic_ko AND no Hangul alias (FOR WINDOWS
 * #5). Trigger: "시스템서울" (SYSTEM SEOUL) returned nothing. True gap measured at ~56 artists
 * (not the 352 name_native-null headline — most already carry Hangul in `name`).
 *
 * SOURCE = Korean Wikipedia interlanguage links (same high-precision tier as
 * backfill-native-titles-wiki.ts for album titles). MusicBrainz was tried first and rejected:
 * these artists genuinely have NO Hangul alias in MB (verified SHINHWA/EVERGLOW/CRAVITY — only
 * romanized aliases, or none). Wikipedia's `ko` langlink DOES carry it: "Shinhwa" → "신화".
 *
 * THREE STACKED GUARDS so a wrong name can never be written (no-erroneous-data mandate):
 *   1. TITLE match — the EN article's (disambig-stripped) title must equal the artist name.
 *      No fuzzy — a stylized name that doesn't match is skipped, not guessed (missing > wrong).
 *   2. KOREAN-MUSICIAN category — the article must be categorized as a Korean singer/rapper/
 *      group/band/idol, so a generic-name collision ("Seven", "Method") can't map to a wrong
 *      person or a non-musician.
 *   3. HANGUL guard — only write when the ko-langlink is actually Hangul (a genuinely Latin
 *      artist name self-skips).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-korean-native-names.ts            # dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-korean-native-names.ts --write
 */
import { getDB } from './itunes-ingest-core';

const WRITE = process.argv.includes('--write');
const WIKI_BASE = 'https://en.wikipedia.org/w/api.php';
const WIKI_DELAY = 350;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const HANGUL = /[가-힣ᄀ-ᇿㄱ-ㆎ]/;
const hasHangul = (s: string | null | undefined) => !!s && HANGUL.test(s);
const normLoose = (s: string) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

function stripDisambig(t: string): string {
  let s = (t ?? '').trim();
  while (s.endsWith(')')) {
    let depth = 0, i = s.length - 1;
    for (; i >= 0; i--) { if (s[i] === ')') depth++; else if (s[i] === '(') { depth--; if (depth === 0) break; } }
    if (i <= 0 || !/\s$/.test(s.slice(0, i))) break;
    s = s.slice(0, i).trim();
  }
  return s;
}

async function wikiGet(params: Record<string, string>, attempt = 0): Promise<any> {
  await sleep(WIKI_DELAY);
  const url = new URL(WIKI_BASE);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(2000 * 2 ** attempt); return wikiGet(params, attempt + 1); }
  return res.ok ? res.json() : null;
}

// Guard 2: is this article about a KOREAN musician (not a same-named person/thing)?
function isKoreanMusician(cats: string[]): boolean {
  return cats.some(c => /\bk-?pop\b/i.test(c))
      || cats.some(c => /korean|south korea/i.test(c) && /(singer|rapper|musician|band|group|idol|duo|boy band|girl group|hip hop|record producer|songwriter|dj)/i.test(c));
}

/** The Korean-script name for a Latin artist name, or null. Applies all three guards. */
async function findKoArtistName(nameLatin: string): Promise<string | null> {
  const wanted = normLoose(nameLatin);
  if (wanted.length < 2) return null;
  // opensearch = case-tolerant title/prefix match. Full-text `list=search` returns noise and
  // misses stylized all-caps names (our "SHINHWA" is a DIFFERENT page than the band "Shinhwa").
  const os = await wikiGet({ action: 'opensearch', search: nameLatin, limit: '5', namespace: '0' });
  const titles: string[] = Array.isArray(os) ? (os[1] ?? []) : [];
  // Guard 1: an article whose (disambig-stripped) title equals the artist name.
  const title = titles.find(t => normLoose(stripDisambig(t)) === wanted || normLoose(t) === wanted);
  if (!title) return null;

  const meta = await wikiGet({ action: 'query', titles: title, prop: 'langlinks|categories', lllang: 'ko', cllimit: '200', redirects: '1' });
  const page = (Object.values(meta?.query?.pages ?? {}) as any[])[0];
  if (!page || page.missing) return null;
  const cats = (page.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));
  // Guard 2: must be a Korean musician (rejects same-named person/thing collisions).
  if (!isKoreanMusician(cats)) return null;

  const koLink = (page.langlinks ?? []).find((l: any) => l.lang === 'ko');
  if (!koLink) return null;
  const ko = stripDisambig(koLink['*']);
  // Guard 3: only genuinely Korean-script names (a Latin ko-title like "CRAVITY" self-skips).
  return hasHangul(ko) ? ko : null;
}

async function main() {
  const db = getDB();
  console.log(`\n  backfill-korean-native-names ${WRITE ? '[WRITE]' : '[dry-run]'} — source: Korean Wikipedia\n`);

  const { data: kr } = await db.from('artists').select('id, name, name_native, name_phonetic_ko').eq('country', 'KR').limit(1000);
  const cand = (kr ?? []).filter((a: any) => !hasHangul(a.name) && !hasHangul(a.name_native) && !hasHangul(a.name_phonetic_ko));
  // drop those with a Hangul alias (already findable)
  const ids = cand.map((a: any) => a.id);
  const hangulAlias = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('artist_aliases').select('artist_id, alias').in('artist_id', ids.slice(i, i + 200));
    for (const r of data ?? []) if (hasHangul((r as any).alias)) hangulAlias.add((r as any).artist_id);
  }
  const gap = cand.filter((a: any) => !hangulAlias.has(a.id));
  console.log(`  true gap: ${gap.length} KR artists with no Hangul anywhere\n`);

  let filled = 0, noMatch = 0;
  for (const a of gap as any[]) {
    let ko: string | null = null;
    try { ko = await findKoArtistName(a.name); } catch { ko = null; }
    if (ko) {
      filled++;
      console.log(`  ✓  ${a.name.padEnd(24)} → ${ko}`);
      // Write to name_phonetic_ko (search-only), NOT name_native: name_native drives DISPLAY
      // (Hangul-preferred), and showing "에버글로우" instead of "Everglow" would be wrong for a
      // transliteration. phonetic_ko is exactly "what a Korean types to find this artist" — it's
      // matched by search_artists, so it fixes findability without changing what's shown.
      if (WRITE) {
        const { error } = await db.from('artists').update({ name_phonetic_ko: ko }).eq('id', a.id);
        if (error) console.log(`       ! write failed: ${error.message}`);
      }
    } else { noMatch++; console.log(`  –  ${a.name.padEnd(24)} no confident Korean Wikipedia name — leave null`); }
  }
  console.log(`\n  ${WRITE ? 'filled' : 'would fill'} ${filled} · no-match ${noMatch}`);
  console.log(WRITE ? '  (name_phonetic_ko written — Hangul-searchable now, display unchanged)\n' : '  [dry-run] review the ✓ mappings, then re-run with --write.\n');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
