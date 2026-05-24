/**
 * Music catalog ingestion script
 *
 * Reads research/research1/korean_serious_music_seed_catalog_315.csv
 * Searches Spotify for each album, fetches full details, upserts to Supabase.
 *
 * Run:      npx tsx --env-file=.env.local scripts/ingest-music.ts
 * Dry run:  npx tsx --env-file=.env.local scripts/ingest-music.ts --dry-run
 * Resume:   re-run the same command — already-processed entries are skipped
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { assertSpotifyCircuitClosed, recordSpotify429 } from './spotify-circuit';

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const RETRY_MODE = process.argv.includes('--retry');  // only process previous not_found entries
const DELAY_MS = 800;          // between Spotify API calls — ~75 req/min, safe under 100
const MATCH_THRESHOLD = 0.45;  // minimum combined score to accept a search result

const CSV_PATH = path.resolve('research/research1/korean_serious_music_seed_catalog_315.csv');
const STATE_PATH = path.resolve('scripts/ingest-state.json');
const OVERRIDES_PATH = path.resolve('scripts/search-overrides.json');

// ── Spotify auth ──────────────────────────────────────────────────────────────

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API = 'https://api.spotify.com/v1';

let tokenCache: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set');
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.value;
}

async function spotifyGet(path: string): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') ?? 5);
    await recordSpotify429(retry, 'ingest-music');
    if (retry > 120) {
      throw new Error(`Spotify 429: rate-limited for ${retry}s — refusing to block; re-run later`);
    }
    console.log(`  [rate limit] waiting ${retry}s…`);
    await sleep(retry * 1000);
    return spotifyGet(path);
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

// ── Matching ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

// Jaccard-only for artists — no substring bonus. Substring containment causes
// "Panic" to score 0.85 against "Widespread Panic", and "The Beatles" to score
// 0.85 against "The Beatles Complete On Ukulele".
function artistSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchScore(
  expectedTitle: string, actualTitle: string,
  expectedArtist: string, actualArtist: string,
): number {
  const titleScore = stringSimilarity(expectedTitle, actualTitle);
  const artistScore = artistSimilarity(expectedArtist, actualArtist);
  // Reject if artist is wrong — no bypass for high title scores.
  // The old `&& titleScore < 0.9` let "My Bloody Valentine|Loveless" match
  // an artist literally named "Loveless" because titleScore was 1.0.
  if (artistScore < 0.25) return 0;
  return titleScore * 0.75 + artistScore * 0.25;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

interface CatalogRow {
  origin: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  priority: string;
  basis: string;
}

function parseCSV(filePath: string): CatalogRow[] {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\r\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), cols[i] ?? ''])) as unknown as CatalogRow;
  });
}

// ── State (resume support) ────────────────────────────────────────────────────

type Status = 'found' | 'not_found' | 'error' | 'skipped';

interface StateEntry {
  status: Status;
  spotifyId?: string;
  title?: string;
  artist?: string;
  similarity?: number;
  error?: string;
}

interface State {
  processed: Record<string, StateEntry>;  // key: "Artist|Album"
}

function loadState(): State {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  }
  return { processed: {} };
}

function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function stateKey(row: CatalogRow): string {
  return `${row.artist}|${row.album}`;
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchAndFetch(row: CatalogRow, overrideQuery?: string): Promise<{
  spotifyId: string;
  title: string;
  artist: string;
  artistId: string | null;
  releaseDate: string | null;
  releaseType: string;
  label: string | null;
  totalTracks: number;
  tracklist: any[];
  genres: string;
  coverUrl: string | null;
  spotifyUrl: string | null;
  similarity: number;
} | null> {
  // Use override query (Korean/native script) if provided, otherwise build structured query
  const query = overrideQuery ?? `album:${row.album} artist:${row.artist}`;
  const encoded = encodeURIComponent(query);

  await sleep(DELAY_MS);
  const searchData = await spotifyGet(`/search?q=${encoded}&type=album&limit=5`);
  const items: any[] = searchData.albums?.items ?? [];

  if (items.length === 0) return null;

  // Score each result by combined title + artist similarity
  const actualArtist = items[0]?.artists?.map((a: any) => a.name).join(', ') ?? '';
  const scored = items.map(item => {
    const itemArtist = item.artists?.map((a: any) => a.name).join(', ') ?? '';
    return {
      item,
      score: matchScore(row.album, item.name, row.artist, itemArtist),
    };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < MATCH_THRESHOLD) return null;

  // Fetch full album detail (needed for tracklist + genres)
  await sleep(DELAY_MS);
  const albumData = await spotifyGet(`/albums/${best.item.id}?market=KR`);

  // Genres: album-level is usually empty on Spotify, fall back to CSV genre
  let genres: string[] = albumData.genres ?? [];
  if (genres.length === 0 && row.genre) {
    genres = row.genre.split('/').map((g: string) => g.trim());
  }

  const albumTypeMap: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', compilation: 'Compilation' };
  let releaseType = albumTypeMap[albumData.album_type] ?? 'Album';
  if (releaseType === 'Single' && (albumData.total_tracks ?? 0) >= 4) releaseType = 'EP';

  const tracklist = (albumData.tracks?.items ?? []).map((t: any) => ({
    position: t.track_number,
    title: t.name,
    durationMs: t.duration_ms ?? null,
    artists: t.artists?.map((a: any) => a.name).join(', ') ?? '',
  }));

  return {
    spotifyId: albumData.id,
    title: albumData.name,
    artist: albumData.artists?.map((a: any) => a.name).join(', ') ?? row.artist,
    artistId: albumData.artists?.[0]?.id ?? null,
    releaseDate: albumData.release_date ?? null,
    releaseType,
    label: albumData.label ?? null,
    totalTracks: albumData.total_tracks ?? tracklist.length,
    tracklist,
    genres: genres.join(','),
    coverUrl: albumData.images?.[0]?.url ?? null,
    spotifyUrl: albumData.external_urls?.spotify ?? null,
    similarity: best.score,
  };
}

async function main() {
  console.log(`\n🎵  sillajuku music ingestion script`);
  if (DRY_RUN) console.log('   [DRY RUN — no DB writes]');
  if (RETRY_MODE) console.log('   [RETRY MODE — only processing previous not_found entries]');
  console.log('');

  await assertSpotifyCircuitClosed();

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const rows = parseCSV(CSV_PATH);
  const overrides: Record<string, { query: string }> = fs.existsSync(OVERRIDES_PATH)
    ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'))
    : {};

  console.log(`   Catalog: ${rows.length} entries | Overrides: ${Object.keys(overrides).length}`);

  const state = loadState();
  const supabase = DRY_RUN ? null : getSupabase();

  // In retry mode: re-queue only previous not_found entries that have an override
  let todo: CatalogRow[];
  if (RETRY_MODE) {
    todo = rows.filter(r => {
      const key = stateKey(r);
      return state.processed[key]?.status === 'not_found';
    });
    // Reset their state so they get re-processed
    todo.forEach(r => delete state.processed[stateKey(r)]);
    console.log(`   Retrying: ${todo.length} not-found entries\n`);
  } else {
    todo = rows.filter(r => !state.processed[stateKey(r)]);
    const already = rows.length - todo.length;
    console.log(`   Already processed: ${already} | Remaining: ${todo.length}\n`);
  }

  let found = 0, notFound = 0, errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    const key = stateKey(row);
    const override = overrides[key];
    const label = `[${i + 1}/${todo.length}] ${row.artist} — ${row.album}`;
    if (override) process.stdout.write(`  ↺  ${label} [override: "${override.query}"]\n`);

    try {
      const result = await searchAndFetch(row, override?.query);

      if (!result) {
        console.log(`  ✗  ${label}`);
        state.processed[key] = { status: 'not_found' };
        notFound++;
      } else {
        const sim = (result.similarity * 100).toFixed(0);
        console.log(`  ✓  ${label}  →  "${result.title}" (${sim}% match)`);

        if (!DRY_RUN && supabase) {
          await supabase.from('releases').upsert({
            id: result.spotifyId,
            title: result.title,
            artist: result.artist,
            artist_id: result.artistId,
            release_date: result.releaseDate,
            release_type: result.releaseType,
            label: result.label,
            total_tracks: result.totalTracks,
            tracklist: result.tracklist,
            genres: result.genres,
            cover_url: result.coverUrl,
            spotify_url: result.spotifyUrl,
            cached_at: new Date().toISOString(),
          }, { onConflict: 'id' });
        }

        state.processed[key] = {
          status: 'found',
          spotifyId: result.spotifyId,
          title: result.title,
          artist: result.artist,
          similarity: result.similarity,
        };
        found++;
      }
    } catch (err: any) {
      console.log(`  !  ${label}  →  ${err.message}`);
      state.processed[key] = { status: 'error', error: err.message };
      errors++;
    }

    // Save state after every 10 entries so progress survives a crash (skip in dry run)
    if (!DRY_RUN && (i + 1) % 10 === 0) saveState(state);
  }

  if (!DRY_RUN) saveState(state);

  // ── Summary ──────────────────────────────────────────────────────────────────
  const total = rows.length;
  const prevFound = Object.values(state.processed).filter(e => e.status === 'found').length;
  const prevNotFound = Object.values(state.processed).filter(e => e.status === 'not_found').length;
  const prevErrors = Object.values(state.processed).filter(e => e.status === 'error').length;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total in catalog : ${total}
  Found & upserted : ${prevFound}
  Not found        : ${prevNotFound}
  Errors           : ${prevErrors}
  State saved to   : ${STATE_PATH}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  if (prevNotFound > 0) {
    console.log('Not found — review and retry manually:');
    Object.entries(state.processed)
      .filter(([, v]) => v.status === 'not_found')
      .forEach(([k]) => console.log(`  • ${k}`));
    console.log('');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
