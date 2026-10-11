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
import { recordSpotify429, spotifyCircuitRemainingMs } from './spotify-circuit';

const DRY_RUN      = process.argv.includes('--dry-run');
const SKIP_SPOTIFY = process.argv.includes('--skip-spotify');
const REVERIFY     = process.argv.includes('--reverify');  // re-check already-converted mzstatic URLs
const STATE_PATH   = path.resolve('scripts/backfill-fast-covers-state.json');
const KR_CACHE     = path.resolve('scripts/data/kr-release-group-ids.json');

/* WHICH ROWS ARE WORTH THE CRAWL: --target all | touched | kr  (default all)
   549,204 rows at the sustainable 360/hr is 63 days, so the scope matters more than the speed.
   This used to run in prestige_score order on the theory that prestige ≈ what gets viewed. Measured
   against actual engagement, it does not: of the 205 albums any user has ever rated, reviewed,
   pinned, saved or listed, only 76 sit inside the top 100,000 by prestige. The other 63% are the
   long-tail Korean releases this catalogue is actually for — which is why every cover complaint so
   far (h3hyeon, C JAMM, Mesurechiffon, 돈벌시간3) was a low-prestige row.
     touched — the ~98 albums users have actually touched that still point at CAA. Minutes.
     kr      — those plus artists with country = 'KR': ~18,948 rows, ~2 days.
   The global tail stays on CAA deliberately. A CAA cover is slow, not broken, and nobody is
   waiting on one for an album nobody opens. */
const TARGET = (process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'all') as 'all' | 'touched' | 'kr';
if (!['all', 'touched', 'kr'].includes(TARGET)) {
  console.error(`--target must be one of: all, touched, kr (got "${TARGET}")`);
  process.exit(1);
}

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

/* Tunable because the right value is not a constant: Apple's throttle tightens with the volume you
   have already sent today, so a pace that worked this morning draws 403s this evening. Measured at
   2s spacing after a heavy day, 3 of 6 requests were refused — that is a daily-volume penalty, not a
   per-second one, and the only remedies are a slower pace or a later run.
     --itunes-delay=3000 */
const ITUNES_DELAY  = Number(process.argv.find(a => a.startsWith('--itunes-delay='))?.split('=')[1] ?? 1200);
// Default ~50 req/min. 700ms drew intermittent 403s from a single job;
                             // the fuse then cost more time than the slower pace does.
const SPOTIFY_DELAY = 350;   // ~170 req/min — well under the 180/min limit

/* ITUNES LEADS, AND THE REASON IS NOT SPEED — IT IS BLAST RADIUS.
   Spotify looks like the better lead on raw numbers. Measured over 46 rows: iTunes answered 32
   times but cost 53 separate 403 backoff waits (~23s of sleeping per row, the reason this job once
   ran at 96 rows/hour), while Spotify answered instantly and never throttled. Leading with Spotify
   did take the job to ~2,700 rows/hour.

   It also got the account 429'd with Retry-After: 76816 — 21.3 HOURS. These Spotify credentials are
   SHARED WITH THE PRODUCTION WEB SERVER (see scripts/spotify-circuit.ts, which exists solely because
   of this), so that penalty did not just stall the backfill: it held production's Spotify breaker
   open for ~21h, forcing live search onto its iTunes/DB fallbacks that whole time. Search kept
   working — app/api/search/route.ts degrades deliberately — but on weaker sources, for every user,
   to make one backfill faster. A 543k-row backfill must therefore never lean on Spotify.

   iTunes' 403s are per-IP and cost only this script. That makes a slow source the correct primary
   and a fast one the sparing fallback. The fuse below is what makes the slow source affordable:
   Apple's 403 lasts minutes, so retrying per row makes every row pay again. After
   ITUNES_FUSE_TRIP consecutive 403s iTunes is skipped for ITUNES_FUSE_COOLDOWN and rows fall
   through; one success re-arms it. */
const ITUNES_FUSE_TRIP     = 3;
/* 10 minutes was a guess and it was far too long. Measured: a 3-of-3 clean probe came back within
   30 SECONDS of the job going idle, so Apple's throttle is a short window that recovers almost
   immediately once you stop pushing — not the multi-minute lockout the first value assumed. At 10
   minutes the job spent nearly all its time asleep (~120 rows/hr with 3 fuses in 30 rows).
   Tunable, because the figure depends on how hard the day has already been: --itunes-cooldown=120 */
