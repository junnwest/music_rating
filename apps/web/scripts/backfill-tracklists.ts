/**
 * Tracklist backfill — fills the `tracklist` column for releases that have none.
 *
 * Background: the catalog is mostly iTunes-sourced, and the iTunes queue ingest
 * stores only `total_tracks` (the count), never the actual track list. The album
 * page hides its tracklist section when `tracklist` is empty, so those albums
 * render without a tracklist. This backfill fetches the songs from iTunes and
 * writes them into `tracklist` in the same shape the album page already renders
 * (`{ position, title, durationMs, artists }[]` — matches the Spotify path).
 *
 * Per release:
 *   1. If the row has an `itunes_id`, look up its songs directly (1 call).
 *      Falls back to regional iTunes stores when US returns empty (KR/JP/TW/IN).
 *   2. Otherwise, search iTunes by title+artist to resolve the collection, then
 *      look up its songs (2 calls). Disable with --skip-search.
 *      Regional store search tried as fallback based on `native_language`.
 *   3. Write the mapped tracklist (and `total_tracks` if it was null).
 *
 * State file behaviour:
 *   - Releases without a tracklist that have `itunes_id` are ALWAYS retried,
 *     even if they are in the state file — the itunes_id may have been set by
 *     a later ingest enrichment pass, making a previously-failed lookup succeed.
 *   - Releases without `itunes_id` that are already in the state file are
 *     skipped (search already attempted and failed).
 *
 * No Spotify. No auth. No API key. Only iTunes throttling (650ms/req + backoff).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-tracklists.ts
 *   npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --limit=500
 *   npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --include-singles
 *   npx tsx --env-file=.env.local scripts/backfill-tracklists.ts --skip-search
 *
 * Singles are skipped by default (a single's tracklist is not worth the call).
 * Resumable — state file tracks processed IDs.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN         = process.argv.includes('--dry-run');
const INCLUDE_SINGLES = process.argv.includes('--include-singles');
const SKIP_SEARCH     = process.argv.includes('--skip-search');
const LIMIT_ARG       = process.argv.find(a => a.startsWith('--limit='));
const BATCH_LIMIT     = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : Infinity;
const STATE_PATH      = path.resolve('scripts/backfill-tracklists-state.json');

const ITUNES_BASE  = 'https://itunes.apple.com';
// Modest delay + the 429 backoff below is enough; the main cause of the "no
// tracks" gap was NOT throttling — it was region mismatch. The song-lookup
// endpoint requires the album to be available in the QUERIED store, and a huge
// share of releases (Brazilian, Japanese, German, French…) simply aren't in the
// US store, so a US-only lookup returned nothing. Fixed by trying a broad
// storefront rotation below (FALLBACK_STORES).
const ITUNES_DELAY = 800; // base; jitter added per request in itunesGet()

// iTunes collection IDs are global, but song-lookup requires the album to be in
// the queried store. native_language biases the most-likely stores to the front
// so the common case hits early.
const LANG_TO_STORES: Record<string, string[]> = {
  ko: ['KR'],
  ja: ['JP'],
  zh: ['TW', 'CN', 'HK'],
  hi: ['IN'],
  te: ['IN'],
  ta: ['IN'],
  id: ['ID'],
  th: ['TH'],
  vi: ['VN'],
};

// Broad storefront rotation, tried (after US + any native_language stores) when
// a lookup/search comes up empty — stop at the first store that returns songs.
// Probing showed many region-locked albums resolve in ANY non-US store while a
// few need a specific one (e.g., a German album only in MX), so we sweep all
// real markets ordered by size. Coverage over speed (per the near-100% goal).
const FALLBACK_STORES = [
  'GB', 'DE', 'JP', 'FR', 'BR', 'CA', 'AU', 'MX', 'IT', 'ES', 'KR', 'NL',
  'RU', 'IN', 'SE', 'TR', 'PL', 'ID', 'TH', 'VN', 'PH', 'TW', 'HK', 'CN',
  'AR', 'CL', 'CO', 'PT', 'BE', 'CH', 'AT', 'IE', 'NZ', 'ZA', 'NG', 'SA',
  'AE', 'EG', 'GR', 'NO', 'DK', 'FI', 'MY', 'SG',
];

// US is tried separately first; this returns the de-duped fallback order.
function orderedStores(nativeLang: string | null): string[] {
  const front = nativeLang ? (LANG_TO_STORES[nativeLang] ?? []) : [];
  const seen = new Set<string>(['US']);
  const out: string[] = [];
  for (const s of [...front, ...FALLBACK_STORES]) {
    if (!seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── iTunes ────────────────────────────────────────────────────────────────────

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(ITUNES_DELAY + Math.floor(Math.random() * 500)); // jitter avoids lockstep bursts
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-tracklist-backfill/1.0' } });
    if (res.status === 429 || res.status === 403) {
      const wait = Math.min(120000, 10000 * 2 ** attempt);
      process.stdout.write(`[iTunes ${res.status} wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 5 ? itunesGet(url, attempt + 1) : null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function normalizeStr(s: string): string {
  return s.toLowerCase()
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Track = { position: number; title: string; durationMs: number | null; artists: string };

// Maps an iTunes lookup-with-songs response to the album page's tracklist shape.
// Handles multi-disc albums (track numbers repeat per disc) by falling back to a
// sequential running position so keys stay unique.
function mapTracks(results: any[]): Track[] {
  const songs = results.filter(r => r.wrapperType === 'track' && r.kind === 'song' && r.trackName);
  if (songs.length === 0) return [];
  songs.sort((a, b) =>
    ((a.discNumber ?? 1) - (b.discNumber ?? 1)) || ((a.trackNumber ?? 0) - (b.trackNumber ?? 0)),
  );
  const multiDisc = new Set(songs.map(s => s.discNumber ?? 1)).size > 1;
  return songs.map((s, i) => ({
    position:   multiDisc ? i + 1 : (s.trackNumber ?? i + 1),
    title:      s.trackName,
    durationMs: s.trackTimeMillis ?? null,
    artists:    s.artistName ?? '',
  }));
}

// Look up all songs on a collection in a specific store (defaults to US).
async function fetchTracksInStore(collectionId: number, country?: string): Promise<Track[]> {
  const countryParam = country ? `&country=${country}` : '';
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=300${countryParam}`);
  if (!data) return [];
  return mapTracks(data.results ?? []);
}

// Try US store first, then sweep the full storefront rotation. Stop at first hit.
async function fetchTracksWithFallback(collectionId: number, nativeLang: string | null): Promise<{ tracks: Track[]; store: string }> {
  const tracks = await fetchTracksInStore(collectionId);
  if (tracks.length > 0) return { tracks, store: 'US' };

  for (const store of orderedStores(nativeLang)) {
    const regional = await fetchTracksInStore(collectionId, store);
    if (regional.length > 0) return { tracks: regional, store };
  }

  return { tracks: [], store: '' };
}

// Search for a collection ID in a specific store (defaults to US).
async function findCollectionIdInStore(title: string, artist: string, country?: string): Promise<number | null> {
  const countryParam = country ? `&country=${country}` : '';
  const term = encodeURIComponent(`${title} ${artist}`);
  const data = await itunesGet(`${ITUNES_BASE}/search?term=${term}&entity=album&limit=5${countryParam}`);
  if (!data) return null;
  const results: any[] = data.results ?? [];
  const normTitle  = normalizeStr(title);
  const normArtist = normalizeStr(artist);
  const match =
    results.find(r =>
      normalizeStr(r.collectionName ?? '') === normTitle &&
      normalizeStr(r.artistName ?? '') === normArtist,
    ) ??
    results.find(r => normalizeStr(r.collectionName ?? '') === normTitle) ??
    results[0];
  return match?.collectionId ?? null;
}

// Try US store search first, then sweep the full storefront rotation.
async function findCollectionIdWithFallback(title: string, artist: string, nativeLang: string | null): Promise<{ id: number; store: string } | null> {
  const id = await findCollectionIdInStore(title, artist);
  if (id) return { id, store: 'US' };

  for (const store of orderedStores(nativeLang)) {
    const regionalId = await findCollectionIdInStore(title, artist, store);
    if (regionalId) return { id: regionalId, store };
  }

  return null;
}

// ── State ─────────────────────────────────────────────────────────────────────

interface State { processedIds: Set<string> }

function loadState(): State {
  if (fs.existsSync(STATE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { processedIds: new Set(raw.processedIds ?? []) };
  }
  return { processedIds: new Set() };
}

function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedIds: [...state.processedIds] }, null, 2));
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku tracklist backfill${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  Source: iTunes (US + regional fallback)${SKIP_SEARCH ? ', itunes_id only' : ''}` +
    `${INCLUDE_SINGLES ? '' : ', singles skipped'}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all releases missing a tracklist.
  const missing: {
    id: string;
    title: string;
    artist: string;
    itunes_id: number | null;
    release_type: string | null;
    total_tracks: number | null;
    native_language: string | null;
  }[] = [];
  let from = 0;
  while (true) {
    let q = db
      .from('releases')
      .select('id, title, artist, itunes_id, release_type, total_tracks, native_language')
      .is('tracklist', null);
    if (!INCLUDE_SINGLES) q = q.not('release_type', 'ilike', 'single');
    const { data, error } = await q.range(from, from + 499);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    missing.push(...(data as any));
    if (data.length < 500) break;
    from += 500;
  }

  // Always retry releases that have itunes_id even if previously processed —
  // the itunes_id may have been set by a later enrichment pass, so the lookup
  // that previously failed with "no tracks" may now succeed.
  const todo = missing.filter(r =>
    r.itunes_id !== null || !state.processedIds.has(r.id)
  );
  const cappedTodo = BATCH_LIMIT !== Infinity ? todo.slice(0, BATCH_LIMIT) : todo;

  const skipped = missing.length - todo.length;
  console.log(`  Missing tracklist : ${missing.length}`);
  console.log(`  Skipped (no id, already tried) : ${skipped}`);
  console.log(`  This run          : ${cappedTodo.length}\n`);

  const counts = { byId: 0, bySearch: 0, none: 0, regionalFallback: 0 };

  for (let i = 0; i < cappedTodo.length; i++) {
    const r = cappedTodo[i];
    process.stdout.write(`  [${i + 1}/${cappedTodo.length}] ${r.artist.slice(0, 22).padEnd(22)} — ${r.title.slice(0, 28).padEnd(28)} `);

    let tracks: Track[] = [];
    let via: 'byId' | 'bySearch' | null = null;
    let store = '';

    if (r.itunes_id) {
      const result = await fetchTracksWithFallback(r.itunes_id, r.native_language);
      tracks = result.tracks;
      store  = result.store;
      if (tracks.length > 0) via = 'byId';
    }

    if (tracks.length === 0 && !SKIP_SEARCH) {
      const found = await findCollectionIdWithFallback(r.title, r.artist, r.native_language);
      if (found) {
        const result = await fetchTracksWithFallback(found.id, r.native_language);
        tracks = result.tracks;
        store  = result.store || found.store;
        if (tracks.length > 0) {
          via = 'bySearch';
          if (!DRY_RUN && !r.itunes_id) {
            await db.from('releases').update({ itunes_id: found.id }).eq('id', r.id);
          }
        }
      }
    }

    if (tracks.length > 0 && via) {
      const isRegional = store !== 'US' && store !== '';
      if (isRegional) counts.regionalFallback++;
      if (via === 'byId') counts.byId++; else counts.bySearch++;
      process.stdout.write(`✓ ${tracks.length} tracks (${via === 'byId' ? 'id' : 'search'}${isRegional ? ` ${store}` : ''})\n`);
      if (!DRY_RUN) {
        const update: Record<string, any> = { tracklist: tracks };
        if (r.total_tracks == null) update.total_tracks = tracks.length;
        await db.from('releases').update(update).eq('id', r.id);
      }
    } else {
      counts.none++;
      process.stdout.write('no tracks\n');
    }

    // Only add to state when we have no itunes_id (search-only path) so that
    // id-based lookups are always retried on the next run.
    if (!r.itunes_id) state.processedIds.add(r.id);
    if (!DRY_RUN && (i + 1) % 50 === 0) saveState(state);
  }

  if (!DRY_RUN) saveState(state);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Filled via itunes_id   : ${counts.byId}
  Filled via search      : ${counts.bySearch}
    of which regional    : ${counts.regionalFallback}
  No tracks found        : ${counts.none}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
