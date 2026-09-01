/**
 * Catalog-wide release-GROUP cover backfill — the general version of
 * scripts/backfill-rg-covers-kr.ts (which is KR-scoped) and the successor to the
 * Deezer-only scripts/backfill-rg-covers-deezer.ts.
 *
 * Every user-facing surface (web + iOS) reads `release_groups.cover_url`. ~84k
 * groups (17.5% of the catalog) are null there — all MusicBrainz-sourced, all
 * with an `mb_release_group_id`, because CAA had no image for the one release we
 * ingested. This fills them from four sources.
 *
 * Chain per group, first hit wins (fast + high-yield first; CAA — the only
 * exact-MBID lookup — is the final rescue for what the fuzzy sources miss):
 *   1. Spotify  album search + title/artist match guard   (i.scdn.co — CSP-safe, fast)
 *   2. Last.fm  album.getInfo + artist guard + liveness    (lastfm.freetls.fastly.net
 *               — REQUIRES the img-src CSP entry added 2026-08-28; iOS is unaffected)
 *   3. Deezer   album search + title/artist match guard    (*.dzcdn.net — CSP-safe)
 *   4. Cover Art Archive at the RELEASE-GROUP level (mb_release_group_id) —
 *      group-level art can exist even when the release we ingested had none.
 *
 * Measured hit rate on a random 80-group album/ep sample: ~65% union
 * (Last.fm 61 · Spotify 23 · CAA 20 · Deezer 20).
 *
 * SAFETY: dry-run by default — pass --write to touch the DB. APPEND-ONLY: every
 * UPDATE is guarded `.is('cover_url', null)`, so it never fights a concurrent
 * gapfill/freshness write — whoever fills the null first wins. Resumable: the
 * state file records every processed id (hit or miss). No MusicBrainz API calls,
 * so it does not contend with the ingest pipeline.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-all.ts                  # dry run, album+ep
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-all.ts --all            # dry run, every type
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-all.ts --all --write    # commit
 *   ...--limit 100     stop after N groups (sampling)
 *   ...--reset         ignore the state file and start over
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { searchAlbums, type DzAlbumHit } from './deezer-client';

const WRITE = process.argv.includes('--write');
const DRY_RUN = !WRITE;
const RESET = process.argv.includes('--reset');
const ALL_TYPES = process.argv.includes('--all');
const VERBOSE = process.argv.includes('--verbose');

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity;

const STATE_PATH = path.resolve('scripts/backfill-rg-covers-all-state.json');

const LASTFM_KEY = process.env.LASTFM_API_KEY ?? null;
const SPOTIFY_ID = process.env.SPOTIFY_CLIENT_ID ?? null;
const SPOTIFY_SEC = process.env.SPOTIFY_CLIENT_SECRET ?? null;

const LASTFM_DELAY = 260;
const SPOTIFY_DELAY = 130;
const CAA_DELAY = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── match guards (shared with the KR script's logic) ───────────────────────────

const norm = (s: string) =>
  (s || '').toLowerCase().replace(/\(feat[^)]*\)/g, '').replace(/[^\p{L}\p{N}]/gu, ' ').replace(/\s+/g, ' ').trim();

const hasCJK = (s: string) => /[぀-ヿ㐀-鿿가-힯]/.test(s);

/** Title must contain-or-be-contained; artist likewise, or share a first token
 *  (handles "feat."/collab strings and romanized-vs-native names). For CJK
 *  titles a 2-char containment is enough; for latin require 4+ to avoid a stray
 *  short word matching everything. */