const ITUNES_FUSE_COOLDOWN =
  Number(process.argv.find(a => a.startsWith('--itunes-cooldown='))?.split('=')[1] ?? 120) * 1000;
let itunes403Streak = 0;
let itunesBlockedUntil = 0;

/* SPOTIFY IS FUSED THE SAME WAY, AND FOR A SHARPER REASON. Running Spotify-first at ~2,700 req/hr
   tripped its extended-quota penalty, and the 429 came back with Retry-After: 76816 — 21.3 HOURS.
   The old code slept for exactly as long as the header said, with no ceiling, so one response put
   the entire job to sleep until the next day at row 608 while still looking alive.

   A wait this long is not a retry instruction, it is a statement that the source is gone for now.
   So we obey it (no further calls until it lapses) WITHOUT sleeping on it: past the ceiling the
   host is marked unavailable and every row falls through to the other source. Honouring
   Retry-After matters — ignoring it is how an app key gets suspended outright — but honouring it
   means not calling, not blocking. */
const SPOTIFY_WAIT_CEILING = 10 * 60_000;
let spotifyBlockedUntil = 0;

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

/** Containment that respects word boundaries: "touch" is in "touch me", not in "touchdown". */
function containsWord(haystack: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${esc}($|\\s)`).test(haystack);
}

/* WHY THESE ARE STRICTER THAN THEY LOOK LIKE THEY NEED TO BE. Both used to accept bare substring
   containment, and artistsMatch also accepted FIRST-WORD equality. On a Korean catalogue that is
   close to useless: Kim, Lee and Park begin the names of thousands of distinct artists, so
   "Kim Jaehwan" matched "Kim Namjoon" and the pair then only had to agree on a title - where
   "Touch" counted as a match for "Touch Me" and for "Touchdown". That is exactly the wrong-cover
   class reported against 사랑하기 때문에 and 201, so the looseness was not hypothetical.

   A wrong cover is worse than no cover. A CAA cover is merely slow; a mispaired image is incorrect
   data shown to users that nothing downstream will ever flag. So containment must now land on a
   word boundary, and a title short enough to collide by accident must match exactly. */
const MIN_CONTAIN_LEN = 6;

function titlesMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long  = na.length <= nb.length ? nb : na;
  // Still allows "Cherry Bomb" inside "NCT #127 CHERRY BOMB - The 3rd Mini Album".
  if (short.length < MIN_CONTAIN_LEN) return false;
  return containsWord(long, short);
}

function artistsMatch(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long  = na.length <= nb.length ? nb : na;
  // Keeps "JJD" inside "JJD & Division One feat. Halvorsen"; drops "Kim" inside any other Kim.
  if (short.length < 3) return false;
  return containsWord(long, short);
}

// ── iTunes ────────────────────────────────────────────────────────────────────

async function coverFromItunes(
  title: string, artist: string, nativeTitle?: string | null, attempt = 0
): Promise<string | null> {
  // Fused open: don't spend a second of wall-clock on a host that is still refusing us.
  if (Date.now() < itunesBlockedUntil) return null;

  await sleep(ITUNES_DELAY);
  const query = encodeURIComponent(`${title} ${artist}`);
  const url = `https://itunes.apple.com/search?term=${query}&entity=album&limit=8`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku/1.0' } });
    if (res.status === 429 || res.status === 403) {
      if (++itunes403Streak >= ITUNES_FUSE_TRIP) {
        itunesBlockedUntil = Date.now() + ITUNES_FUSE_COOLDOWN;
        process.stdout.write(`[iTunes fused ${ITUNES_FUSE_COOLDOWN / 60_000}m] `);
        return null;
      }
      // One short, bounded wait. The fuse handles sustained throttling; this only rides out a blip.
      const wait = Math.min(15_000, 5_000 * 2 ** attempt);
      process.stdout.write(`[iTunes ${res.status} wait ${wait / 1000}s] `);
      await sleep(wait);
      return attempt < 1 ? coverFromItunes(title, artist, nativeTitle, attempt + 1) : null;
    }
    if (!res.ok) return null;
    itunes403Streak = 0;
    const data = await res.json();
    const results: any[] = data.results ?? [];

    // Require both title AND artist to match — no artist-blind fallback.
    const best = results.find(r =>
      (titlesMatch(r.collectionName ?? '', title) || (nativeTitle && titlesMatch(r.collectionName ?? '', nativeTitle))) &&
      artistsMatch(r.artistName ?? '', artist)
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
  if (Date.now() < spotifyBlockedUntil) return null;
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
      // Tell the rest of the system. The web app shares these credentials, so a penalty we earn is
      // an outage it is about to walk into; publishing lets its breaker open instead of hammering.
      await recordSpotify429(Math.ceil(wait / 1000), 'backfill-fast-covers').catch(() => {});
      if (wait > SPOTIFY_WAIT_CEILING) {
        // Obey it by backing off entirely, not by sleeping through it.
        spotifyBlockedUntil = Date.now() + wait;
        const hrs = (wait / 3_600_000).toFixed(1);
        process.stdout.write(`[Spotify quota exhausted — standing down ${hrs}h, iTunes only] `);
        return null;
      }
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
    );

    if (!best) return null;
    // Prefer 300px image (index 1), fall back to any available
    const imgs: any[] = best.images ?? [];
    const img300 = imgs.find((i: any) => i.width === 300) ?? imgs[1] ?? imgs[0];
    return img300?.url ?? null;
  } catch { return null; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

/** Release-group ids users have actually engaged with, across every table that records a choice. */
async function touchedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const tables = ['ratings', 'reviews', 'pinned_albums', 'saved_releases', 'list_items', 'mix_items'];
  for (const t of tables) {
    // Each of these is small (hundreds), but page anyway — PostgREST caps at 1,000 silently.
    let after = '';
    for (;;) {
      let q = supabase.from(t).select('release_group_id').order('release_group_id').limit(1000);
      if (after) q = q.gt('release_group_id', after);
      const { data, error } = await q;
      if (error) { console.warn(`  ! ${t}: ${error.message}`); break; }
      if (!data?.length) break;
      for (const r of data as { release_group_id: string | null }[]) if (r.release_group_id) ids.add(r.release_group_id);
      after = (data[data.length - 1] as any).release_group_id;
      if (data.length < 1000) break;
    }
  }
  return ids;
}

