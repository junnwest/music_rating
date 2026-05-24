/**
 * Cover art backfill — fallback chain for releases missing cover_url.
 *
 * Fallback order (Spotify used last resort only, batched 20/call):
 *   1. iTunes  artworkUrl600 (free, no auth, high quality)
 *   2. Last.fm album.getInfo → image[extralarge/large]
 *   3. MusicBrainz Cover Art Archive (open, no auth)
 *   4. Spotify  GET /albums?ids= (batch 20 — last resort)
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-cover-art.ts
 *   npx tsx --env-file=.env.local scripts/backfill-cover-art.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-cover-art.ts --skip-spotify
 *
 * Resumable — state file tracks processed IDs.
 * Requires: LASTFM_API_KEY in .env.local
 *           SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (only if Spotify fallback enabled)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_SPOTIFY = process.argv.includes('--skip-spotify');
const STATE_PATH   = path.resolve('scripts/backfill-cover-art-state.json');

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) {
  console.error('LASTFM_API_KEY not set. Add to .env.local.');
  process.exit(1);
}

const ITUNES_DELAY  = 650;
const LASTFM_DELAY  = 260;
const MB_DELAY      = 1100;  // MusicBrainz rate limit: 1 req/s
const SPOTIFY_DELAY = 100;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── 1. iTunes ────────────────────────────────────────────────────────────────

async function coverFromItunes(title: string, artist: string, attempt = 0): Promise<string | null> {
  await sleep(ITUNES_DELAY);
  const term = encodeURIComponent(`${title} ${artist}`);
  const url  = `https://itunes.apple.com/search?term=${term}&entity=album&limit=5`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-cover-backfill/1.0' } });
    if (res.status === 429 || res.status === 403) {
      const wait = Math.min(120000, 10000 * 2 ** attempt);
      process.stdout.write(`[iTunes ${res.status} wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 4 ? coverFromItunes(title, artist, attempt + 1) : null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = data.results ?? [];
    const norm = (s: string) => s.toLowerCase().replace(/[^\w가-힣]/g, ' ').replace(/\s+/g, ' ').trim();
    const best = results.find(r =>
      norm(r.collectionName ?? '').includes(norm(title.slice(0, 10))) &&
      norm(r.artistName ?? '').split(' ')[0] === norm(artist).split(' ')[0]
    ) ?? results[0];
    if (!best?.artworkUrl100) return null;
    return best.artworkUrl100.replace('100x100', '600x600').replace('100bb', '600bb');
  } catch { return null; }
}

// ── 2. Last.fm ───────────────────────────────────────────────────────────────

async function coverFromLastfm(title: string, artist: string, attempt = 0): Promise<string | null> {
  await sleep(LASTFM_DELAY);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'album.getInfo');
  url.searchParams.set('artist', artist);
  url.searchParams.set('album', title);
  url.searchParams.set('api_key', LASTFM_KEY!);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-cover-backfill/1.0' } });
    if (res.status === 429) {
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      process.stdout.write(`[LFM 429 wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 4 ? coverFromLastfm(title, artist, attempt + 1) : null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    const images: any[] = data.album?.image ?? [];
    // Last.fm sizes: small, medium, large, extralarge, mega
    const preferred = ['extralarge', 'mega', 'large'];
    for (const size of preferred) {
      const img = images.find(i => i.size === size);
      if (img?.['#text'] && img['#text'] !== '') return img['#text'];
    }
    return null;
  } catch { return null; }
}

// ── 3. MusicBrainz Cover Art Archive ─────────────────────────────────────────

async function coverFromMusicBrainz(title: string, artist: string): Promise<string | null> {
  // Step 1: Search MusicBrainz for release MBID
  await sleep(MB_DELAY);
  const query = encodeURIComponent(`release:"${title}" AND artist:"${artist}"`);
  const searchUrl = `https://musicbrainz.org/ws/2/release/?query=${query}&limit=3&fmt=json`;
  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'sillajuku-cover-backfill/1.0 (admin@sillajuku.com)',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const releases: any[] = data.releases ?? [];
    if (releases.length === 0) return null;

    // Take the highest-score release with an MBID
    const mbid = releases[0]?.id;
    if (!mbid) return null;

    // Step 2: Check Cover Art Archive for that MBID
    await sleep(MB_DELAY);
    const caUrl = `https://coverartarchive.org/release/${mbid}/front`;
    const caRes = await fetch(caUrl, { redirect: 'follow' });
    if (caRes.ok && caRes.url !== caUrl) return caRes.url;  // redirected to actual image
    if (caRes.status === 200) return caUrl;
    return null;
  } catch { return null; }
}

// ── 4. Spotify batch ─────────────────────────────────────────────────────────

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    spotifyToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return spotifyToken;
  } catch { return null; }
}

async function coverFromSpotifyBatch(releases: { id: string; title: string; artist: string }[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (SKIP_SPOTIFY || releases.length === 0) return result;

  const token = await getSpotifyToken();
  if (!token) return result;

  // Spotify album search — one call per release (we don't have Spotify IDs for iTunes-sourced rows)
  for (const r of releases) {
    await sleep(SPOTIFY_DELAY);
    try {
      const q = encodeURIComponent(`album:"${r.title}" artist:"${r.artist}"`);
      const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const item = data.albums?.items?.[0];
      const img  = item?.images?.[0]?.url;
      if (img) result.set(r.id, img);
    } catch { /* skip */ }
  }

  return result;
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
  console.log(`\n  sillajuku cover art backfill${DRY_RUN ? ' [DRY RUN]' : ''}${SKIP_SPOTIFY ? ' [--skip-spotify]' : ''}`);
  console.log(`  Fallback chain: iTunes → Last.fm → MusicBrainz${SKIP_SPOTIFY ? '' : ' → Spotify'}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all releases missing cover_url
  const missing: { id: string; title: string; artist: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist')
      .is('cover_url', null)
      .range(from, from + 499);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    missing.push(...data);
    if (data.length < 500) break;
    from += 500;
  }

  const todo = missing.filter(r => !state.processedIds.has(r.id));
  console.log(`  Missing cover_url : ${missing.length}`);
  console.log(`  Already processed : ${missing.length - todo.length}`);
  console.log(`  Remaining         : ${todo.length}\n`);

  const counts = { itunes: 0, lastfm: 0, musicbrainz: 0, spotify: 0, none: 0 };
  const spotifyQueue: { id: string; title: string; artist: string }[] = [];

  for (let i = 0; i < todo.length; i++) {
    const { id, title, artist } = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${artist.slice(0, 25).padEnd(25)} — ${title.slice(0, 28).padEnd(28)} `);

    let coverUrl: string | null = null;
    let source: string | null = null;

    // Tier 1: iTunes
    coverUrl = await coverFromItunes(title, artist);
    if (coverUrl) { source = 'itunes'; counts.itunes++; }

    // Tier 2: Last.fm
    if (!coverUrl) {
      coverUrl = await coverFromLastfm(title, artist);
      if (coverUrl) { source = 'lastfm'; counts.lastfm++; }
    }

    // Tier 3: MusicBrainz
    if (!coverUrl) {
      coverUrl = await coverFromMusicBrainz(title, artist);
      if (coverUrl) { source = 'musicbrainz'; counts.musicbrainz++; }
    }

    // Tier 4: Queue for Spotify batch (handled after loop)
    if (!coverUrl && !SKIP_SPOTIFY) {
      spotifyQueue.push({ id, title, artist });
    }

    if (coverUrl) {
      process.stdout.write(`✓ ${source}\n`);
      if (!DRY_RUN) {
        await db.from('releases').update({ cover_url: coverUrl, cover_source: source }).eq('id', id);
      }
    } else if (SKIP_SPOTIFY) {
      process.stdout.write('no match\n');
      counts.none++;
    } else {
      process.stdout.write('→ spotify queue\n');
    }

    state.processedIds.add(id);
    if ((i + 1) % 50 === 0) saveState(state);
  }

  // Tier 4: Spotify batch (20 per API call)
  if (spotifyQueue.length > 0 && !SKIP_SPOTIFY) {
    console.log(`\n  Spotify batch fallback for ${spotifyQueue.length} remaining releases…`);
    const spotifyCovers = await coverFromSpotifyBatch(spotifyQueue);

    for (const r of spotifyQueue) {
      const url = spotifyCovers.get(r.id);
      if (url) {
        counts.spotify++;
        if (!DRY_RUN) {
          await db.from('releases').update({ cover_url: url, cover_source: 'spotify' }).eq('id', r.id);
        }
      } else {
        counts.none++;
      }
    }
  }

  saveState(state);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  iTunes found       : ${counts.itunes}
  Last.fm found      : ${counts.lastfm}
  MusicBrainz found  : ${counts.musicbrainz}
  Spotify found      : ${counts.spotify}
  Still missing      : ${counts.none}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
