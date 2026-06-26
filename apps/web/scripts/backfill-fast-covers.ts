/**
 * Replace slow Cover Art Archive URLs with fast iTunes/Spotify CDN URLs.
 *
 * CAA (coverartarchive.org) takes 1.5–2.5 s per image due to redirects
 * through archive.org servers. iTunes CDN takes ~0.35 s, Spotify ~0.1 s.
 *
 * This script:
 *   1. Fetches all release_groups where cover_url contains 'coverartarchive'
 *   2. For each, tries iTunes Search API first (free, no auth)
 *   3. Falls back to Spotify album search
 *   4. Updates cover_url in-place if a fast URL is found
 *   5. Keeps the original CAA URL if no match found
 *
 * Resumable — state file tracks processed IDs.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-fast-covers.ts
 *   npx tsx --env-file=.env.local scripts/backfill-fast-covers.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-fast-covers.ts --skip-spotify
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_SPOTIFY = process.argv.includes('--skip-spotify');
const STATE_PATH   = path.resolve('scripts/backfill-fast-covers-state.json');

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPOTIFY_ID    = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SEC   = process.env.SPOTIFY_CLIENT_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!SKIP_SPOTIFY && (!SPOTIFY_ID || !SPOTIFY_SEC)) {
  console.error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (or pass --skip-spotify)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ITUNES_DELAY  = 700;   // ~85 req/min — iTunes is lenient but be polite
const SPOTIFY_DELAY = 350;   // ~170 req/min — well under the 180/min limit

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── State ─────────────────────────────────────────────────────────────────────

interface State { processed: string[] }

function loadState(): State {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); }
  catch { return { processed: [] }; }
}
function saveState(s: State) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ── Spotify token ─────────────────────────────────────────────────────────────

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (!SPOTIFY_ID || !SPOTIFY_SEC) return null;
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${SPOTIFY_ID}&client_secret=${SPOTIFY_SEC}`,
  });
  if (!res.ok) return null;
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

// ── Normalise strings for fuzzy matching ─────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w가-힣぀-ヿ一-鿿']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titlesMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  // Exact match, or one contains the other's first 12 chars (handles subtitles)
  return na === nb || na.startsWith(nb.slice(0, 12)) || nb.startsWith(na.slice(0, 12));
}

function artistsMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  const wordA = na.split(' ')[0], wordB = nb.split(' ')[0];
  return na === nb || wordA === wordB || na.includes(wordB) || nb.includes(wordA);
}

// ── iTunes ────────────────────────────────────────────────────────────────────

async function coverFromItunes(
  title: string, artist: string, nativeTitle?: string | null, attempt = 0
): Promise<string | null> {
  await sleep(ITUNES_DELAY);
  const query = encodeURIComponent(`${title} ${artist}`);
  const url = `https://itunes.apple.com/search?term=${query}&entity=album&limit=8`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku/1.0' } });
    if (res.status === 429 || res.status === 403) {
      const wait = Math.min(120_000, 10_000 * 2 ** attempt);
      process.stdout.write(`[iTunes ${res.status} wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 3 ? coverFromItunes(title, artist, nativeTitle, attempt + 1) : null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];

    // Best match: title + artist. Fall back to just title match.
    const best = results.find(r =>
      (titlesMatch(r.collectionName ?? '', title) || (nativeTitle && titlesMatch(r.collectionName ?? '', nativeTitle))) &&
      artistsMatch(r.artistName ?? '', artist)
    ) ?? results.find(r =>
      titlesMatch(r.collectionName ?? '', title) || (nativeTitle && titlesMatch(r.collectionName ?? '', nativeTitle))
    );

    if (!best?.artworkUrl100) return null;
    // iTunes artworkUrl100 is always 100x100bb — replace to get 600x600bb
    return (best.artworkUrl100 as string).replace('100x100bb', '600x600bb');
  } catch { return null; }
}

// ── Spotify ───────────────────────────────────────────────────────────────────

async function coverFromSpotify(
  title: string, artist: string, nativeTitle?: string | null, attempt = 0
): Promise<string | null> {
  const token = await getSpotifyToken();
  if (!token) return null;
  await sleep(SPOTIFY_DELAY);

  const q = encodeURIComponent(`album:${title} artist:${artist}`);
  const url = `https://api.spotify.com/v1/search?q=${q}&type=album&limit=5`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { spotifyToken = null; return coverFromSpotify(title, artist, nativeTitle, attempt); }
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('Retry-After') ?? '10') * 1000 + 500;
      process.stdout.write(`[Spotify 429 wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 3 ? coverFromSpotify(title, artist, nativeTitle, attempt + 1) : null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const items: any[] = data.albums?.items ?? [];

    const best = items.find(a =>
      (titlesMatch(a.name, title) || (nativeTitle && titlesMatch(a.name, nativeTitle))) &&
      a.artists?.some((ar: any) => artistsMatch(ar.name, artist))
    ) ?? items.find(a =>
      titlesMatch(a.name, title) || (nativeTitle && titlesMatch(a.name, nativeTitle))
    );

    if (!best) return null;
    // Prefer 300px image (index 1), fall back to any available
    const imgs: any[] = best.images ?? [];
    const img300 = imgs.find((i: any) => i.width === 300) ?? imgs[1] ?? imgs[0];
    return img300?.url ?? null;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Spotify: ${SKIP_SPOTIFY ? 'skip' : 'enabled'}`);

  const state = loadState();
  const processed = new Set(state.processed);

  // Fetch all CAA release_groups not yet processed
  const { data: rows, error } = await supabase
    .from('release_groups')
    .select('id, title, native_title, artist_display')
    .ilike('cover_url', '%coverartarchive%')
    .order('id');

  if (error) { console.error('DB fetch failed:', error); process.exit(1); }
  if (!rows?.length) { console.log('No CAA URLs found — already done!'); return; }

  const todo = rows.filter(r => !processed.has(r.id));
  console.log(`Total with CAA: ${rows.length}  |  Todo: ${todo.length}  |  Already done: ${processed.size}`);

  let updated = 0, kept = 0, failed = 0;

  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    const title  = r.title ?? '';
    const artist = r.artist_display ?? '';
    const native = r.native_title ?? null;

    process.stdout.write(`[${i + 1}/${todo.length}] ${artist} — ${title} ... `);

    // Try iTunes first (faster API, free)
    let fastUrl = await coverFromItunes(title, artist, native);
    if (fastUrl) {
      process.stdout.write(`iTunes ✓ `);
    } else if (!SKIP_SPOTIFY) {
      fastUrl = await coverFromSpotify(title, artist, native);
      if (fastUrl) process.stdout.write(`Spotify ✓ `);
    }

    if (fastUrl) {
      if (!DRY_RUN) {
        const { error: upErr } = await supabase
          .from('release_groups')
          .update({ cover_url: fastUrl })
          .eq('id', r.id);
        if (upErr) {
          console.log(`\n  DB error: ${upErr.message}`);
          failed++;
        } else {
          updated++;
          console.log(`→ ${fastUrl.slice(0, 60)}...`);
        }
      } else {
        console.log(`(dry) → ${fastUrl.slice(0, 60)}...`);
        updated++;
      }
    } else {
      process.stdout.write(`no match — keeping CAA\n`);
      kept++;
    }

    processed.add(r.id);
    state.processed = Array.from(processed);
    if ((i + 1) % 10 === 0) saveState(state);
  }

  saveState(state);
  console.log(`\nDone. Updated: ${updated}  |  Kept CAA: ${kept}  |  DB errors: ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
