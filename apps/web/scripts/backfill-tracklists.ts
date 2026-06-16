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
 *   2. Otherwise, search iTunes by title+artist to resolve the collection, then
 *      look up its songs (2 calls). Disable with --skip-search.
 *   3. Write the mapped tracklist (and `total_tracks` if it was null).
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
const ITUNES_DELAY = 650;  // stay comfortably below iTunes 429 threshold

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── iTunes ────────────────────────────────────────────────────────────────────

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(ITUNES_DELAY);
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

// Resolve an iTunes collection ID for a release lacking one, via search.
async function findCollectionId(title: string, artist: string): Promise<number | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  const data = await itunesGet(`${ITUNES_BASE}/search?term=${term}&entity=album&limit=5`);
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

// Look up all songs on a collection.
async function fetchTracks(collectionId: number): Promise<Track[]> {
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=300`);
  if (!data) return [];
  return mapTracks(data.results ?? []);
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
  console.log(`  Source: iTunes${SKIP_SEARCH ? ' (itunes_id only)' : ' (itunes_id → search fallback)'}` +
    `${INCLUDE_SINGLES ? '' : ', singles skipped'}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all releases missing a tracklist. `tracklist IS NULL` covers rows that
  // never had one; rows with an empty-array tracklist are filtered in-loop.
  const missing: { id: string; title: string; artist: string; itunes_id: number | null; release_type: string | null; total_tracks: number | null; tracklist: any }[] = [];
  let from = 0;
  while (true) {
    let q = db
      .from('releases')
      .select('id, title, artist, itunes_id, release_type, total_tracks, tracklist')
      .is('tracklist', null);
    if (!INCLUDE_SINGLES) q = q.not('release_type', 'ilike', 'single');
    const { data, error } = await q.range(from, from + 499);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    missing.push(...(data as any));
    if (data.length < 500) break;
    from += 500;
  }

  let todo = missing.filter(r => !state.processedIds.has(r.id));
  if (BATCH_LIMIT !== Infinity) todo = todo.slice(0, BATCH_LIMIT);

  console.log(`  Missing tracklist : ${missing.length}`);
  console.log(`  Already processed : ${missing.length - missing.filter(r => !state.processedIds.has(r.id)).length}`);
  console.log(`  This run          : ${todo.length}\n`);

  const counts = { byId: 0, bySearch: 0, none: 0 };

  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${r.artist.slice(0, 22).padEnd(22)} — ${r.title.slice(0, 28).padEnd(28)} `);

    let tracks: Track[] = [];
    let via: 'byId' | 'bySearch' | null = null;

    if (r.itunes_id) {
      tracks = await fetchTracks(r.itunes_id);
      if (tracks.length > 0) via = 'byId';
    }

    if (tracks.length === 0 && !SKIP_SEARCH) {
      const collectionId = await findCollectionId(r.title, r.artist);
      if (collectionId) {
        tracks = await fetchTracks(collectionId);
        if (tracks.length > 0) {
          via = 'bySearch';
          // Persist the resolved iTunes ID so future lookups skip the search.
          if (!DRY_RUN && !r.itunes_id) {
            await db.from('releases').update({ itunes_id: collectionId }).eq('id', r.id);
          }
        }
      }
    }

    if (tracks.length > 0 && via) {
      counts[via]++;
      process.stdout.write(`✓ ${tracks.length} tracks (${via === 'byId' ? 'id' : 'search'})\n`);
      if (!DRY_RUN) {
        const update: Record<string, any> = { tracklist: tracks };
        if (r.total_tracks == null) update.total_tracks = tracks.length;
        await db.from('releases').update(update).eq('id', r.id);
      }
    } else {
      counts.none++;
      process.stdout.write('no tracks\n');
    }

    state.processedIds.add(r.id);
    if (!DRY_RUN && (i + 1) % 50 === 0) saveState(state);
  }

  if (!DRY_RUN) saveState(state);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Filled via itunes_id : ${counts.byId}
  Filled via search    : ${counts.bySearch}
  No tracks found      : ${counts.none}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