function titleArtistOk(candTitle: string, candArtist: string, wantTitle: string, wantArtist: string): boolean {
  const ct = norm(candTitle), wt = norm(wantTitle);
  const ca = norm(candArtist), wa = norm(wantArtist);
  if (!ct || !wt) return false;
  const shortest = ct.length <= wt.length ? ct : wt;
  const minLen = hasCJK(shortest) ? 2 : 4;
  if (shortest.length < minLen) return ct === wt;
  const titleOk = ct.includes(wt) || wt.includes(ct);
  const artistOk =
    !wa || !ca || ca.includes(wa) || wa.includes(ca) || (!!ca.split(' ')[0] && ca.split(' ')[0] === wa.split(' ')[0]);
  return titleOk && artistOk;
}

// First credited artist only — the search APIs match the lead artist best.
const primaryArtist = (s: string) => s.split(/\s*(?:&|feat\.?|ft\.?|,|\bx\b|×|vs\.?|\bwith\b)\s+/i)[0].trim() || s;

// Verify a URL actually serves an image before trusting it — Last.fm's getInfo
// hands back dead CDN hashes for a small fraction of albums (they 404).
async function urlIsLive(u: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const r = await fetch(u, { method, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.status === 405 && method === 'HEAD') continue; // CDN doesn't do HEAD — fall through to GET
      return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
    } catch {
      return false;
    }
  }
  return false;
}

// ── Tier 1: Spotify ───────────────────────────────────────────────────────────

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

// Circuit breaker: Spotify's client-credentials tier can hit a sustained 429
// window (observed live 2026-08-28 — every request 429'd with retry-after 60s
// for over an hour). Retrying in that state burns up to 4 min PER ROW before
// falling through. After a run of consecutive 429s, stop calling Spotify for
// the rest of this run and fall straight to Last.fm/Deezer/CAA — same pattern
// as the KR script's iTunes fast-fail.
let spotifyBlockedUntil = 0;
let spotify429Streak = 0;
async function getSpotifyToken(): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  if (!SPOTIFY_ID || !SPOTIFY_SEC) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SEC}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    spotifyToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return spotifyToken;
  } catch {
    return null;
  }
}

