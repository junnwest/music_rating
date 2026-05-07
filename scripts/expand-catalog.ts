/**
 * Catalog expansion script — three modes:
 *
 *   discography  Fetch full discographies for all artists already in the DB
 *   related      One-hop related artist expansion from all seeded artists
 *   genre        Genre-tag search sweeps for underrepresented areas
 *
 * Run:
 *   npm run expand:discography
 *   npm run expand:related
 *   npm run expand:genre
 *
 * Add --dry-run to preview without writing to DB.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────

const MODE = process.argv.find(a => ['discography', 'related', 'genre'].includes(a)) as
  'discography' | 'related' | 'genre' | undefined;
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 2000;

// Cap how many artists to process per session to stay under Spotify's daily quota.
// Pass --max-artists=50 on the command line to override.
const MAX_ARTISTS_ARG = process.argv.find(a => a.startsWith('--max-artists='));
const MAX_ARTISTS = MAX_ARTISTS_ARG ? parseInt(MAX_ARTISTS_ARG.split('=')[1], 10) : 60;

const STATE_PATH = path.resolve('scripts/expand-state.json');

if (!MODE) {
  console.error('Usage: expand-catalog.ts <discography|related|genre> [--dry-run]');
  process.exit(1);
}

// Follower thresholds for related-artist expansion — keeps quality high
const FOLLOWER_GATES: Record<string, number> = {
  korean: 5_000,
  japanese: 20_000,
  western: 100_000,
  other: 50_000,
};

// Genre sweeps for Phase 3
const GENRE_SWEEPS = [
  { tag: 'korean indie',    origin: 'korean',   minPopularity: 20 },
  { tag: 'k-rap',          origin: 'korean',   minPopularity: 20 },
  { tag: 'korean r&b',     origin: 'korean',   minPopularity: 20 },
  { tag: 'k-pop',          origin: 'korean',   minPopularity: 35 },
  { tag: 'city pop',       origin: 'japanese', minPopularity: 25 },
  { tag: 'j-indie',        origin: 'japanese', minPopularity: 20 },
  { tag: 'math rock',      origin: 'other',    minPopularity: 20 },
  { tag: 'post-rock',      origin: 'other',    minPopularity: 20 },
  { tag: 'neo-soul',       origin: 'western',  minPopularity: 30 },
  { tag: 'jazz rap',       origin: 'western',  minPopularity: 25 },
  { tag: 'shoegaze',       origin: 'other',    minPopularity: 20 },
  { tag: 'dream pop',      origin: 'other',    minPopularity: 20 },
];

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
  if (!res.ok) throw new Error(`Token fetch ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.value;
}

class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(sec: number) {
    super(`RATE_LIMIT:${sec}`);
    this.retryAfterSec = sec;
  }
}

async function spotifyGet(url: string, attempt = 0): Promise<any> {
  const token = await getToken();
  const full = url.startsWith('https://') ? url : `${SPOTIFY_API}${url}`;
  const res = await fetch(full, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const raw = Number(res.headers.get('Retry-After') ?? 5);
    const sec = isNaN(raw) ? 5 : raw;
    // If Spotify wants us to wait more than 2 minutes, or we've retried 3 times, give up
    if (sec > 120 || attempt >= 3) throw new RateLimitError(sec);
    const waitMs = Math.min(sec, 60) * 1000;
    console.log(`  [rate limit] waiting ${waitMs / 1000}s… (attempt ${attempt + 1}/3)`);
    await sleep(waitMs);
    return spotifyGet(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify ${res.status}: ${url} — ${body}`);
  }
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const SKIP_TITLE_PATTERNS = [
  /karaoke/i, /instrumental ver/i, /cover album/i, /tribute/i,
  /노래방/i,   // Korean: karaoke
];

function isCurationPass(album: any): boolean {
  if (SKIP_TITLE_PATTERNS.some(p => p.test(album.name))) return false;
  if (album.album_type === 'compilation') return false;
  // Singles with < 4 tracks are singles, not EPs
  if (album.album_type === 'single' && (album.total_tracks ?? 0) < 4) return false;
  return true;
}

// ── State ─────────────────────────────────────────────────────────────────────

interface ExpandState {
  processedArtists: string[];   // artist IDs we've fetched albums for
  processedGenres: string[];    // genre tags we've swept
}

function loadState(): ExpandState {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return { processedArtists: [], processedGenres: [] };
}

function saveState(s: ExpandState) {
  if (!DRY_RUN) fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadExistingIds(db: ReturnType<typeof getDB>): Promise<{
  releaseIds: Set<string>;
  artistIds: Set<string>;
  artistReleaseYears: Map<string, Set<string>>; // artistId → set of "year"
}> {
  const { data: releases } = await db
    .from('releases')
    .select('id, artist_id, release_date');

  const releaseIds = new Set<string>((releases ?? []).map((r: any) => r.id));
  const artistIds = new Set<string>(
    (releases ?? []).map((r: any) => r.artist_id).filter(Boolean)
  );
  // Track artist+year combos to avoid duplicate remasters
  const artistReleaseYears = new Map<string, Set<string>>();
  for (const r of releases ?? []) {
    if (!r.artist_id || !r.release_date) continue;
    const year = r.release_date.slice(0, 4);
    if (!artistReleaseYears.has(r.artist_id)) artistReleaseYears.set(r.artist_id, new Set());
    artistReleaseYears.get(r.artist_id)!.add(year);
  }

  return { releaseIds, artistIds, artistReleaseYears };
}

// ── Album upsert ──────────────────────────────────────────────────────────────

interface AlbumResult {
  id: string;
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
}

async function fetchFullAlbum(albumId: string, csvGenreFallback = ''): Promise<AlbumResult | null> {
  await sleep(DELAY_MS);
  try {
    const d = await spotifyGet(`/albums/${albumId}?market=KR`);

    let genres: string[] = d.genres ?? [];
    if (genres.length === 0 && csvGenreFallback) {
      genres = [csvGenreFallback];
    }

    const albumTypeMap: Record<string, string> = {
      album: 'Album', single: 'Single', ep: 'EP', compilation: 'Compilation',
    };
    let releaseType = albumTypeMap[d.album_type] ?? 'Album';
    if (releaseType === 'Single' && (d.total_tracks ?? 0) >= 4) releaseType = 'EP';

    const tracklist = (d.tracks?.items ?? []).map((t: any) => ({
      position: t.track_number,
      title: t.name,
      durationMs: t.duration_ms ?? null,
      artists: t.artists?.map((a: any) => a.name).join(', ') ?? '',
    }));

    return {
      id: d.id,
      title: d.name,
      artist: d.artists?.map((a: any) => a.name).join(', ') ?? '',
      artistId: d.artists?.[0]?.id ?? null,
      releaseDate: d.release_date ?? null,
      releaseType,
      label: d.label ?? null,
      totalTracks: d.total_tracks ?? tracklist.length,
      tracklist,
      genres: genres.join(','),
      coverUrl: d.images?.[0]?.url ?? null,
      spotifyUrl: d.external_urls?.spotify ?? null,
    };
  } catch {
    return null;
  }
}

async function upsertAlbum(db: ReturnType<typeof getDB>, album: AlbumResult) {
  await db.from('releases').upsert({
    id: album.id,
    title: album.title,
    artist: album.artist,
    artist_id: album.artistId,
    release_date: album.releaseDate,
    release_type: album.releaseType,
    label: album.label,
    total_tracks: album.totalTracks,
    tracklist: album.tracklist,
    genres: album.genres,
    cover_url: album.coverUrl,
    spotify_url: album.spotifyUrl,
    cached_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}

// ── Fetch all albums for one artist ──────────────────────────────────────────

async function fetchArtistAlbums(artistId: string): Promise<any[]> {
  const items: any[] = [];
  // include_groups=album,single explicitly excludes appears_on and compilation
  let url: string | null = `/artists/${artistId}/albums?include_groups=album,single&limit=50&market=KR`;
  while (url) {
    await sleep(DELAY_MS);
    const data = await spotifyGet(url);
    items.push(...(data.items ?? []));
    url = data.next ?? null;
  }
  return items;
}

// ── MODE: discography ─────────────────────────────────────────────────────────

async function runDiscography(db: ReturnType<typeof getDB>, state: ExpandState) {
  const { releaseIds, artistIds } = await loadExistingIds(db);
  console.log(`   DB: ${releaseIds.size} releases, ${artistIds.size} artists\n`);

  const allTodo = [...artistIds].filter(id => !state.processedArtists.includes(id));
  const todo = allTodo.slice(0, MAX_ARTISTS);
  console.log(`   Artists to expand: ${todo.length} this session (${state.processedArtists.length} already done, ${allTodo.length} total remaining)\n`);

  let added = 0, skipped = 0;

  for (let i = 0; i < todo.length; i++) {
    const artistId = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] artist ${artistId} … `);

    try {
      const albums = await fetchArtistAlbums(artistId);
      const candidates = albums.filter(a =>
        isCurationPass(a) &&
        !releaseIds.has(a.id) &&
        // Guard: target artist must be listed as a primary album artist
        (a.artists ?? []).some((art: any) => art.id === artistId)
      );

      if (candidates.length === 0) {
        process.stdout.write(`no new albums\n`);
      } else {
        process.stdout.write(`${candidates.length} new albums\n`);
        for (const album of candidates) {
          const artistName = album.artists?.map((a: any) => a.name).join(', ') ?? '';
          const artistId = album.artists?.[0]?.id ?? null;
          const albumTypeMap: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', compilation: 'Compilation' };
          let releaseType = albumTypeMap[album.album_type] ?? 'Album';
          if (releaseType === 'Single' && (album.total_tracks ?? 0) >= 4) releaseType = 'EP';
          const year = (album.release_date ?? '').slice(0, 4);

          if (!DRY_RUN) {
            await db.from('releases').upsert({
              id: album.id,
              title: album.name,
              artist: artistName,
              artist_id: artistId,
              release_date: album.release_date ?? null,
              release_type: releaseType,
              total_tracks: album.total_tracks ?? null,
              cover_url: album.images?.[0]?.url ?? null,
              spotify_url: `https://open.spotify.com/album/${album.id}`,
              cached_at: new Date().toISOString(),
            }, { onConflict: 'id' });
          }

          releaseIds.add(album.id);
          console.log(`      + "${album.name}" — ${artistName} (${year})`);
          added++;
        }
      }

      state.processedArtists.push(artistId);
      saveState(state);
    } catch (err: any) {
      if (err instanceof RateLimitError) {
        const mins = Math.ceil(err.retryAfterSec / 60);
        process.stdout.write(`\n\n  ⚠  Spotify rate limit hit (Retry-After: ${err.retryAfterSec}s).\n`);
        console.log(`     Wait at least ${mins} minute${mins !== 1 ? 's' : ''} before re-running.\n`);
        console.log(`     Progress saved — re-running will resume from this point.\n`);
        saveState(state);
        return { added, skipped };
      }
      process.stdout.write(`error: ${err.message}\n`);
    }
  }

  return { added, skipped };
}

// ── MODE: related ─────────────────────────────────────────────────────────────

function guessOrigin(genres: string[]): keyof typeof FOLLOWER_GATES {
  const g = genres.join(' ').toLowerCase();
  if (g.includes('k-pop') || g.includes('korean') || g.includes('k-rap') || g.includes('k-indie')) return 'korean';
  if (g.includes('j-pop') || g.includes('japanese') || g.includes('city pop') || g.includes('anime')) return 'japanese';
  if (g.includes('afrobeat') || g.includes('latin') || g.includes('bossa')) return 'other';
  return 'western';
}

async function runRelated(db: ReturnType<typeof getDB>, state: ExpandState) {
  const { releaseIds, artistIds } = await loadExistingIds(db);
  console.log(`   DB: ${releaseIds.size} releases, ${artistIds.size} seed artists\n`);

  // Collect related artists from all seeds
  const relatedMap = new Map<string, any>(); // id → artist object
  const seedList = [...artistIds];

  console.log(`   Fetching related artists (one hop from ${seedList.length} seeds)…\n`);

  for (let i = 0; i < seedList.length; i++) {
    const seedId = seedList[i];
    if (state.processedArtists.includes(`related:${seedId}`)) continue;
    try {
      await sleep(DELAY_MS);
      const data = await spotifyGet(`/artists/${seedId}/related-artists`);
      for (const a of data.artists ?? []) {
        if (!artistIds.has(a.id) && !relatedMap.has(a.id)) {
          relatedMap.set(a.id, a);
        }
      }
      state.processedArtists.push(`related:${seedId}`);
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r   Seeds processed: ${i + 1}/${seedList.length} — ${relatedMap.size} related found`);
        saveState(state);
      }
    } catch { /* skip on error */ }
  }
  console.log(`\n\n   Related artists found: ${relatedMap.size}`);

  // Apply follower gates
  const qualified = [...relatedMap.values()].filter(a => {
    const origin = guessOrigin(a.genres ?? []);
    return (a.followers?.total ?? 0) >= FOLLOWER_GATES[origin];
  });
  console.log(`   After follower gates: ${qualified.length}\n`);

  let added = 0;

  for (let i = 0; i < qualified.length; i++) {
    const artist = qualified[i];
    const origin = guessOrigin(artist.genres ?? []);
    process.stdout.write(`  [${i + 1}/${qualified.length}] ${artist.name} (${(artist.followers?.total ?? 0).toLocaleString()} followers, ${origin}) … `);

    if (state.processedArtists.includes(`albums:${artist.id}`)) {
      process.stdout.write(`already processed\n`);
      continue;
    }

    try {
      const albums = await fetchArtistAlbums(artist.id);
      const candidates = albums.filter(a =>
        isCurationPass(a) &&
        !releaseIds.has(a.id) &&
        (a.artists ?? []).some((art: any) => art.id === artist.id)
      );

      if (candidates.length === 0) {
        process.stdout.write(`no new albums\n`);
      } else {
        process.stdout.write(`${candidates.length} new\n`);
        for (const album of candidates) {
          const full = await fetchFullAlbum(album.id);
          if (!full) continue;
          if (!DRY_RUN) await upsertAlbum(db, full);
          releaseIds.add(album.id);
          console.log(`      + "${full.title}" (${full.releaseDate?.slice(0, 4) ?? '?'})`);
          added++;
        }
      }

      state.processedArtists.push(`albums:${artist.id}`);
      saveState(state);
    } catch (err: any) {
      process.stdout.write(`error: ${err.message}\n`);
    }
  }

  return { added };
}

