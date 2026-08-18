/**
 * Release-GROUP cover backfill, scoped to KR artists.
 *
 * Why this exists (vs. the older scripts/backfill-cover-art.ts):
 *   - Every user-facing surface (artist discography, album page, song rows)
 *     reads `release_groups.cover_url` — NOT `releases.cover_url`. The old
 *     backfill only ever wrote the `releases` table, so an album with a null
 *     release-group cover (e.g. Beenzino — "Blurry") still shows no art even
 *     after that script runs.
 *   - All ~108k null covers are MusicBrainz-sourced releases that Cover Art
 *     Archive has no image for. ~3.6k of those are KR artists — the audience
 *     this app is built for. This targets that slice.
 *
 * Fallback chain per release group (first hit wins):
 *   1. Cover Art Archive at the RELEASE-GROUP level (mb_release_group_id) —
 *      group-level art can exist even when the one release we ingested had none.
 *   2. Spotify album search → images[0]                       (if SPOTIFY_* creds)
 *   3. Last.fm album.getInfo → image[extralarge/mega/large]   (if LASTFM_API_KEY)
 *   4. iTunes artworkUrl600 (romanized then native title) — LAST + fast-fail:
 *      iTunes 403-throttles this box's IP persistently, so it's a single-attempt
 *      no-backoff last resort that auto-disables after 15 consecutive 403s.
 *      Measured: Spotify + Last.fm alone recover ~72% of the KR slice, fast.
 *
 * SAFETY: defaults to DRY-RUN. Pass --write to actually update the DB.
 * Resumable — state file tracks processed release_group ids.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-kr.ts              # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-kr.ts --limit 60   # dry run, sample 60
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-kr.ts --write      # commit
 *   ...--types album,ep      restrict to these release_group_type values
 *   ...--reset               ignore the state file and start over
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const WRITE   = process.argv.includes('--write');
const DRY_RUN = !WRITE;
const RESET   = process.argv.includes('--reset');

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : Infinity;
const TYPES = argValue('--types')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

const STATE_PATH = path.resolve('scripts/backfill-rg-covers-kr-state.json');

const LASTFM_KEY  = process.env.LASTFM_API_KEY ?? null;
const SPOTIFY_ID  = process.env.SPOTIFY_CLIENT_ID ?? null;
const SPOTIFY_SEC = process.env.SPOTIFY_CLIENT_SECRET ?? null;

const ITUNES_DELAY = 650; // ~90/min — iTunes throttles bursts, empty 200s = backoff
const LASTFM_DELAY = 260;
const CAA_DELAY    = 900;
const SPOTIFY_DELAY = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Verify a cover URL actually serves an image before trusting it — Last.fm's
// getInfo returns dead CDN hashes for a small fraction of albums (they 404).
async function urlIsLive(u: string): Promise<boolean> {
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

const norm = (s: string) =>
  (s || '').toLowerCase().replace(/\(feat[^)]*\)/g, '').replace(/[^\w가-힣]/g, ' ').replace(/\s+/g, ' ').trim();

// Fuzzy "is this candidate the album we asked for" guard, shared by all search
// tiers so Spotify/Last.fm can't silently attach a wrong-album cover. Title must
// contain-or-be-contained; artist likewise, or share a first token (handles
// "feat."/collab strings and romanized-vs-native artist names).
function titleArtistOk(candTitle: string, candArtist: string, wantTitle: string, wantArtist: string): boolean {
  const ct = norm(candTitle), wt = norm(wantTitle);
  const ca = norm(candArtist), wa = norm(wantArtist);
  if (!ct || !wt) return false;
  const titleOk = ct.includes(wt) || wt.includes(ct);
  const artistOk =
    !wa || !ca || ca.includes(wa) || wa.includes(ca) || (!!ca.split(' ')[0] && ca.split(' ')[0] === wa.split(' ')[0]);
  return titleOk && artistOk;
}

// ── Tier 1: Cover Art Archive (release-group level) ────────────────────────────

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

// ── iTunes (fast-fail, LAST resort) ────────────────────────────────────────────
//
// iTunes 403-throttles this box's IP persistently — even a 45-min + overnight
// cooldown didn't clear it, and long per-row backoffs made the run take ~4 min
// PER ROW while starving the other tiers. Measured: Spotify+Last.fm alone
// recover ~72% of the KR slice, unthrottled and fast. So iTunes is now a
// single-attempt, no-backoff last resort: if it 403s or empties, we skip it
// immediately and move on (a global disable flips on after N consecutive 403s
// so we stop wasting a request per row once it's clearly blocked).

let itunesBlocked = false;
let itunes403Streak = 0;

async function itunesSearch(term: string): Promise<any[] | null> {
  if (itunesBlocked) return null;
  await sleep(ITUNES_DELAY);
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=8&country=KR`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'sillajuku-cover-backfill/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    const text = res.ok ? await res.text() : '';
    if (!res.ok || !text.trim()) {
      if (++itunes403Streak >= 15 && !itunesBlocked) {
        itunesBlocked = true;
        process.stdout.write('[iTunes blocked — disabling for this run] ');
      }
      return null;
    }
    itunes403Streak = 0;
    return JSON.parse(text).results ?? [];
  } catch {
    return null;
  }
}

function pickItunesMatch(results: any[], title: string, artist: string): string | null {
  const match = results.find((r) => titleArtistOk(r.collectionName ?? '', r.artistName ?? '', title, artist));
  const art = match?.artworkUrl100;
  if (!art) return null;
  return art.replace('100x100', '600x600').replace('100bb', '600bb');
}

// ── Tier 3: Last.fm ────────────────────────────────────────────────────────────

async function coverFromLastfm(title: string, artist: string, attempt = 0): Promise<string | null> {
  if (!LASTFM_KEY) return null;
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
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      await sleep(wait);
      return attempt < 4 ? coverFromLastfm(title, artist, attempt + 1) : null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.album) return null;
    // getInfo is a DIRECT lookup by the exact title we passed (not a search),
    // so a same-artist result is the right album even when its stored name is
    // romanized vs. our CJK title. Validate the ARTIST only — that still blocks
    // an autocorrect redirect to an unrelated artist, without dropping the many
    // KR albums Last.fm indexes under a romanized title.
    const ca = norm(data.album.artist ?? ''), wa = norm(artist);
    const artistOk = !wa || !ca || ca.includes(wa) || wa.includes(ca) || ca.split(' ')[0] === wa.split(' ')[0];
    if (!artistOk) return null;
    const images: any[] = data.album?.image ?? [];
    for (const size of ['extralarge', 'mega', 'large']) {
      const img = images.find((i) => i.size === size);
      const u: string | undefined = img?.['#text'];
      // Reject the known placeholder star, AND verify the URL actually resolves —
      // Last.fm's getInfo hands back dead CDN hashes for a small % of albums
      // (they 404), so trusting the URL blind writes broken covers.
      if (u && !u.includes('2a96cbd8b46e442fc41c2b86b821562f') && (await urlIsLive(u))) return u;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Tier 4: Spotify ────────────────────────────────────────────────────────────

let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

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
  const token = await getSpotifyToken();
  if (!token) return null;
  await sleep(SPOTIFY_DELAY);
  try {
    const q = encodeURIComponent(`album:"${title}" artist:"${artist}"`);
    const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=album&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items: any[] = data.albums?.items ?? [];
    // Verify the returned album's name/artist matches before trusting its art.
    const hit = items.find((it) => titleArtistOk(it.name ?? '', it.artists?.[0]?.name ?? '', title, artist));
    return hit?.images?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

function loadProcessed(): Set<string> {
  if (RESET || !fs.existsSync(STATE_PATH)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).processedIds ?? []);
  } catch {
    return new Set();
  }
}
function saveProcessed(ids: Set<string>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedIds: [...ids] }, null, 2));
}

// ── DB ─────────────────────────────────────────────────────────────────────────

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
  release_group_type: string;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  KR release-group cover backfill  ${DRY_RUN ? '[DRY RUN — pass --write to commit]' : '[WRITING]'}`);
  console.log(`  Chain: CAA(group) → ${SPOTIFY_ID ? 'Spotify → ' : ''}${LASTFM_KEY ? 'Last.fm → ' : ''}iTunes(fast-fail last)`);
  if (TYPES) console.log(`  Types filter: ${TYPES.join(', ')}`);
  if (LIMIT !== Infinity) console.log(`  Limit: ${LIMIT}`);
  console.log();

  const db = getDB();
  const processed = loadProcessed();

  // Fetch KR-artist release groups with null cover_url (paged, smaller pages +
  // retry so a busy DB — e.g. a concurrent scan holding connections — throws a
  // transient statement timeout on one page instead of killing the whole run).
  const PAGE = 250;
  const rows: RGRow[] = [];
  let from = 0;
  while (true) {
    let data: any[] | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      let q = db
        .from('release_groups')
        .select('id, title, native_title, artist_display, mb_release_group_id, release_group_type, artists!inner(country)')
        .is('cover_url', null)
        .eq('artists.country', 'KR')
        .order('id')
        .range(from, from + PAGE - 1);
      if (TYPES) q = q.in('release_group_type', TYPES);
      const { data: d, error } = await q;
      if (!error) {
        data = d as any[];
        break;
      }
      const wait = Math.min(30000, 3000 * 2 ** attempt);
      console.error(`  DB page ${from} error: ${error.message} — retry ${attempt + 1}/6 in ${wait / 1000}s`);
      if (attempt === 5) {
        console.error('  DB fetch failed after 6 retries; aborting (no data written — dry run).');
        process.exit(1);
      }
      await sleep(wait);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const todo = rows.filter((r) => !processed.has(r.id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`  KR null-cover groups : ${rows.length}`);
  console.log(`  Already processed    : ${rows.length - rows.filter((r) => !processed.has(r.id)).length}`);
  console.log(`  This run             : ${todo.length}\n`);

  const counts = { caa: 0, spotify: 0, lastfm: 0, itunes: 0, none: 0 };

  for (let i = 0; i < todo.length; i++) {
    const rg = todo[i];
    const artist = rg.artist_display ?? '';
    const label = `[${i + 1}/${todo.length}] ${artist.slice(0, 22).padEnd(22)} — ${rg.title.slice(0, 26).padEnd(26)}`;
    process.stdout.write(`  ${label} `);

    let cover: string | null = null;
    let source = '';

    // Chain, cheapest/most-reliable first. iTunes is LAST (it 403-throttles this
    // box); Spotify + Last.fm carry the run. A miss in one tier always falls
    // through to the next — no tier is ever skipped because another was blocked.

    // 1. CAA at the release-group level (via mb_release_group_id)
    cover = await coverFromCAAGroup(rg.mb_release_group_id);
    if (cover) source = 'caa';

    // 2. Spotify
    if (!cover) {
      cover = await coverFromSpotify(rg.title, artist);
      if (cover) source = 'spotify';
    }

    // 3. Last.fm
    if (!cover) {
      cover = await coverFromLastfm(rg.title, artist);
      if (cover) source = 'lastfm';
    }

    // 4. iTunes (fast-fail last resort — romanized then native title)
    if (!cover) {
      const terms = [rg.title];
      if (rg.native_title && norm(rg.native_title) !== norm(rg.title)) terms.push(rg.native_title);
      for (const t of terms) {
        const res = await itunesSearch(`${artist} ${t}`);
        const hit = res && pickItunesMatch(res, t, artist);
        if (hit) { cover = hit; source = 'itunes'; break; }
      }
    }

    if (cover) {
      (counts as any)[source]++;
      process.stdout.write(`✓ ${source}\n`);
      if (WRITE) {
        const { error } = await db.from('release_groups').update({ cover_url: cover }).eq('id', rg.id);
        if (error) process.stdout.write(`     ⚠ write failed: ${error.message}\n`);
      }
    } else {
      counts.none++;
      process.stdout.write('· no match\n');
    }

    processed.add(rg.id);
    if ((i + 1) % 25 === 0) saveProcessed(processed);
  }

  saveProcessed(processed);

  const found = counts.caa + counts.spotify + counts.lastfm + counts.itunes;
  const evaluated = found + counts.none;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CAA (group)   : ${counts.caa}
  Spotify       : ${counts.spotify}
  Last.fm       : ${counts.lastfm}
  iTunes        : ${counts.itunes}${itunesBlocked ? '  (auto-disabled — 403 throttled)' : ''}
  ── found      : ${found} / ${evaluated} evaluated  (${evaluated ? Math.round((100 * found) / evaluated) : 0}%)
  no match      : ${counts.none}
${DRY_RUN ? '  [DRY RUN — nothing written. Re-run with --write to commit.]' : '  [WROTE release_groups.cover_url for each ✓ above]'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
