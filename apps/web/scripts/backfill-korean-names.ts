/**
 * Backfill Korean names for existing rows in artists and releases tables.
 *
 * Two-phase approach:
 *   Phase 1 — artists.name_ko via MusicBrainz artist aliases (locale: "ko")
 *             Rate limit: 1 req/s. Good coverage for all well-known Korean acts.
 *
 *   Phase 2 — releases.title_ko + releases.artist_ko via iTunes KR store search
 *             Searches iTunes country=KR for each release with no Korean title.
 *             Only writes if the result contains Hangul.
 *             Rate limit: 650ms/req with exponential backoff on 429/403.
 *
 * Safe to re-run — skips rows that already have Korean names.
 * State saved to scripts/backfill-korean-names-state.json after every 20 records.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-korean-names.ts
 *   npx tsx --env-file=.env.local scripts/backfill-korean-names.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-korean-names.ts --phase=1  (artists only)
 *   npx tsx --env-file=.env.local scripts/backfill-korean-names.ts --phase=2  (releases only)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const DRY_RUN   = process.argv.includes('--dry-run');
const PHASE_ARG = process.argv.find(a => a.startsWith('--phase='))?.split('=')[1];
const RUN_P1    = !PHASE_ARG || PHASE_ARG === '1';
const RUN_P2    = !PHASE_ARG || PHASE_ARG === '2';

const STATE_FILE = 'scripts/backfill-korean-names-state.json';
const MB_BASE    = 'https://musicbrainz.org/ws/2';
const ITUNES_BASE = 'https://itunes.apple.com';
const MB_DELAY   = 1100;  // MusicBrainz: 1 req/s hard limit
const IT_DELAY   = 650;

// ── State ─────────────────────────────────────────────────────────────────────

interface State {
  artistsDone: string[];
  releasesDone: string[];
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { artistsDone: [], releasesDone: [] };
  }
}

function saveState(s: State) {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function hasHangul(s: string): boolean {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(s);
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── MusicBrainz ───────────────────────────────────────────────────────────────

async function mbGet(path: string): Promise<any> {
  await sleep(MB_DELAY);
  const res = await fetch(`${MB_BASE}${path}`, {
    headers: {
      'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)',
      'Accept': 'application/json',
    },
  });
  if (res.status === 503 || res.status === 429) {
    await sleep(10000);
    return mbGet(path);
  }
  if (!res.ok) return null;
  return res.json();
}

async function findKoreanArtistName(name: string): Promise<string | null> {
  const data = await mbGet(`/artist?query=artist:"${encodeURIComponent(name)}"&limit=5&fmt=json`);
  if (!data?.artists?.length) return null;

  const normName = normalizeStr(name);
  const artist =
    data.artists.find((a: any) => normalizeStr(a.name) === normName) ??
    data.artists[0];

  if (!artist) return null;

  // Check aliases with locale "ko"
  const koAlias = artist.aliases?.find(
    (a: any) => a.locale === 'ko' || (a.locale?.startsWith('ko') && hasHangul(a.name ?? ''))
  );
  if (koAlias?.name && hasHangul(koAlias.name)) return koAlias.name;

  // Fallback: fetch full artist record with aliases
  const full = await mbGet(`/artist/${artist.id}?inc=aliases&fmt=json`);
  const fullAlias = full?.aliases?.find(
    (a: any) => a.locale === 'ko' && hasHangul(a.name ?? '')
  );
  return fullAlias?.name ?? null;
}

// ── iTunes KR ─────────────────────────────────────────────────────────────────

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

async function findKoreanReleaseName(
  title: string,
  artist: string
): Promise<{ titleKo: string; artistKo: string } | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  const data = await itunesGet(
    `${ITUNES_BASE}/search?term=${term}&entity=album&country=KR&limit=5`
  );
  if (!data?.results?.length) return null;

  const normTitle  = normalizeStr(title);
  const normArtist = normalizeStr(artist);

  const match = data.results.find((r: any) =>
    r.wrapperType === 'collection' &&
    (normalizeStr(r.collectionName) === normTitle || normalizeStr(r.artistName) === normArtist)
  );

  if (!match) return null;

  const titleKo  = match.collectionName ?? '';
  const artistKo = match.artistName ?? '';

  if (!hasHangul(titleKo) && !hasHangul(artistKo)) return null;

  return {
    titleKo:  hasHangul(titleKo)  ? titleKo  : title,
    artistKo: hasHangul(artistKo) ? artistKo : artist,
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
  console.log('\n  Phase 1 — artists.name_ko via MusicBrainz\n');

  const done = new Set(state.artistsDone);
  let from = 0;
  const BATCH = 200;
  let fixed = 0, skipped = 0, notFound = 0;

  while (true) {
    const { data, error } = await db
      .from('artists')
      .select('id, name')
      .is('name_ko', null)
      .range(from, from + BATCH - 1);

    if (error) { console.error('DB error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (done.has(row.id)) { skipped++; continue; }

      process.stdout.write(`  [artist] ${row.name.padEnd(35)} `);
      const nameKo = await findKoreanArtistName(row.name);

      if (nameKo) {
        process.stdout.write(`→ ${nameKo}\n`);
        if (!DRY_RUN) {
          await db.from('artists').update({ name_ko: nameKo }).eq('id', row.id);
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
  console.log(`\n  Artists: ${fixed} Korean names found, ${notFound} no match, ${skipped} already done\n`);
}

// ── Phase 2: releases ─────────────────────────────────────────────────────────

async function phase2(db: ReturnType<typeof getDB>, state: State) {
  console.log('\n  Phase 2 — releases.title_ko + artist_ko via iTunes KR store\n');

  const done = new Set(state.releasesDone);
  let from = 0;
  const BATCH = 500;
  let fixed = 0, skipped = 0, notFound = 0;

  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist')
      .is('title_ko', null)
      .not('release_type', 'ilike', 'single')
      .range(from, from + BATCH - 1);

    if (error) { console.error('DB error:', error.message); break; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (done.has(row.id)) { skipped++; continue; }

      process.stdout.write(`  [release] ${row.artist.slice(0, 20).padEnd(22)} — ${row.title.slice(0, 30).padEnd(32)} `);
      const koNames = await findKoreanReleaseName(row.title, row.artist);

      if (koNames) {
        process.stdout.write(`→ ${koNames.titleKo}\n`);
        if (!DRY_RUN) {
          await db.from('releases').update({
            title_ko:  koNames.titleKo,
            artist_ko: koNames.artistKo,
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
  console.log(`\n  Releases: ${fixed} Korean names found, ${notFound} no match, ${skipped} already done\n`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku Korean name backfill${DRY_RUN ? ' [DRY RUN]' : ''}${PHASE_ARG ? ` [phase ${PHASE_ARG}]` : ''}\n`);

  const db    = getDB();
  const state = loadState();

  if (RUN_P1) await phase1(db, state);
  if (RUN_P2) await phase2(db, state);

  console.log('  Done.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
