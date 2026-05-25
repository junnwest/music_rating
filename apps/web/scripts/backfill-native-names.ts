/**
 * Backfill native-language names for existing rows in artists and releases tables.
 * Language-agnostic: works for any non-Latin script (Korean, Japanese, Chinese,
 * Arabic, Thai, Hindi, Cyrillic, Hebrew, Greek, etc.).
 *
 * Phase 1 — artists.name_native + artists.native_language via Wikipedia langlinks.
 *   For each artist, looks up the English Wikipedia article, fetches all language links,
 *   and picks the first non-Latin-script title. Priority: ko > ja > zh > any other detected script.
 *   Rate limit: ~2 requests per artist (search + langlinks), 350ms delay each.
 *   Much better coverage than MusicBrainz for non-Western artists.
 *
 * Phase 2 — releases.title_native + releases.artist_native + releases.native_language
 *   via iTunes local-store search. Only processes releases from artists whose
 *   name_native is already set (from phase 1) — Western releases are skipped entirely.
 *   Derives the correct iTunes store country from the artist's native_language.
 *   Rate limit: 650ms/req with exponential backoff on 429/403.
 *
 * Safe to re-run — skips rows that already have native names.
 * State saved to scripts/backfill-native-names-state.json after every 20 records.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-native-names.ts
 *   npx tsx --env-file=.env.local scripts/backfill-native-names.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-native-names.ts --phase=1
 *   npx tsx --env-file=.env.local scripts/backfill-native-names.ts --phase=2
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const DRY_RUN   = process.argv.includes('--dry-run');
const PHASE_ARG = process.argv.find(a => a.startsWith('--phase='))?.split('=')[1];
const RUN_P1    = !PHASE_ARG || PHASE_ARG === '1';
const RUN_P2    = !PHASE_ARG || PHASE_ARG === '2';

const STATE_FILE  = 'scripts/backfill-native-names-state.json';
const WIKI_BASE   = 'https://en.wikipedia.org/w/api.php';
const ITUNES_BASE = 'https://itunes.apple.com';
const WIKI_DELAY  = 350;  // two calls per artist → ~700ms effective
const IT_DELAY    = 650;

// iTunes store per language — extend as new markets are added
const LANGUAGE_TO_STORE: Record<string, string> = { ko: 'KR', ja: 'JP', zh: 'TW' };

// Language priority when multiple non-Latin scripts exist for one artist
const LANG_PRIORITY = ['ko', 'ja', 'zh'];

// ── State ─────────────────────────────────────────────────────────────────────

interface State { artistsDone: string[]; releasesDone: string[] }

function loadState(): State {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { artistsDone: [], releasesDone: [] }; }
}

function saveState(s: State) { writeFileSync(STATE_FILE, JSON.stringify(s)); }

// ── Language helpers ──────────────────────────────────────────────────────────

function detectLanguage(s: string): string | null {
  if (/[가-힣ᄀ-ᇿ]/.test(s))         return 'ko'; // Hangul
  if (/[぀-ゟ゠-ヿ]/.test(s))         return 'ja'; // Hiragana / Katakana (uniquely Japanese)
  if (/[一-鿿]/.test(s))              return 'zh'; // CJK unified (ja already caught above)
  if (/[؀-ۿ]/.test(s))      return 'ar'; // Arabic
  if (/[ऀ-ॿ]/.test(s))      return 'hi'; // Devanagari (Hindi, etc.)
  if (/[฀-๿]/.test(s))      return 'th'; // Thai
  if (/[Ѐ-ӿ]/.test(s))      return 'ru'; // Cyrillic (Russian, Ukrainian, etc.)
  if (/[֐-׿]/.test(s))      return 'he'; // Hebrew
  if (/[Ͱ-Ͽ]/.test(s))      return 'el'; // Greek
  return null;
}

function hasNativeScript(s: string): boolean { return detectLanguage(s) !== null; }

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Wikipedia ─────────────────────────────────────────────────────────────────

async function wikiGet(params: Record<string, string>): Promise<any> {
  await sleep(WIKI_DELAY);
  const url = new URL(WIKI_BASE);
  Object.entries({ ...params, format: 'json', origin: '*' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' },
  });
  if (!res.ok) return null;
  return res.json();
}

// Strip Wikipedia disambiguation suffixes: "이적 (가수)" → "이적", "JT (曖昧さ回避)" → "JT"
function stripDisambig(title: string): string {
  return title.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function pickLanglink(
  links: { lang: string; title: string }[],
): { nameNative: string; nativeLanguage: string } | null {
  // Only accept languages in LANG_PRIORITY — no fallback to arbitrary scripts.
  // Extend LANG_PRIORITY when adding new markets.
  for (const lang of LANG_PRIORITY) {
    const link = links.find(l => l.lang === lang);
    if (!link) continue;
    const name = stripDisambig(link.title);
    if (hasNativeScript(name)) return { nameNative: name, nativeLanguage: lang };
  }
  return null;
}

// Wikipedia category patterns. No \b word boundaries — plurals ("singers", "bands",
// "groups") must match. "concept" omitted intentionally (matches "concept albums").
const MUSIC_CATEGORY_RE = /singer|rapper|band|group|musician|hip.?hop|k.?pop|j.?pop|vocalist|duo|trio|quartet|discograph|album|song/i;
const FALSE_POSITIVE_CATEGORY_RE = /buddh|religion|hindu|virtue|plant|species|genus|food|dish|cuisine|writing.?system|alphabet|calligraph|numeral|\byear\b|century/i;

function categoriesAreMusicArtist(cats: string[]): boolean | null {
  if (!cats.length) return null; // unknown
  const catStr = cats.join(' ');
  if (MUSIC_CATEGORY_RE.test(catStr)) return true;
  if (FALSE_POSITIVE_CATEGORY_RE.test(catStr)) return false;
  return null; // ambiguous
}

async function findNativeArtistName(
  name: string,
): Promise<{ nameNative: string; nativeLanguage: string } | null> {
  // Step 1: direct title lookup — fetch langlinks + categories in one request.
  const directData = await wikiGet({
    action: 'query',
    titles: name,
    prop: 'langlinks|categories',
    lllimit: '500',
    cllimit: '50',
  });
  const directPages = Object.values(directData?.query?.pages ?? {}) as any[];
  const directPage  = directPages[0];

  if (directPage && !directPage.missing) {
    const links = (directPage.langlinks ?? []).map((l: any) => ({ lang: l.lang, title: l['*'] }));
    const cats  = (directPage.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));
    const result = pickLanglink(links);

    const isDisambig = /disambigu/i.test(cats.join(' '));

    if (result) {
      const isMusic = categoriesAreMusicArtist(cats);
      if (isMusic === true && !isDisambig) return result; // confirmed music article
      if (isMusic === false) return null;                 // confirmed non-music concept
      // ambiguous OR disambiguation page → fall through to music-biased search
    }

    // No LANG_PRIORITY result. Return null (Western artist) only when the page has
    // langlinks AND is not a disambiguation page. Disambiguation pages with langlinks
    // (IU, EXO, SHINee…) must fall through so we can find the specific artist article.
    if (links.length > 0 && !isDisambig) return null;
  }

  // Step 2: article missing OR disambiguation page (no langlinks) → search Wikipedia.
  // Bias the query toward music articles so "Nirvana" → "Nirvana (band)" not "열반 concept".
  const searchData = await wikiGet({
    action: 'query',
    list: 'search',
    srsearch: `${name} singer OR band OR musician OR rapper`,
    srlimit: '5',
    srnamespace: '0',
  });
  const results: any[] = searchData?.query?.search ?? [];
  if (!results.length) return null;

  const normName        = normalizeStr(name);
  const normNameNoSpace = normName.replace(/\s/g, '');

  // Require the search result title to match our artist name (with or without spaces).
  // "BIGBANG" → matches "Big Bang (South Korean band)" via no-space comparison.
  // No results[0] fallback — a wrong first result is worse than no match.
  const hit =
    results.find(r => normalizeStr(r.title) === normName) ??
    results.find(r => normalizeStr(stripDisambig(r.title)) === normName) ??
    results.find(r => normalizeStr(stripDisambig(r.title)).replace(/\s/g, '') === normNameNoSpace) ??
    results.find(r => normalizeStr(r.title).replace(/\s/g, '') === normNameNoSpace);

  if (!hit) return null;

  // Fetch langlinks + categories for the found article in one request.
  const hitData = await wikiGet({
    action: 'query',
    titles: hit.title,
    prop: 'langlinks|categories',
    lllimit: '500',
    cllimit: '50',
  });
  const hitPages = Object.values(hitData?.query?.pages ?? {}) as any[];
  const hitPage  = hitPages[0];
  if (!hitPage) return null;

  const hitLinks = (hitPage.langlinks ?? []).map((l: any) => ({ lang: l.lang, title: l['*'] }));
  const hitCats  = (hitPage.categories ?? []).map((c: any) => (c.title as string).replace(/^Category:/, ''));

  const isMusic = categoriesAreMusicArtist(hitCats);
  if (isMusic === false) return null;

  return pickLanglink(hitLinks);
}

// ── iTunes local store ────────────────────────────────────────────────────────

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(IT_DELAY);
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-backfill/1.0' } });
  if (res.status === 429 || res.status === 403) {
    const wait = Math.min(120000, 10000 * 2 ** attempt);
    process.stdout.write(`\n  [${res.status}] iTunes blocked — waiting ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 5) return null;
    return itunesGet(url, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

async function findNativeReleaseName(
  title: string,
  artist: string,
  storeCountry: string,
): Promise<{ titleNative: string; artistNative: string; nativeLanguage: string } | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  const data = await itunesGet(
    `${ITUNES_BASE}/search?term=${term}&entity=album&country=${storeCountry}&limit=5`,
  );
  if (!data?.results?.length) return null;

  const normTitle  = normalizeStr(title);
  const normArtist = normalizeStr(artist);
  const match = data.results.find((r: any) =>
    r.wrapperType === 'collection' &&
    (normalizeStr(r.collectionName) === normTitle || normalizeStr(r.artistName) === normArtist),
  );
  if (!match) return null;

  const titleNative  = match.collectionName ?? '';
  const artistNative = match.artistName ?? '';
  const lang = detectLanguage(titleNative) ?? detectLanguage(artistNative);
  if (!lang) return null;

  return {
    titleNative:    hasNativeScript(titleNative)  ? titleNative  : title,
    artistNative:   hasNativeScript(artistNative) ? artistNative : artist,
    nativeLanguage: lang,
  };
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// ── Phase 1: artists ──────────────────────────────────────────────────────────

async function phase1(db: ReturnType<typeof getDB>, state: State) {
  console.log('\n  Phase 1 — artists.name_native via Wikipedia langlinks\n');

  const done = new Set(state.artistsDone);
  let from = 0;
  const BATCH = 200;
  let fixed = 0, skipped = 0, notFound = 0;

  while (true) {
    const { data, error } = await db
      .from('artists').select('id, name')
      .is('name_native', null)
      .range(from, from + BATCH - 1);

    if (error) { console.error('DB error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (done.has(row.id)) { skipped++; continue; }

      process.stdout.write(`  [artist] ${row.name.padEnd(35)} `);
      const result = await findNativeArtistName(row.name);

      if (result) {
        process.stdout.write(`→ ${result.nameNative} (${result.nativeLanguage})\n`);
        if (!DRY_RUN) {
          await db.from('artists').update({
            name_native:     result.nameNative,
            native_language: result.nativeLanguage,
          }).eq('id', row.id);
        }
        fixed++;
      } else {
        process.stdout.write('no match\n');
        notFound++;
      }

      done.add(row.id);
      state.artistsDone = [...done];
      if ((fixed + notFound) % 20 === 0) saveState(state);
    }

    if (data.length < BATCH) break;
    from += BATCH;
  }

  saveState(state);
  console.log(`\n  Artists: ${fixed} native names found, ${notFound} no match, ${skipped} already done\n`);
}

// ── Phase 2: releases ─────────────────────────────────────────────────────────

async function phase2(db: ReturnType<typeof getDB>, state: State) {
  console.log('\n  Phase 2 — releases native names via iTunes local store\n');
  console.log('  Only processes releases from known non-Latin-script artists.\n');

  const done = new Set(state.releasesDone);

  const { data: nativeArtists } = await db
    .from('artists').select('id, name, native_language')
    .not('native_language', 'is', null);

  if (!nativeArtists?.length) {
    console.log('  No artists with native_language found. Run phase 1 first.\n');
    return;
  }

  const langById   = new Map(nativeArtists.map(a => [a.id,                a.native_language as string]));
  const langByName = new Map(nativeArtists.map(a => [a.name.toLowerCase(), a.native_language as string]));

  let from = 0;
  const BATCH = 500;
  let fixed = 0, skipped = 0, notFound = 0;

  while (true) {
    const { data, error } = await db
      .from('releases').select('id, title, artist, artist_id')
      .is('title_native', null)
      .not('release_type', 'ilike', 'single')
      .range(from, from + BATCH - 1);

    if (error) { console.error('DB error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (done.has(row.id)) { skipped++; continue; }

      const lang =
        (row.artist_id ? langById.get(row.artist_id) : undefined) ??
        langByName.get(row.artist.toLowerCase());

      if (!lang || !LANGUAGE_TO_STORE[lang]) {
        skipped++;
        done.add(row.id);
        continue;
      }

      process.stdout.write(
        `  [release] ${row.artist.slice(0, 18).padEnd(20)} — ${row.title.slice(0, 28).padEnd(30)} `,
      );
      const result = await findNativeReleaseName(row.title, row.artist, LANGUAGE_TO_STORE[lang]);

      if (result) {
        process.stdout.write(`→ ${result.titleNative} (${result.nativeLanguage})\n`);
        if (!DRY_RUN) {
          await db.from('releases').update({
            title_native:    result.titleNative,
            artist_native:   result.artistNative,
            native_language: result.nativeLanguage,
          }).eq('id', row.id);
        }
        fixed++;
      } else {
        process.stdout.write('no match\n');
        notFound++;
      }

      done.add(row.id);
      state.releasesDone = [...done];
      if ((fixed + notFound) % 20 === 0) saveState(state);
    }

    if (data.length < BATCH) break;
    from += BATCH;
  }

  saveState(state);
  console.log(`\n  Releases: ${fixed} native names found, ${notFound} no match, ${skipped} skipped (Western/unknown)\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n  sillajuku native name backfill${DRY_RUN ? ' [DRY RUN]' : ''}${PHASE_ARG ? ` [phase ${PHASE_ARG}]` : ''}\n`,
  );
  const db    = getDB();
  const state = loadState();
  if (RUN_P1) await phase1(db, state);
  if (RUN_P2) await phase2(db, state);
  console.log('  Done.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