/* Release-group ids credited to a Korean artist.

   TWO SMALL QUERIES, NOT ONE JOIN. The obvious form — release_group_artists with artists!inner and
   .eq('artists.country','KR') — asks Postgres to join a 500k+ row link table against artists and
   dies on "canceling statement due to statement timeout". Worse, it dies AFTER the run has started,
   so the first version logged the error and carried on with only the 205 user-touched ids: a job
   that looked healthy while doing 82 rows instead of 19,000. Narrowing the scope silently is the
   failure to avoid here, so this throws.

   Instead: pull the KR artists first (~14.8k rows, indexed on country), then look up their link
   rows by artist_id in chunks. Every query is small and index-served. */
async function koreanIds(): Promise<Set<string>> {
  const artistIds: string[] = [];
  let after = '';
  for (;;) {
    let q = supabase.from('artists').select('id').eq('country', 'KR').order('id').limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(`KR artist fetch failed: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as { id: string }[]) artistIds.push(r.id);
    after = (data[data.length - 1] as { id: string }).id;
    if (data.length < 1000) break;
  }

  /* CACHED ON DISK. Deriving this costs ~75 chunked scans of a 500k-row link table and intermittently
     trips "canceling statement due to statement timeout" — and a resumable job pays it again on every
     restart. An artist's country does not change meaningfully week to week, so the set is cached and
     only recomputed when stale. */
  const ids = new Set<string>();
  try {
    const st = fs.statSync(KR_CACHE);
    if (Date.now() - st.mtimeMs < 7 * 86_400_000) {
      const cached: string[] = JSON.parse(fs.readFileSync(KR_CACHE, 'utf8'));
      if (cached.length) {
        console.log(`  (KR id set from cache: ${cached.length})`);
        return new Set(cached);
      }
    }
  } catch { /* no cache yet */ }

  for (let i = 0; i < artistIds.length; i += 50) {
    const chunk = artistIds.slice(i, i + 50);
    // One artist can have many release groups, so this page too can exceed the 1,000-row cap.
    let cursor = '';
    for (;;) {
      let q = supabase.from('release_group_artists')
        .select('release_group_id').in('artist_id', chunk)
        .order('release_group_id').limit(1000);
      if (cursor) q = q.gt('release_group_id', cursor);
      // A statement timeout here is load, not a bad query: back off once rather than losing the run.
      let res = await q;
      if (res.error && /timeout/i.test(res.error.message)) {
        await sleep(4000);
        let q2 = supabase.from('release_group_artists')
          .select('release_group_id').in('artist_id', chunk)
          .order('release_group_id').limit(1000);
        if (cursor) q2 = q2.gt('release_group_id', cursor);
        res = await q2;
      }
      if (res.error) throw new Error(`KR link fetch failed: ${res.error.message}`);
      const data = res.data;
      if (!data?.length) break;
      for (const r of data as { release_group_id: string | null }[]) if (r.release_group_id) ids.add(r.release_group_id);
      const last = (data[data.length - 1] as { release_group_id: string }).release_group_id;
      if (last === cursor) break;
      cursor = last;
      if (data.length < 1000) break;
    }
    if (i && i % 1000 === 0) console.log(`  …KR artists scanned ${i}/${artistIds.length}, ${ids.size} groups`);
  }
  try {
    fs.mkdirSync(path.dirname(KR_CACHE), { recursive: true });
    fs.writeFileSync(KR_CACHE, JSON.stringify([...ids]));
  } catch { /* cache is an optimisation, not a requirement */ }
  return ids;
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Spotify: ${SKIP_SPOTIFY ? 'skip' : 'enabled'} | Reverify: ${REVERIFY}`);

  /* HONOUR THE SHARED BREAKER, BUT DO NOT DIE ON IT. The sibling scripts call
     assertSpotifyCircuitClosed(), which throws and refuses to start — right for a short batch whose
     whole purpose is Spotify. This job is a 543k-row crawl that is primarily iTunes, so aborting
     would throw away hours of perfectly good work to protect a fallback. Instead we adopt the
     breaker's remaining window as our own stand-down: Spotify is skipped until it clears, iTunes
     carries the run, and Spotify rejoins by itself with no restart needed. */
  if (!SKIP_SPOTIFY) {
    const remainingMs = await spotifyCircuitRemainingMs().catch(() => 0);
    if (remainingMs > 0) {
      spotifyBlockedUntil = Date.now() + remainingMs;
      console.log(`  Spotify breaker OPEN (~${Math.ceil(remainingMs / 60_000)}min) — iTunes only until it clears`);
    }
  }

  const state = loadState();
  // In reverify mode, ignore the processed list so everything gets re-checked
  const processed = REVERIFY ? new Set<string>() : new Set(state.processed);

  // --reverify: re-check already-converted mzstatic URLs for wrong matches
  // Normal mode: only target remaining CAA URLs
  const filter = REVERIFY ? '%mzstatic%' : '%coverartarchive%';
  /* PAGED. PostgREST caps a response at 1,000 rows, so this fetched 1,000 and reported "Total with
     CAA: 1000" — against 543,393 that actually carry one. Ordered by id and walked with a keyset
     cursor rather than .range(), so rows cannot shift under the scan while the script is writing
     cover_url on the same table. */
  const rows: { id: string; title: string; native_title: string | null; artist_display: string; prestige_score?: number | null }[] = [];

  /* TARGETED RUN: fetch only the allowlisted ids instead of scanning everything. Enumerating all
     549k CAA rows costs ~10 minutes of startup before a single cover moves, which a resumable job
     pays again on every restart — pointless when the target is 19k rows. */
  if (TARGET !== 'all') {
    const touched = await touchedIds();
    const allow = new Set(touched);
    if (TARGET === 'kr') for (const id of await koreanIds()) allow.add(id);
    console.log(`  target=${TARGET}: ${allow.size} candidate id(s) (${touched.size} user-touched)`);

    const idList = [...allow];
    for (let i = 0; i < idList.length; i += 300) {
      const chunk = idList.slice(i, i + 300);
      const { data, error } = await supabase
        .from('release_groups')
        .select('id, title, native_title, artist_display, prestige_score')
        .in('id', chunk)
        .ilike('cover_url', filter);
      if (error) { console.error('DB fetch failed:', error.message); process.exit(1); }
      rows.push(...((data ?? []) as typeof rows));
    }
    console.log(`  of those, ${rows.length} still point at ${REVERIFY ? 'mzstatic' : 'CAA'}`);
  } else {

  let after = '';
  for (;;) {
    let q = supabase
      .from('release_groups')
      .select('id, title, native_title, artist_display, prestige_score')
      .ilike('cover_url', filter)
      .order('id')
      .limit(1000);
    if (after) q = q.gt('id', after);
    const { data: page, error } = await q;
    if (error) { console.error('DB fetch failed:', error); process.exit(1); }
    if (!page?.length) break;
    rows.push(...(page as typeof rows));
    after = page[page.length - 1].id;
    if (page.length < 1000) break;
    if (rows.length % 50000 === 0) console.log(`  …fetched ${rows.length}`);
  }
  }
  if (!rows.length) { console.log(`No entries matching ${filter} found.`); return; }

  /* MOST-SEEN FIRST. At ~1-2s per lookup this is days of work against 543,393 rows, so the order
     decides how soon anyone notices. Sorting by prestige_score means the albums people actually open
     get a fast CDN in the first hours instead of whenever an id-ordered scan happens to reach them;
     the long tail still gets done, just later. Resumable either way. */
  const todo = rows
    .filter(r => !processed.has(r.id))
    .sort((a: any, b: any) => Number(b.prestige_score ?? 0) - Number(a.prestige_score ?? 0));
  console.log(`Total with CAA: ${rows.length}  |  Todo: ${todo.length}  |  Already done: ${processed.size}`);

  let updated = 0, kept = 0, failed = 0;
  /* Consecutive rows that found no reachable source. Bails rather than racing through the whole
     todo list in minutes while recording nothing. */
  let stalled = 0;
  const STALL_LIMIT = 25;
  /* Longest single sleep we will take waiting for a source. Covers an iTunes fuse (10min),
     not a Spotify quota ban (hours). */
  const RESUME_WAIT_CAP = 11 * 60_000;

  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    const title  = r.title ?? '';
    const artist = r.artist_display ?? '';
    const native = r.native_title ?? null;

    process.stdout.write(`[${i + 1}/${todo.length}] ${artist} — ${title} ... `);

    // iTunes leads: its throttling costs only this script, Spotify's costs production. Spotify is
    // the sparing fallback for what iTunes cannot answer.
    /* "NO MATCH" AND "NOBODY ANSWERED" ARE NOT THE SAME OUTCOME, and conflating them cost a whole
       run. With iTunes fused and Spotify's breaker open, every lookup returned null instantly, so
       18,905 Korean albums were logged "no match — keeping CAA" and written to the state file as
       done without one request being made. The job printed "Done. Updated: 0" and looked finished
       while having permanently skipped its entire target. A row is only settled if a source was
       actually asked. */
    const itunesUp  = Date.now() >= itunesBlockedUntil;
    const spotifyUp = !SKIP_SPOTIFY && Date.now() >= spotifyBlockedUntil;
    if (!itunesUp && !spotifyUp) {
      stalled++;
      /* WAIT OUT A SHORT OUTAGE, ABANDON A LONG ONE. An iTunes fuse is ~10min and a Spotify quota ban
         can be ~21h, so the right response depends on which one we are in. Sleeping through the short
         case keeps a multi-hour unattended run alive without a restart (and a restart is not cheap:
         it re-derives the whole candidate set). Past the threshold there is nothing useful to wait
         for, so stop and say so. Either way these rows stay unprocessed. */
      const waits = [itunesBlockedUntil];
      if (!SKIP_SPOTIFY) waits.push(spotifyBlockedUntil);
      const resumeIn = Math.min(...waits) - Date.now();
      if (stalled >= STALL_LIMIT && resumeIn > RESUME_WAIT_CAP) {
        console.log(`\n  Stopping: no reachable source, earliest return ~${Math.ceil(resumeIn / 60_000)}min away.`);
        console.log(`  Nothing was lost — ${todo.length - i} rows stay unprocessed. Re-run when a source is back.`);
        break;
      }
      if (resumeIn > 0) {
        process.stdout.write(`both sources down — sleeping ${Math.ceil(resumeIn / 1000)}s\n`);
        await sleep(Math.min(resumeIn + 1000, RESUME_WAIT_CAP));
      }
      i--;                                         // retry this same row once a source is back
      continue;                                    // deliberately NOT added to `processed`
    }
    stalled = 0;

    let fastUrl = itunesUp ? await coverFromItunes(title, artist, native) : null;
    if (fastUrl) {
      process.stdout.write(`iTunes ✓ `);
    } else if (spotifyUp) {
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
      process.stdout.write(`no match — ${REVERIFY ? 'keeping existing' : 'keeping CAA'}\n`);
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