async function coverFromSpotify(title: string, artist: string): Promise<string | null> {
  if (Date.now() < spotifyBlockedUntil) return null; // circuit open — skip without a request
  const token = await getSpotifyToken();
  if (!token) return null;
  await sleep(SPOTIFY_DELAY);
  try {
    const q = encodeURIComponent(`album:"${title}" artist:"${artist}"`);
    const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      if (++spotify429Streak >= 5) {
        spotifyBlockedUntil = Date.now() + 30 * 60 * 1000; // 30 min cooldown, then try again
        console.log(`  [spotify 429×${spotify429Streak} — circuit open 30m]`);
      }
      return null; // single attempt, no blocking retry — fall through to the next tier
    }
    spotify429Streak = 0;
    if (!res.ok) return null;
    const data = await res.json();
    const items: any[] = data.albums?.items ?? [];
    const hit = items.find((it) => titleArtistOk(it.name ?? '', it.artists?.[0]?.name ?? '', title, artist));
    return hit?.images?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

// ── Tier 2: Last.fm ───────────────────────────────────────────────────────────

// Normalize to the host the 85 pre-existing rows use (and the single CSP entry).
const normLfmHost = (u: string) => u.replace('lastfm-img.freetls.fastly.net', 'lastfm.freetls.fastly.net');

// Same circuit-breaker shape as Spotify — a sustained 429 window must not turn
// into a blocking per-row retry loop.
let lastfmBlockedUntil = 0;
let lastfm429Streak = 0;

async function coverFromLastfm(title: string, artist: string): Promise<string | null> {
  if (!LASTFM_KEY) return null;
  if (Date.now() < lastfmBlockedUntil) return null;
  await sleep(LASTFM_DELAY);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'album.getInfo');
  url.searchParams.set('artist', artist);
  url.searchParams.set('album', title);
  url.searchParams.set('api_key', LASTFM_KEY);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-cover-backfill/1.0' } });
    if (res.status === 429) {
      if (++lastfm429Streak >= 5) {
        lastfmBlockedUntil = Date.now() + 15 * 60 * 1000;
        console.log(`  [lastfm 429×${lastfm429Streak} — circuit open 15m]`);
      }
      return null;
    }
    lastfm429Streak = 0;
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.album) return null;
    // getInfo is a DIRECT lookup by the title we passed (not a search), so a
    // same-artist result is the right album even if its stored name is romanized
    // vs. our CJK title. Validate the ARTIST only — blocks an autocorrect
    // redirect to an unrelated artist without dropping romanized-title matches.
    const ca = norm(data.album.artist ?? ''), wa = norm(artist);
    const artistOk = !wa || !ca || ca.includes(wa) || wa.includes(ca) || ca.split(' ')[0] === wa.split(' ')[0];
    if (!artistOk) return null;
    const images: any[] = data.album?.image ?? [];
    for (const size of ['extralarge', 'mega', 'large']) {
      const img = images.find((i) => i.size === size);
      const u: string | undefined = img?.['#text'];
      // Reject the known placeholder star; verify the URL resolves.
      if (u && !u.includes('2a96cbd8b46e442fc41c2b86b821562f')) {
        const normalized = normLfmHost(u);
        if (await urlIsLive(normalized)) return normalized;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Tier 3: Deezer ────────────────────────────────────────────────────────────

async function coverFromDeezer(title: string, artist: string): Promise<string | null> {
  const a = primaryArtist(artist);
  let hits: DzAlbumHit[] = [];
  try {
    hits = await searchAlbums(a, title, 5);
  } catch {
    return null;
  }
  const nt = norm(title);
  const cands = hits.filter((h) => h.cover && titleArtistOk(h.title, h.artist, title, a));
  const hit = cands.find((h) => norm(h.title) === nt) ?? cands[0];
  return hit?.cover ?? null;
}

// ── Tier 4: Cover Art Archive (release-group level) ────────────────────────────

async function coverFromCAAGroup(mbRgId: string | null): Promise<string | null> {
  if (!mbRgId) return null;
  await sleep(CAA_DELAY);
  const url = `https://coverartarchive.org/release-group/${mbRgId}/front-500`;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (res.status === 200) return res.url && res.url !== url ? res.url : url;
    return null;
  } catch {
    return null;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

function loadProcessed(): Set<string> {
  if (RESET || !fs.existsSync(STATE_PATH)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).processedIds ?? []);
  } catch {
    return new Set();
  }
}
function saveProcessed(ids: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedIds: [...ids] }, null, 0));
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

interface RGRow {
  id: string;
  title: string;
  native_title: string | null;
  artist_display: string | null;
  mb_release_group_id: string | null;
  release_group_type: string | null;
}

