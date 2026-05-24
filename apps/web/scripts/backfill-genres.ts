/**
 * Backfill genres for releases rows that have a null/empty genres column.
 *
 * Strategy:
 *   1. Query all releases where genres IS NULL or genres = ''
 *   2. Group them by artist_id (one Spotify artist call covers all their albums)
 *   3. For releases with no artist_id, fall back to a per-album Spotify call
 *   4. Write genres back in batch updates
 *
 * Run:
 *   npm run backfill:genres
 *   npm run backfill:genres -- --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { assertSpotifyCircuitClosed, recordSpotify429 } from './spotify-circuit';

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 300; // ms between Spotify calls — stays well under rate limit

// ── Env ───────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SPOTIFY_ID   = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!SUPABASE_URL) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL'); process.exit(1); }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!SPOTIFY_ID)   { console.error('Missing SPOTIFY_CLIENT_ID'); process.exit(1); }
if (!SPOTIFY_SECRET) { console.error('Missing SPOTIFY_CLIENT_SECRET'); process.exit(1); }

// ── Spotify auth ──────────────────────────────────────────────────────────────

const SPOTIFY_API = 'https://api.spotify.com/v1';
let tokenCache: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
  const d = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: d.access_token, expiresAt: Date.now() + (d.expires_in - 60) * 1000 };
  return tokenCache.value;
}

class RateLimitError extends Error {
  constructor(public retryAfterSec: number) { super(`RATE_LIMIT:${retryAfterSec}`); }
}

async function spotifyGet(path: string, attempt = 0): Promise<any> {
  const token = await getToken();
  const url = path.startsWith('https://') ? path : `${SPOTIFY_API}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    await recordSpotify429(retry, 'backfill-genres');
    if (retry > 120 || attempt >= 3) throw new RateLimitError(retry);
    console.log(`  [rate limit] waiting ${retry}s…`);
    await sleep(retry * 1000);
    return spotifyGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch genres for an artist ID ─────────────────────────────────────────────

async function getArtistGenres(artistId: string): Promise<string[]> {
  try {
    const data = await spotifyGet(`/artists/${artistId}`);
    return data.genres ?? [];
  } catch {
    return [];
  }
}

// ── Fetch genres for a single album (fallback when no artist_id) ──────────────

async function getAlbumGenres(albumId: string): Promise<string[]> {
  try {
    const data = await spotifyGet(`/albums/${albumId}`);
    let genres: string[] = data.genres ?? [];
    // Spotify album genres are usually empty — fall back to primary artist
    if (genres.length === 0 && data.artists?.[0]?.id) {
      genres = await getArtistGenres(data.artists[0].id);
    }
    return genres;
  } catch {
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎵  sillajuku genre backfill${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  await assertSpotifyCircuitClosed();

  // Canary — fail fast if Spotify is still rate limited
  try {
    process.stdout.write('  Checking Spotify access… ');
    await spotifyGet('/search?q=test&type=artist&limit=1');
    console.log('OK\n');
  } catch (err: any) {
    if (err instanceof RateLimitError) {
      const mins = Math.ceil(err.retryAfterSec / 60);
      const hrs = (err.retryAfterSec / 3600).toFixed(1);
      console.log(`RATE LIMITED\n\n  Spotify is rate limiting this app. Retry-After: ${err.retryAfterSec}s (~${hrs}h / ${mins}min).\n  Wait and try again.\n`);
    } else {
      console.log(`FAILED — ${err.message}\n`);
    }
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });

  // Fetch all releases missing genres
  const { data: rows, error } = await db
    .from('releases')
    .select('id, artist_id')
    .or('genres.is.null,genres.eq.');

  if (error) { console.error('DB fetch failed:', error.message); process.exit(1); }
  if (!rows || rows.length === 0) { console.log('No rows with missing genres — nothing to do.'); return; }

  console.log(`Found ${rows.length} releases missing genres\n`);

  // Group by artist_id
  const byArtist = new Map<string, string[]>(); // artistId → [releaseId, ...]
  const noArtist: string[] = [];

  for (const row of rows) {
    if (row.artist_id) {
      const list = byArtist.get(row.artist_id) ?? [];
      list.push(row.id);
      byArtist.set(row.artist_id, list);
    } else {
      noArtist.push(row.id);
    }
  }

  console.log(`  ${byArtist.size} artists to look up (covering ${rows.length - noArtist.length} releases)`);
  console.log(`  ${noArtist.length} releases with no artist_id (will look up by album)\n`);

  let updated = 0;
  let skipped = 0;

  // ── Pass 1: artist-level lookups ───────────────────────────────────────────
  const artists = [...byArtist.entries()];
  for (let i = 0; i < artists.length; i++) {
    const [artistId, releaseIds] = artists[i];
    process.stdout.write(`  [${i + 1}/${artists.length}] artist ${artistId} (${releaseIds.length} releases) … `);

    await sleep(DELAY_MS);
    let genres: string[];
    try {
      genres = await getArtistGenres(artistId);
    } catch (err: any) {
      if (err instanceof RateLimitError) {
        const mins = Math.ceil(err.retryAfterSec / 60);
        process.stdout.write(`\n\n  Rate limit hit mid-run (Retry-After: ${err.retryAfterSec}s / ~${mins}min). Re-run after waiting.\n`);
        break;
      }
      process.stdout.write(`error — ${err.message}\n`);
      skipped += releaseIds.length;
      continue;
    }

    if (genres.length === 0) {
      process.stdout.write(`no genres found — skipping\n`);
      skipped += releaseIds.length;
      continue;
    }

    const csv = genres.join(',');
    process.stdout.write(`${genres.join(', ')}\n`);

    if (!DRY_RUN) {
      const { error: updateError } = await db
        .from('releases')
        .update({ genres: csv })
        .in('id', releaseIds);

      if (updateError) {
        console.error(`    DB update failed: ${updateError.message}`);
        skipped += releaseIds.length;
        continue;
      }
    }

    updated += releaseIds.length;
  }

  // ── Pass 2: per-album lookups for releases with no artist_id ──────────────
  if (noArtist.length > 0) {
    console.log(`\n  Album-level fallback for ${noArtist.length} releases…\n`);

    for (let i = 0; i < noArtist.length; i++) {
      const albumId = noArtist[i];
      process.stdout.write(`  [${i + 1}/${noArtist.length}] album ${albumId} … `);

      await sleep(DELAY_MS);
      const genres = await getAlbumGenres(albumId);

      if (genres.length === 0) {
        process.stdout.write(`no genres found — skipping\n`);
        skipped++;
        continue;
      }

      const csv = genres.join(',');
      process.stdout.write(`${genres.join(', ')}\n`);

      if (!DRY_RUN) {
        const { error: updateError } = await db
          .from('releases')
          .update({ genres: csv })
          .eq('id', albumId);

        if (updateError) {
          console.error(`    DB update failed: ${updateError.message}`);
          skipped++;
          continue;
        }
      }

      updated++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Updated : ${updated} releases${DRY_RUN ? ' (dry run — not written)' : ''}
  Skipped : ${skipped} releases (no genres on Spotify)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