// ── MODE: genre ───────────────────────────────────────────────────────────────

async function runGenre(db: ReturnType<typeof getDB>, state: ExpandState) {
  const { releaseIds } = await loadExistingIds(db);
  console.log(`   DB: ${releaseIds.size} existing releases\n`);

  const todo = GENRE_SWEEPS.filter(s => !state.processedGenres.includes(s.tag));
  console.log(`   Genre sweeps: ${todo.length} remaining\n`);

  let added = 0;

  for (const sweep of todo) {
    console.log(`  ── genre: "${sweep.tag}" (min popularity ${sweep.minPopularity}) ──`);
    const seen = new Set<string>();

    for (let offset = 0; offset < 200; offset += 50) {
      await sleep(DELAY_MS);
      try {
        const data = await spotifyGet(
          `/search?q=genre:"${encodeURIComponent(sweep.tag)}"&type=album&limit=50&offset=${offset}&market=KR`
        );
        const items: any[] = data.albums?.items ?? [];
        if (items.length === 0) break;

        for (const album of items) {
          if (seen.has(album.id) || releaseIds.has(album.id)) continue;
          if (!isCurationPass(album)) continue;
          if ((album.popularity ?? 0) < sweep.minPopularity) continue;
          seen.add(album.id);

          const full = await fetchFullAlbum(album.id, sweep.tag);
          if (!full) continue;
          if (!DRY_RUN) await upsertAlbum(db, full);
          releaseIds.add(album.id);
          console.log(`      + "${full.title}" — ${full.artist} (pop: ${album.popularity})`);
          added++;
        }
      } catch (err: any) {
        console.log(`      error at offset ${offset}: ${err.message}`);
        break;
      }
    }

    state.processedGenres.push(sweep.tag);
    saveState(state);
    console.log('');
  }

  return { added };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎵  sillajuku catalog expansion — mode: ${MODE}`);
  if (DRY_RUN) console.log('   [DRY RUN — no DB writes]');
  console.log('');

  const db = getDB();
  const state = loadState();

  // Canary call — fail fast if still rate limited
  try {
    process.stdout.write('   Checking Spotify access… ');
    await spotifyGet('/search?q=test&type=artist&limit=1');
    console.log('OK\n');
  } catch (err: any) {
    if (err instanceof RateLimitError) {
      const mins = Math.ceil(err.retryAfterSec / 60);
      console.log(`RATE LIMITED\n\n  Spotify is still rate limiting this app. Wait ${mins} minute${mins !== 1 ? 's' : ''} and try again.\n`);
    } else {
      console.log(`FAILED — ${err.message}\n`);
    }
    process.exit(1);
  }

  let result: { added: number };

  if (MODE === 'discography') result = await runDiscography(db, state);
  else if (MODE === 'related')    result = await runRelated(db, state);
  else                            result = await runGenre(db, state);

  saveState(state);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mode    : ${MODE}
  Added   : ${result.added} albums${DRY_RUN ? ' (dry run — not written)' : ''}
  State   : ${STATE_PATH}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
