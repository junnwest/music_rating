/**
 * Seed external_scores from prestige sources (Grammy AOTY, Mercury Prize, etc.).
 *
 * Each source's raw data lives in scripts/data/<source>.ts.
 * This script looks up Spotify IDs, calculates normalized_score, and upserts.
 *
 * Run:
 *   npx ts-node scripts/seed-external-scores.ts --source grammy_aoty
 *   npx ts-node scripts/seed-external-scores.ts --source grammy_aoty --dry-run
 *   npx ts-node scripts/seed-external-scores.ts --source grammy_aoty --year 2024
 *
 * Re-run safely: uses ON CONFLICT DO NOTHING; already-matched rows are skipped.
 * Progress is saved to scripts/seed-external-scores-state-<source>.json
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { assertSpotifyCircuitClosed, recordSpotify429 } from './spotify-circuit';

// ── CLI args ──────────────────────────────────────────────────────────────────

const DRY_RUN    = process.argv.includes('--dry-run');
const SOURCE_ARG = (() => { const i = process.argv.indexOf('--source'); return i !== -1 ? process.argv[i + 1] : null; })();
const YEAR_ARG   = (() => { const i = process.argv.indexOf('--year');   return i !== -1 ? parseInt(process.argv[i + 1]) : null; })();

if (!SOURCE_ARG) {
  console.error('Usage: npx ts-node scripts/seed-external-scores.ts --source <source_name> [--dry-run] [--year YYYY]');
  console.error('Available sources: grammy_aoty, mercury_prize, korean_music_awards, pitchfork_perfect');
  process.exit(1);
}

const DELAY_MS        = 1200;
const MATCH_THRESHOLD = 0.45;
const STATE_PATH      = path.resolve(`scripts/seed-external-scores-state-${SOURCE_ARG}.json`);

// ── Source registry ───────────────────────────────────────────────────────────

type ExternalEntry = {
  year: number;
  album: string;
  artist: string;
  scoreType: 'award_win' | 'award_nomination' | 'list_rank' | 'review_score';
  normalizedScore: number;
  rawScore?: number;
  scopeGenre?: string;
  scopeCountry?: string;
  sourceTier: number;
  spotifyId?: string;  // hardcoded override — skips Spotify search
};

async function loadEntries(source: string): Promise<ExternalEntry[]> {
  switch (source) {
    case 'grammy_aoty': {
      const { GRAMMY_AOTY } = await import('./data/grammy-aoty');
      return GRAMMY_AOTY.map(e => ({
        year:            e.year,
        album:           e.album,
        artist:          e.artist,
        scoreType:       e.won ? 'award_win' : 'award_nomination',
        normalizedScore: e.won ? 1.0 : 0.35,
        sourceTier:      3,
        scopeGenre:      undefined,
        scopeCountry:    undefined,
        spotifyId:       e.spotifyId,
      }));
    }
    default:
      throw new Error(`Unknown source "${source}". Add it to the registry in seed-external-scores.ts`);
  }
}

// ── String matching (same algorithm as seed-rankings.ts) ─────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\s가-힣]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringSimilarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function artistSimilarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchScore(expTitle: string, actTitle: string, expArtist: string, actArtist: string): number {
  const t = stringSimilarity(expTitle, actTitle);
  const a = artistSimilarity(expArtist, actArtist);
  if (a < 0.25) return 0;
  return t * 0.75 + a * 0.25;
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadState(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); }
  catch { return new Set(); }
}

function saveState(done: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify([...done]), 'utf8');
}

// ── Spotify ───────────────────────────────────────────────────────────────────

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API       = 'https://api.spotify.com/v1';
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

class RateLimitError extends Error {
  retryAfterSec: number;
  constructor(sec: number) { super(`RATE_LIMIT:${sec}`); this.retryAfterSec = sec; }
}

async function spotifyGet(path: string, attempt = 0): Promise<any> {
  const token = await getToken();
  const url = path.startsWith('https://') ? path : `${SPOTIFY_API}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const raw = Number(res.headers.get('Retry-After') ?? 5);
    const sec = isNaN(raw) ? 5 : raw;
    await recordSpotify429(sec, 'seed-external-scores');
    if (sec > 120 || attempt >= 3) throw new RateLimitError(sec);
    console.log(`  [rate limit] waiting ${sec}s…`);
    await sleep(sec * 1000);
    return spotifyGet(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

async function searchAlbum(title: string, artist: string): Promise<{ id: string } | null> {
  const params = new URLSearchParams({ q: `${artist} ${title}`, type: 'album', limit: '10' });
  const json   = await spotifyGet(`/search?${params}`);
  const items: any[] = json?.albums?.items ?? [];
  if (items.length === 0) return null;

  const scored = items.map(item => {
    const itemArtist = item.artists?.map((a: any) => a.name).join(', ') ?? '';
    return { item, score: matchScore(title, item.name, artist, itemArtist) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best.score >= MATCH_THRESHOLD ? { id: best.item.id } : null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  assertSpotifyCircuitClosed();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }

  const allEntries = await loadEntries(SOURCE_ARG!);
  const entries    = YEAR_ARG ? allEntries.filter(e => e.year === YEAR_ARG) : allEntries;
  const done       = loadState();

  console.log(`\n[seed-external-scores] source=${SOURCE_ARG} entries=${entries.length}${DRY_RUN ? ' DRY-RUN' : ''}${YEAR_ARG ? ` year=${YEAR_ARG}` : ''}\n`);

  let inserted = 0, skipped = 0, failed = 0;

  for (const entry of entries) {
    const key = `${SOURCE_ARG}::${entry.year}::${entry.album}::${entry.artist}`;
    if (done.has(key)) { skipped++; continue; }

    process.stdout.write(`  [${entry.year}] ${entry.artist} — ${entry.album} … `);

    let releaseId: string | null = entry.spotifyId ?? null;
    if (!releaseId) try {
      await assertSpotifyCircuitClosed();
      const hit = await searchAlbum(entry.album, entry.artist);
      releaseId = hit?.id ?? null;
      await sleep(DELAY_MS);
    } catch (err: any) {
      if (err instanceof RateLimitError) {
        console.log(`\n[abort] rate limit ${err.retryAfterSec}s — re-run to continue`);
        break;
      }
      process.stdout.write(`[spotify error: ${err.message}] `);
    }

    if (!releaseId) {
      console.log('✗ no Spotify match');
      failed++;
      done.add(key);
      saveState(done);
      continue;
    }

    if (!DRY_RUN) {
      const { error } = await supabase.from('external_scores').upsert({
        release_id:       releaseId,
        album_title:      entry.album,
        artist:           entry.artist,
        source:           SOURCE_ARG,
        raw_score:        entry.rawScore ?? null,
        normalized_score: entry.normalizedScore,
        score_type:       entry.scoreType,
        source_tier:      entry.sourceTier,
        scope_genre:      entry.scopeGenre ?? null,
        scope_country:    entry.scopeCountry ?? null,
        year:             entry.year,
      }, { onConflict: 'release_id,source,year', ignoreDuplicates: true });

      if (error) {
        console.log(`✗ DB error: ${error.message}`);
        failed++;
        done.add(key);
        saveState(done);
        continue;
      }
    }

    console.log(`✓ ${releaseId}${DRY_RUN ? ' (dry)' : ''}`);
    inserted++;
    done.add(key);
    saveState(done);
  }

  console.log(`\nDone. inserted=${inserted} skipped=${skipped} failed=${failed}`);
  if (failed > 0) console.log('Re-run to retry failed entries (state is saved).');
}

main().catch(err => { console.error(err); process.exit(1); });
