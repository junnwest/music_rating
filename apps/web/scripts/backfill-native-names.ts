/**
 * Backfill native-language names for existing rows in artists and releases tables.
 * Language-agnostic: works for Korean (ko), Japanese (ja), Chinese (zh), etc.
 *
 * Phase 1 — artists.name_native + artists.native_language via MusicBrainz artist aliases.
 *   Searches for aliases with any CJK locale (ko, ja, zh, etc.).
 *   Rate limit: 1 req/s. Good coverage for all well-known Asian acts.
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
const MB_BASE     = 'https://musicbrainz.org/ws/2';
const ITUNES_BASE = 'https://itunes.apple.com';
const MB_DELAY    = 1100;
const IT_DELAY    = 650;

const LANGUAGE_TO_STORE: Record<string, string> = { ko: 'KR', ja: 'JP', zh: 'TW' };

// ── State ─────────────────────────────────────────────────────────────────────

interface State { artistsDone: string[]; releasesDone: string[] }

function loadState(): State {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { artistsDone: [], releasesDone: [] }; }
}

function saveState(s: State) { writeFileSync(STATE_FILE, JSON.stringify(s)); }

// ── Language helpers ──────────────────────────────────────────────────────────

function detectLanguage(s: string): string | null {
  if (/[가-힣ᄀ-ᇿ]/.test(s)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'zh';
  return null;
}

function hasNativeScript(s: string): boolean { return detectLanguage(s) !== null; }

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── MusicBrainz ───────────────────────────────────────────────────────────────

async function mbGet(path: string, attempt = 0): Promise<any> {
  await sleep(MB_DELAY);
  const res = await fetch(`${MB_BASE}${path}`, {
    headers: {
      'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)',
      'Accept': 'application/json',
    },
  });
  if ((res.status === 503 || res.status === 429) && attempt < 5) {
    const wait = Math.min(30000, 5000 * 2 ** attempt);
    await sleep(wait);
    return mbGet(path, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

async function findNativeArtistName(
  name: string,
): Promise<{ nameNative: string; nativeLanguage: string } | null> {
  const data = await mbGet(
    `/artist?query=artist:"${encodeURIComponent(name)}"&limit=5&fmt=json`,
  );
  if (!data?.artists?.length) return null;

  const normName = normalizeStr(name);
  // Only use an exact name match — never fall back to artists[0], which could be a wrong artist
  const artist = data.artists.find((a: any) => normalizeStr(a.name) === normName);
  if (!artist) return null;

  const pickAlias = (aliases: any[]): { nameNative: string; nativeLanguage: string } | null => {
    for (const a of aliases ?? []) {
      if (!hasNativeScript(a.name ?? '')) continue;
      const lang = detectLanguage(a.name);
      if (lang) return { nameNative: a.name, nativeLanguage: lang };
    }
    return null;
  };

  const fromSearch = pickAlias(artist.aliases);
  if (fromSearch) return fromSearch;

  const full = await mbGet(`/artist/${artist.id}?inc=aliases&fmt=json`);
  return pickAlias(full?.aliases);
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
  console.log('\n  Phase 1 — artists.name_native via MusicBrainz (any CJK language)\n');

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
  console.log('  Only processes releases from known Asian artists (skips Western releases).\n');

  const done = new Set(state.releasesDone);

  // Build a lookup of known Asian artists from phase 1 results
  const { data: asianArtists } = await db
    .from('artists').select('id, name, native_language')
    .not('native_language', 'is', null);

  if (!asianArtists?.length) {
    console.log('  No artists with native_language found. Run phase 1 first.\n');
    return;
  }

  const langById   = new Map(asianArtists.map(a => [a.id,               a.native_language as string]));
  const langByName = new Map(asianArtists.map(a => [a.name.toLowerCase(), a.native_language as string]));

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