const PRIORITY_TYPES = ['album', 'ep'];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  Catalog-wide release-group cover backfill  ${DRY_RUN ? '[DRY RUN — pass --write to commit]' : '[WRITING]'}`);
  console.log(`  Chain: ${SPOTIFY_ID ? 'Spotify → ' : ''}${LASTFM_KEY ? 'Last.fm → ' : ''}Deezer → CAA(group)`);
  console.log(`  Types: ${ALL_TYPES ? 'ALL' : PRIORITY_TYPES.join(', ')}${LIMIT !== Infinity ? `   Limit: ${LIMIT}` : ''}\n`);

  const db = getDB();
  const processed = loadProcessed();

  // Pull every null-cover group, priority types first, then by prestige.
  const PAGE = 1000;
  const rows: RGRow[] = [];
  let from = 0;
  while (true) {
    let data: any[] | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      let q = db
        .from('release_groups')
        .select('id, title, native_title, artist_display, mb_release_group_id, release_group_type')
        .is('cover_url', null)
        .order('prestige_score', { ascending: false, nullsFirst: false })
        .order('id')
        .range(from, from + PAGE - 1);
      if (!ALL_TYPES) q = q.in('release_group_type', PRIORITY_TYPES);
      const { data: d, error } = await q;
      if (!error) {
        data = d as any[];
        break;
      }
      const wait = Math.min(30000, 3000 * 2 ** attempt);
      console.error(`  DB page ${from} error: ${error.message} — retry ${attempt + 1}/6 in ${wait / 1000}s`);
      if (attempt === 5) {
        console.error('  DB fetch failed after 6 retries; aborting.');
        process.exit(1);
      }
      await sleep(wait);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // album/ep ahead of everything else regardless of prestige ordering above.
  rows.sort((a, b) => {
    const pa = PRIORITY_TYPES.includes(a.release_group_type ?? '') ? 0 : 1;
    const pb = PRIORITY_TYPES.includes(b.release_group_type ?? '') ? 0 : 1;
    return pa - pb;
  });

  let todo = rows.filter((r) => !processed.has(r.id));
  if (todo.length > LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`  Null-cover groups : ${rows.length}`);
  console.log(`  Already processed : ${rows.length - rows.filter((r) => !processed.has(r.id)).length}`);
  console.log(`  This run          : ${todo.length}\n`);

  const counts = { spotify: 0, lastfm: 0, deezer: 0, caa: 0, none: 0 };
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i++) {
    const rg = todo[i];
    const artist = rg.artist_display ?? '';
    const titles = [rg.title];
    if (rg.native_title && norm(rg.native_title) !== norm(rg.title)) titles.push(rg.native_title);

    let cover: string | null = null;
    let source = '';

    for (const t of titles) {
      if (SPOTIFY_ID && (cover = await coverFromSpotify(t, artist))) { source = 'spotify'; break; }
      if (LASTFM_KEY && (cover = await coverFromLastfm(t, artist))) { source = 'lastfm'; break; }
      if ((cover = await coverFromDeezer(t, artist))) { source = 'deezer'; break; }
    }
    if (!cover && (cover = await coverFromCAAGroup(rg.mb_release_group_id))) source = 'caa';

    if (cover) {
      (counts as any)[source]++;
      if (VERBOSE) console.log(`  ✓ ${source.padEnd(7)} ${artist.slice(0, 24).padEnd(24)} — ${rg.title.slice(0, 30).padEnd(30)}  ${cover}`);
      if (WRITE) {
        const { error } = await db.from('release_groups').update({ cover_url: cover }).eq('id', rg.id).is('cover_url', null);
        if (error) process.stdout.write(`  ⚠ ${rg.id} write failed: ${error.message}\n`);
      }
    } else {
      counts.none++;
      if (VERBOSE) console.log(`  ·         ${artist.slice(0, 24).padEnd(24)} — ${rg.title.slice(0, 30)}`);
    }

    processed.add(rg.id);

    if ((i + 1) % 50 === 0) {
      saveProcessed(processed);
      const done = i + 1;
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = (todo.length - done) / rate / 3600;
      const found = counts.spotify + counts.lastfm + counts.deezer + counts.caa;
      console.log(
        `  ${done}/${todo.length}  found ${found} (${((100 * found) / done).toFixed(0)}%)  ` +
          `sp=${counts.spotify} lf=${counts.lastfm} dz=${counts.deezer} caa=${counts.caa} miss=${counts.none}  ` +
          `${rate.toFixed(1)}/s  ETA ${eta.toFixed(1)}h`,
      );
    }
  }

  saveProcessed(processed);

  const found = counts.spotify + counts.lastfm + counts.deezer + counts.caa;
  const evaluated = found + counts.none;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Spotify   : ${counts.spotify}
  Last.fm   : ${counts.lastfm}
  Deezer    : ${counts.deezer}
  CAA group : ${counts.caa}
  ── found  : ${found} / ${evaluated}  (${evaluated ? Math.round((100 * found) / evaluated) : 0}%)
  no match  : ${counts.none}
${DRY_RUN ? '  [DRY RUN — nothing written. Re-run with --write to commit.]' : '  [WROTE release_groups.cover_url for each hit]'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
