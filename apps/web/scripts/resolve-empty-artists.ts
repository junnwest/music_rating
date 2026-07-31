/**
 * Recover discographies for artists we hold with ZERO releases.
 *
 * THE POPULATION. The `area` discovery lane (2026-07-17) queues every MB `country:KR` /
 * `area:<city>` ARTIST ENTITY by MBID. MB entities exist independently of releases, so an entity
 * with no release-groups ingests to nothing while still being marked `tracks_done`. 8,973 artists
 * (13.3% of the catalog; 61.7% of all KR artists) sit in that state. Migration 20260728000000
 * hides them from search; this script is the other half — actually filling the ones we can.
 *
 * WHY A NEW SCRIPT. Every existing fallback lane needs an existing release to establish identity,
 * so all of them structurally abort on exactly this population:
 *   • discover-itunes-backfill  → 'no owned release-groups' (identity = title overlap with ours)
 *   • discover-itunes-recency   → needs a seed title to resolve the streaming artist id
 *   • resolve-thin-artists      → needs ≥1 MB feature credit as a corroboration anchor
 * The way out is an identity signal that doesn't depend on already having a release:
 * **MusicBrainz's own URL relationships**, which carry an explicit streaming artist id. That is a
 * hard link — no name matching, no fuzzy scoring — so it satisfies the project's missing > wrong
 * rule without a review queue.
 *
 * MEASURED (audit-empty-artists.ts, n=500, 2026-07-28): 8.4% carry such a hard link, 12.0% would
 * need name matching, 38.4% are ambiguous, 41.2% have nothing findable. This script deliberately
 * implements ONLY the hard-link tier. The name-matched tier is left to a review workflow — a
 * generic Korean personal name (김형우) collides constantly and would attach a stranger's
 * discography to a real person.
 *
 * SAFETY
 *   • DRY-RUN BY DEFAULT. `--write` is required to touch the database.
 *   • NEVER creates an artist. Everything is written against the KNOWN artist uuid, so this can
 *     never mint a duplicate artist row (the failure mode mb-deezer-fallback has to guard against).
 *   • AMBIGUOUS LINKS ARE SKIPPED. Two different Spotify ids on one MB entity means MB itself is
 *     unsure; we abstain rather than guess.
 *   • RE-CHECKED BEFORE WRITING. An artist that gained releases since selection (e.g. the FRESHNESS
 *     lane got there first) is skipped, so we never double-write.
 *   • DEDUPED by release-group key against whatever the artist already has.
 *   • PROVENANCE: rows are tagged source='itunes'/'deezer' with mb_release_group_id NULL, so
 *     reconcile-itunes-mb.ts can link them onto the MB row once MusicBrainz catches up.
 *   • RATE LIMITS RESPECTED: MB at ~1 req/s; iTunes auto-disables after repeated 403s (this box is
 *     persistently throttled by Apple); Spotify is checked against the SHARED circuit breaker
 *     before every call — a script burst here takes production down with it.
 *
 *   npx tsx --env-file=.env.local scripts/resolve-empty-artists.ts --artist="Skyminhyuk"
 *   npx tsx --env-file=.env.local scripts/resolve-empty-artists.ts --limit=200
 *   npx tsx --env-file=.env.local scripts/resolve-empty-artists.ts --limit=200 --write
 *   npx tsx --env-file=.env.local scripts/resolve-empty-artists.ts --all --resume --write
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  getDB, createIngestContext, findOrCreateReleaseGroup, ingestEdition, releaseGroupKey,
  releaseType, artworkUrl, mapGenre, detectLanguage, type AlbumInput, type DB,
} from './itunes-ingest-core';
import { fetchDiscography, fetchAlbumTracks } from './itunes-client';
import { artistAlbums, albumWithTracks } from './deezer-client';
import { assertSpotifyCircuitClosed } from './spotify-circuit';
import { getSpotifyArtist, getSpotifyArtistAlbums, getSpotifyAlbum } from '../lib/spotify';

const args = process.argv.slice(2);
const arg = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const WRITE = args.includes('--write');
const ALL = args.includes('--all');
const RESUME = args.includes('--resume');
const ARTIST = arg('artist') ?? null;
const LIMIT = Number(arg('limit') ?? (ARTIST ? 1 : 100));
const COUNTRY = arg('country') ?? null;
// TIER 2 is opt-in: --tier=alias adds MB-alias-corroborated iTunes resolution on top of the
// hard-link tier. Default stays hard-link-only, since alias matching is the weaker signal.
const ALIAS_TIER = (arg('tier') ?? 'hard-link') === 'alias';
// Review workflow for the weaker alias tier: dry-run → eyeball the list → write ONLY the approved
// artists. Accepts a comma-separated list of artist uuids, or a path to a file of them (one per
// line, '#' comments allowed) — which is what you get by pruning the dry run's own report.
const ONLY_IDS: Set<string> | null = (() => {
  const v = arg('only-ids');
  if (!v) return null;
  const raw = fs.existsSync(v)
    ? fs.readFileSync(v, 'utf8').split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim())
    : v.split(',').map(s => s.trim());
  const ids = raw.filter(s => /^[0-9a-f-]{36}$/i.test(s));
  if (!ids.length) { console.error(`--only-ids matched no artist uuids in "${v}"`); process.exit(1); }
  return new Set(ids);
})();

const STATE = path.join(__dirname, 'resolve-empty-artists-state.json');

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required'); process.exit(1); }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

/** Candidate selection runs server-side: a PostgREST `.in()` over id pages truncates at the
 *  1000-row cap, which misreads prolific artists as empty (see SESSIONS 2026-07-28). */
async function sql<T = any>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── MusicBrainz url-rels: the hard identity link ────────────────────────────────
const MB_UA = 'sillajuku-empty-resolver/1.0 ( p.redee80@gmail.com )';
export interface HardLinks { spotify: string[]; apple: string[]; deezer: string[] }

export async function mbHardLinks(mbid: string, attempt = 0): Promise<HardLinks | null> {
  await sleep(1100); // MB ~1 req/s
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, { headers: { 'User-Agent': MB_UA } });
    if (r.status === 503 || r.status === 429) {
      if (attempt >= 4) return null;
      await sleep(2000 * (attempt + 1));
      return mbHardLinks(mbid, attempt + 1);
    }
    if (!r.ok) return null;
    const j: any = await r.json();
    const out: HardLinks = { spotify: [], apple: [], deezer: [] };
    for (const rel of j.relations ?? []) {
      const u: string = rel?.url?.resource ?? '';
      const sp = u.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]+)/);
      const ap = u.match(/music\.apple\.com\/[^/]+\/artist\/[^/]*?\/?(\d+)(?:\?|$)/);
      const dz = u.match(/deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/);
      if (sp && !out.spotify.includes(sp[1])) out.spotify.push(sp[1]);
      if (ap && !out.apple.includes(ap[1])) out.apple.push(ap[1]);
      if (dz && !out.deezer.includes(dz[1])) out.deezer.push(dz[1]);
    }
    return out;
  } catch { return null; }
}

// ── iTunes throttle guard: Apple persistently 403s this box; stop asking after a run of them ──
let itunes403Streak = 0;
let itunesDisabled = false;
const ITUNES_403_LIMIT = 15;

interface Candidate { id: string; name: string; name_native: string | null; country: string | null; mbid: string }
type Outcome = 'ingested' | 'would-ingest' | 'no-link' | 'ambiguous-link' | 'provider-unavailable' | 'no-albums' | 'already-has-releases' | 'name-mismatch' | 'alias-rejected' | 'error';
interface Result { id: string; name: string; outcome: Outcome; provider: string | null; groups: number; note: string; titles: string[] }

// ── Second signal: does the provider's artist NAME corroborate the MB link? ──
// The MB url-rel is the identity, but a mis-entered rel would hand us a stranger's ENTIRE
// discography — the highest-cost failure this script can have. So we cross-check the name and
// SKIP (reporting it) when it doesn't corroborate, rather than trusting one signal blindly.
// Deliberately lenient about romanization: iTunes/Deezer list Korean acts natively (스카이민혁)
// while we may store the Latin form (Skyminhyuk), so a substring or alias hit counts.
const nameKey = (s: string) => (s ?? '').toLowerCase()
  .replace(/[''`"]/g, '').replace(/[^\w가-힣぀-ゟ゠-ヿ一-鿿]/gu, '').trim();

// Names too weak to identify an artist on their own. Both halves were established empirically:
//   • short single-token CJK (김형우, 민수) — probed against iTunes, "김형우" returns exactly ONE
//     exact-name artistId, so a uniqueness test alone would wrongly ACCEPT it.
//   • short Latin (INE, exci) — a 3–5 character token collides freely across scenes; MB's
//     sort-name "INE" matched an unrelated Japanese act in the 2026-07-29 dry run.
const isGenericName = (n: string) => {
  const s = (n ?? '').trim();
  if (!s) return true;
  const cjk = (s.match(/[가-힣぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
  const single = s.split(/\s+/).length === 1;
  if (cjk > 0) return single && cjk <= 3;
  // Latin: a single-token romanized Korean GIVEN NAME ("Hansol", "Jihoon", "Minjun") is every bit
  // as collision-prone as its Hangul form, just longer — MB's alias "Hansol" for 지한솔 (Busan)
  // matched an unrelated iTunes "Hansol" in the 2026-07-29 dry run. Only a genuinely distinctive
  // single-token handle clears this ("Skyminhyuk" 10, "Briakitten" 10, "LILMONEY" 8).
  return single && s.length < 8;
};

// STRICT key for alias matching: case/punctuation-insensitive but WHITESPACE-PRESERVING.
// nameKey() deletes spaces, which made "Marineboy" and "Marine Boy" identical — that collapsed
// onto a different, 196-album artist in the 2026-07-29 dry run. A hard link can afford loose
// name corroboration; name-based *resolution* cannot.
const strictKey = (s: string) => (s ?? '').toLowerCase()
  .replace(/[''`"]/g, '').replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ').replace(/\s+/g, ' ').trim();

// NOTE: `sort-name` is deliberately EXCLUDED. It is a sorting key, not a performing name —
// MB stores "INE" as the sort-name for 아이네, and searching that matched an unrelated Japanese
// artist called INE, which would have written that act's discography onto a Korean one
// (caught in the 2026-07-29 dry run, before any write).
async function mbAliases(mbid: string): Promise<string[]> {
  await sleep(1100);
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=aliases&fmt=json`, { headers: { 'User-Agent': MB_UA } });
    if (!r.ok) return [];
    const j: any = await r.json();
    return [j.name, ...(j.aliases ?? []).map((a: any) => a.name)].filter(Boolean);
  } catch { return []; }
}

async function nameCorroborates(a: Candidate, providerName: string): Promise<boolean> {
  const p = nameKey(providerName);
  if (!p) return false;
  const ours = [a.name, a.name_native].filter(Boolean).map(s => nameKey(s as string));
  const hit = (c: string) => !!c && (c === p || c.includes(p) || p.includes(c));
  if (ours.some(hit)) return true;
  // Fall back to MB's own alias list — this is what bridges 스카이민혁 ↔ Skyminhyuk.
  return (await mbAliases(a.mbid)).map(nameKey).some(hit);
}

/** Guard: never write for an artist that has since gained releases (freshness lane race). */
async function stillEmpty(db: DB, artistId: string): Promise<boolean> {
  const { count: primary } = await db.from('release_groups').select('id', { count: 'exact', head: true }).eq('primary_artist_id', artistId);
  if ((primary ?? 0) > 0) return false;
  const { count: credited } = await db.from('release_group_artists').select('artist_id', { count: 'exact', head: true }).eq('artist_id', artistId);
  return (credited ?? 0) === 0;
}

// ── iTunes ingest (mirrors discover-itunes-recency's proven path, but with a known artist id) ──
async function ingestFromItunes(db: DB, a: Candidate, appleArtistId: number, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean; unavailable?: boolean }> {
  // Apple throttles this box persistently, so a 403 streak is a "come back later", NOT a verdict
  // about the artist — it must stay retryable or a bulk run would strand everyone processed after
  // the block kicked in.
  if (itunesDisabled) return { groups: 0, titles: [], note: 'itunes disabled (403 streak)', unavailable: true };
  const nativeLang = a.name_native ? 'ko' : (a.country === 'KR' ? 'ko' : null);
  let albums;
  try {
    albums = await fetchDiscography(appleArtistId);
    itunes403Streak = 0;
  } catch (e) {
    if (/403|429/.test((e as Error).message)) {
      if (++itunes403Streak >= ITUNES_403_LIMIT) { itunesDisabled = true; console.warn('  [itunes] disabling after 403 streak'); }
    }
    return { groups: 0, titles: [], note: `itunes error: ${(e as Error).message.slice(0, 80)}`, unavailable: true };
  }
  // Only releases credited to THIS artist id — the lookup also returns features/comps by others.
  const own = albums.filter((al: any) => al.artistId === appleArtistId);
  if (own.length === 0) return { groups: 0, titles: [], note: 'no albums under this apple id' };
  if (!(await nameCorroborates(a, own[0].artistName ?? ''))) {
    return { groups: 0, titles: [], note: `NAME MISMATCH: apple id credits "${own[0].artistName}"`, mismatch: true };
  }

  const ctx = createIngestContext(db, { dryRun: !write, withTracks: true, skipSingles: false });
  const { data: existing } = await db.from('release_groups').select('title').eq('primary_artist_id', a.id);
  const seen = new Set<string>((existing ?? []).map((r: any) => releaseGroupKey(r.title)));

  const titles: string[] = [];
  let groups = 0;
  let skippedErrors = 0;
  try {
    for (const al of own) {
      const key = releaseGroupKey(al.collectionName);
      if (seen.has(key)) continue;
      seen.add(key);
      // Found 2026-07-30: a single album's DB write (e.g. a recordings-insert statement timeout,
      // as happened to "Lino") threw out of the whole loop, aborting BEFORE the sweep-tag below
      // ever ran — every earlier album this call had already written was left source=NULL and
      // silently unreconcilable (63 groups on one artist, confirmed by direct audit). One album's
      // transient failure must never cost every other album's provenance tag.
      try {
        const date = (al.releaseDate ?? '').slice(0, 10);
        const rtype = releaseType(al.trackCount ?? 0, al.collectionName);
        const album: AlbumInput = {
          collectionId: al.collectionId, artistId: al.artistId, artistName: al.artistName,
          collectionName: al.collectionName, releaseDate: al.releaseDate, primaryGenreName: al.primaryGenreName,
          trackCount: al.trackCount, artworkUrl100: al.artworkUrl100, country: al.country,
        };
        const group = await findOrCreateReleaseGroup(ctx, {
          primaryArtistId: a.id, artistDisplay: al.artistName, title: al.collectionName,
          appReleaseType: rtype, firstReleaseDate: date || null,
          coverUrl: artworkUrl(al.artworkUrl100 ?? '') || null, genre: mapGenre(al.primaryGenreName ?? '') || null,
        });
        const tracks = write ? await fetchAlbumTracks(al.collectionId, nativeLang) : [];
        const native = detectLanguage(al.collectionName)
          ? { titleNative: al.collectionName, artistNative: a.name_native ?? al.artistName, nativeLanguage: detectLanguage(al.collectionName)! }
          : null;
        const result = await ingestEdition(ctx, { album, primaryArtistId: a.id, group, native, tracks });
        titles.push(`${date || '????'} ${al.collectionName}`);
        if (result === 'inserted') groups++; // 'skipped' = dup itunes_id; must not be counted as gained
      } catch (e) {
        skippedErrors++;
        console.warn(`  [itunes] "${al.collectionName}" failed, skipping this album: ${(e as Error).message.slice(0, 100)}`);
      }
    }
  } finally {
    // ALWAYS runs, even if the loop above threw somewhere the per-album catch didn't cover —
    // whatever made it into the DB this call gets tagged, belt-and-suspenders on top of the
    // per-album catch. Idempotent (`.is('source', null)`), so re-running it costs nothing.
    if (write && groups > 0) {
      await db.from('release_groups').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
      const { data: rgIds } = await db.from('release_groups').select('id').eq('primary_artist_id', a.id);
      for (const rg of (rgIds ?? []) as any[]) {
        await db.from('releases').update({ source: 'itunes' }).eq('release_group_id', rg.id).is('source', null);
      }
      await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
    }
  }
  // All attempts failed transiently (not a genuine empty catalog) -> retryable, not terminal.
  if (groups === 0 && skippedErrors > 0) {
    return { groups, titles, note: `${skippedErrors} album(s) failed and were skipped`, unavailable: true };
  }
  return { groups, titles, note: skippedErrors ? `${skippedErrors} album(s) failed and were skipped` : '' };
}

// ── Deezer ingest (mirrors mb-deezer-fallback's writer, but never creates an artist) ──
async function ingestFromDeezer(db: DB, a: Candidate, dzArtistId: number, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean; unavailable?: boolean }> {
  // artistAlbums() is id-scoped but returns no artist name, so read the artist entity for the
  // corroboration check — same guard as the iTunes path.
  let dzName = '';
  try {
    const r = await fetch(`https://api.deezer.com/artist/${dzArtistId}`);
    if (r.ok) dzName = ((await r.json()) as any)?.name ?? '';
  } catch { /* fall through to the mismatch guard */ }
  if (!(await nameCorroborates(a, dzName))) {
    return { groups: 0, titles: [], note: `NAME MISMATCH: deezer id is "${dzName || '(unknown)'}"`, mismatch: true };
  }

  const albums = (await artistAlbums(dzArtistId)).filter(al => al.recordType !== 'compilation');
  if (albums.length === 0) return { groups: 0, titles: [], note: 'no albums under this deezer id' };

  const { data: existing } = await db.from('release_groups').select('title').eq('primary_artist_id', a.id);
  const seen = new Set<string>((existing ?? []).map((r: any) => releaseGroupKey(r.title)));
  const display = a.name_native ?? a.name;

  const titles: string[] = [];
  let groups = 0;
  let skippedErrors = 0;
  for (const al of albums) {
    const key = releaseGroupKey(al.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const date = (al.releaseDate || '').slice(0, 10) || null;
    titles.push(`${date ?? '????'} ${al.title}`);
    if (!write) { groups++; continue; }

    // Isolated per-album (2026-07-30, same lesson as the iTunes path's "Lino" incident): a
    // recordings/release_tracks failure partway through must not abort every remaining album for
    // this artist — that turns one transient DB error into a whole-artist outcome:'error' that
    // then needs a full re-scan to retry, instead of just this one album.
    try {
      const detail = await albumWithTracks(al.id, true);
      if (!detail || detail.tracks.length === 0) continue;
      const rgId = randomUUID();
      const genre = mapGenre(detail.genre ?? '') || null;
      const native = detectLanguage(al.title) ? al.title : null;
      const { error: rgErr } = await db.from('release_groups').insert({
        id: rgId, primary_artist_id: a.id, artist_display: display, title: al.title,
        release_group_type: ['album', 'ep', 'single'].includes(al.recordType) ? al.recordType : 'album',
        first_release_date: date, cover_url: detail.cover || al.cover || null,
        genres: genre ? [genre] : null, native_title: native, source: 'deezer',
      });
      if (rgErr) throw new Error(`release_group "${al.title}": ${rgErr.message}`);

      const relId = randomUUID();
      const { error: relErr } = await db.from('releases').insert({
        id: relId, release_group_id: rgId, is_canonical: true, region: a.country,
        title: al.title, artist: display, release_date: date, release_type: al.recordType,
        cover_url: detail.cover || al.cover || null, total_tracks: detail.tracks.length,
        source: 'deezer', cached_at: nowIso(),
      });
      if (relErr) {
        // The release_group above DID commit — never leave it orphaned (0 releases). Clean it up
        // so a future run's `seen` (built from titles) doesn't wrongly think this title exists.
        await db.from('release_groups').delete().eq('id', rgId);
        throw new Error(`release "${al.title}": ${relErr.message}`);
      }

      const recs = detail.tracks.map(t => ({
        id: randomUUID(), primary_artist_id: a.id, artist_display: t.artists || display,
        title: t.title, isrc: t.isrc, duration_ms: t.durationMs, source: 'deezer',
      }));
      const { error: recErr } = await db.from('recordings').insert(recs);
      if (recErr) throw new Error(`recordings "${al.title}": ${recErr.message}`);
      const rts = detail.tracks.map((t, i) => ({ release_id: relId, recording_id: recs[i].id, position: t.position, disc_number: t.discNumber }));
      const { error: rtErr } = await db.from('release_tracks').insert(rts);
      if (rtErr) throw new Error(`release_tracks "${al.title}": ${rtErr.message}`);
      groups++;
    } catch (e) {
      skippedErrors++;
      console.warn(`  [deezer] "${al.title}" failed, skipping this album: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  // All attempts failed transiently (not a genuine empty catalog) -> retryable, not terminal.
  if (groups === 0 && skippedErrors > 0) {
    return { groups, titles, note: `${skippedErrors} album(s) failed and were skipped`, unavailable: true };
  }
  return { groups, titles, note: skippedErrors ? `${skippedErrors} album(s) failed and were skipped` : '' };
}

// ── TIER 2 (opt-in, --tier=alias): MB-alias-corroborated iTunes resolution ──
//
// Weaker than a URL rel and deliberately separate. Two INDEPENDENT gates, both load-bearing —
// probed 2026-07-29 against real iTunes data:
//   UNIQUENESS     "이민영" returns 3 distinct artistIds with that exact name → abstain.
//   DISTINCTIVENESS "김형우" returns exactly ONE exact-name artistId, so uniqueness alone would
//                  have ACCEPTED it — but a 3-char Hangul personal name is a coin-flip on whether
//                  it's *our* 김형우, so the generic-name guard rejects it anyway.
// Only a name that is both unique on iTunes and distinctive enough to mean something passes
// (스카이민혁 → 1475047483, correct). We search MB's ALIASES, not just our stored name: iTunes
// lists Korean acts natively, so the Latin "Skyminhyuk" returns 0 exact matches while the MB alias
// "스카이민혁" resolves cleanly.
const ITUNES_SEARCH_DELAY = 900;
async function itunesSearchAlbums(term: string, store: string | null): Promise<any[] | null> {
  await sleep(ITUNES_SEARCH_DELAY + Math.floor(Math.random() * 300));
  try {
    const c = store ? `&country=${store}` : '';
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=50${c}`,
      { headers: { 'User-Agent': 'sillajuku-empty-resolver/1.0' } });
    if (r.status === 403 || r.status === 429) {
      if (++itunes403Streak >= ITUNES_403_LIMIT) { itunesDisabled = true; console.warn('  [itunes] disabling after 403 streak'); }
      return null;
    }
    if (!r.ok) return null;
    itunes403Streak = 0;
    return ((await r.json()) as any).results ?? [];
  } catch { return null; }
}

async function resolveItunesByAlias(a: Candidate): Promise<{ artistId: number; via: string } | { reject: string }> {
  const store = a.country === 'KR' ? 'KR' : a.country === 'JP' ? 'JP' : null;
  const names = [...new Set([a.name_native, a.name, ...(await mbAliases(a.mbid))].filter(Boolean) as string[])];
  // Native-script names first: that's how the stores actually list these acts.
  names.sort((x, y) => (/[가-힣぀-ゟ゠-ヿ一-鿿]/.test(y) ? 1 : 0) - (/[가-힣぀-ゟ゠-ヿ一-鿿]/.test(x) ? 1 : 0));

  let sawGeneric = false;
  for (const nm of names) {
    if (isGenericName(nm)) { sawGeneric = true; continue; } // never auto-accept a generic name
    if (itunesDisabled) return { reject: 'itunes disabled (403 streak)' };
    const results = await itunesSearchAlbums(nm, store);
    if (!results?.length) continue;

    const byArtist = new Map<number, string>();
    for (const c of results) if (c.collectionId && c.artistId) byArtist.set(c.artistId, c.artistName ?? '');
    const want = strictKey(nm);
    const exact = [...byArtist.entries()].filter(([, an]) => strictKey(an) === want);

    if (exact.length > 1) {
      // A collision is a red flag about the NAME itself — stop, don't try to get lucky on another.
      return { reject: `${exact.length} iTunes artists share the exact name "${nm}"` };
    }
    if (exact.length === 1) {
      // COHERENCE CHECK — found 2026-07-31 auditing a full alias-tier sweep: "Christina" (52
      // groups) passed uniqueness AND the distinctiveness guard (9 chars), but its one iTunes
      // artistId turned out to itself be an Apple-side mis-merge of unrelated people sharing that
      // mononym — German Christmas harp music, Spanish pop, a Korean kids' song, and Russian pop,
      // spanning 1991–2026. Uniqueness only proves ONE iTunes id exists for the name; it says
      // nothing about whether that id's own catalog is internally coherent. A single artist's
      // catalog spanning >25 years is possible but rare for this pipeline's population (mostly
      // active/modern acts) and was the single reliable signal that separated "Christina" from
      // clean matches like Zack Knight (11yr) or Rajvir Jawanda (11yr) — reject rather than guess.
      const disco = await fetchDiscography(exact[0][0]);
      const years = disco
        .map(al => Number((al.releaseDate ?? '').slice(0, 4)))
        .filter(y => y > 1900 && y <= new Date().getUTCFullYear() + 1);
      if (years.length >= 2) {
        const span = Math.max(...years) - Math.min(...years);
        if (span > 25) return { reject: `catalog spans ${span} years (${Math.min(...years)}–${Math.max(...years)}) — likely a merged/ambiguous identity, not one artist` };
      }
      return { artistId: exact[0][0], via: nm };
    }
  }
  return { reject: sawGeneric ? 'only generic/collision-prone names available' : 'no exact iTunes name match' };
}

// ── Spotify ingest (the majority of hard links) ──
// Direct inserts rather than ingest-core, because `releases.spotify_id` is UNIQUE — that gives this
// path the same DB-enforced re-run safety the iTunes path gets from UNIQUE(itunes_id), which the
// Deezer path cannot have (there is no deezer id column).
// Self-imposed backpressure, not just reaction to a 429. The breaker tripped TWICE running this
// script (2026-07-29 from an unthrottled helper script; 2026-07-30 from THIS function despite a
// 250ms per-album sleep, ~630 artists into an ~8,700-artist sweep) — reacting after Spotify tells
// us to stop is too late once a sustained bulk run is already mid-flight. Every Spotify-bound call
// in this function goes through here first: a per-call minimum spacing, plus a longer forced
// cooldown every SPOTIFY_BUDGET_CHUNK calls, proactively, before any 429 ever happens.
// UNVERIFIED LIVE as of 2026-07-30 — the breaker (open until 2026-08-01 03:27 UTC) blocked testing
// this. Start the next Spotify run small (--limit) and confirm no 429s before trusting it at scale.
let spotifyCallCount = 0;
const SPOTIFY_MIN_SPACING_MS = 600;
const SPOTIFY_BUDGET_CHUNK = 40;
const SPOTIFY_BUDGET_COOLDOWN_MS = 8000;
async function spotifyPace(): Promise<void> {
  spotifyCallCount++;
  await sleep(SPOTIFY_MIN_SPACING_MS);
  if (spotifyCallCount % SPOTIFY_BUDGET_CHUNK === 0) await sleep(SPOTIFY_BUDGET_COOLDOWN_MS);
}

async function ingestFromSpotify(db: DB, a: Candidate, spotifyArtistId: string, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean; unavailable?: boolean }> {
  // Fail loudly rather than hammering a rate-limited API — the breaker is shared with production.
  try { await assertSpotifyCircuitClosed(); }
  catch (e) { return { groups: 0, titles: [], note: (e as Error).message.slice(0, 90), unavailable: true }; }

  await spotifyPace();
  const artist = await getSpotifyArtist(spotifyArtistId);
  if (!artist) return { groups: 0, titles: [], note: 'spotify artist lookup failed', unavailable: true };
  if (!(await nameCorroborates(a, artist.name))) {
    return { groups: 0, titles: [], note: `NAME MISMATCH: spotify id is "${artist.name}"`, mismatch: true };
  }

  // NOTE: getSpotifyArtistAlbums swallows every error and returns [] — indistinguishable from an
  // artist who genuinely has no albums (the same silent-failure shape as the getReleaseTracks bug
  // fixed 2026-07-22). Re-check the breaker on an empty result so a rate-limit mid-run is never
  // recorded as the terminal verdict "this artist has nothing".
  await spotifyPace();
  const page = await getSpotifyArtistAlbums(spotifyArtistId); // no artistName → no name-search fallback
  if (page.releases.length === 0) {
    try { await assertSpotifyCircuitClosed(); }
    catch { return { groups: 0, titles: [], note: 'lookup failed (breaker opened mid-run)', unavailable: true }; }
    return { groups: 0, titles: [], note: 'no albums under this spotify id' };
  }

  const { data: existing } = await db.from('release_groups').select('title').eq('primary_artist_id', a.id);
  const seen = new Set<string>((existing ?? []).map((r: any) => releaseGroupKey(r.title)));
  const display = a.name_native ?? a.name;

  const titles: string[] = [];
  let groups = 0;
  let skippedErrors = 0;
  for (const al of page.releases) {
    const key = releaseGroupKey(al.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const date = (al.date || '').slice(0, 10) || null;

    // Found testing "Briakitten" (2026-07-30): getSpotifyArtistAlbums surfaces some releases
    // (compilations/OSTs) whose OWN metadata credits a DIFFERENT artist id — Spotify's artist-
    // discography endpoint doesn't mark these 'appears_on' the way it does true guest features, so
    // the lib-level filter lets them through. The detail-level artist-id check below is what
    // actually excludes them, correctly (attaching someone else's soundtrack credit to this artist
    // would be exactly the wrong-attribution class this script exists to prevent) — but it used to
    // run AFTER the dry-run's `!write` shortcut already counted the album, so dry-run reported 6
    // "would ingest" for an artist a real --write only wrote 2 for. Moved the check before both
    // paths so dry-run and write agree — costs dry-run one extra Spotify call per candidate album,
    // worth it given tonight's running theme of inflated numbers (Marineboy, 아이네, 한솔).
    await spotifyPace();
    let detail;
    try { detail = await getSpotifyAlbum(al.spotifyId ?? al.id); }
    catch { detail = null; }
    if (!detail || detail.tracks.length === 0) continue;
    if (detail.artists?.length && !detail.artists.some(ar => ar.id === spotifyArtistId)) continue;

    titles.push(`${date ?? '????'} ${al.title}`);
    if (!write) { groups++; continue; }

    // Isolated per-album (same lesson as the iTunes "Lino" incident, 2026-07-30): one album's DB
    // failure must not abort every remaining album for this artist.
    try {
      const rgType = ['album', 'ep', 'single'].includes((al.releaseType ?? '').toLowerCase())
        ? (al.releaseType as string).toLowerCase() : 'album';
      const rgId = randomUUID();
      const native = detectLanguage(al.title) ? al.title : null;
      const { error: rgErr } = await db.from('release_groups').insert({
        id: rgId, primary_artist_id: a.id, artist_display: display, title: al.title,
        release_group_type: rgType, first_release_date: date, cover_url: al.coverUrl ?? null,
        genres: detail.genres?.length ? [mapGenre(detail.genres[0])].filter(Boolean) : null,
        native_title: native, source: 'spotify',
      });
      if (rgErr) throw new Error(`release_group "${al.title}": ${rgErr.message}`);

      const relId = randomUUID();
      const { error: relErr } = await db.from('releases').insert({
        id: relId, release_group_id: rgId, is_canonical: true, region: a.country,
        spotify_id: al.spotifyId ?? al.id, title: al.title, artist: display, release_date: date,
        release_type: rgType, cover_url: al.coverUrl ?? null, total_tracks: detail.tracks.length,
        source: 'spotify', cached_at: nowIso(),
      });
      if (relErr) {
        // 23505 = UNIQUE(spotify_id): this edition already exists → drop the just-made group so we
        // never strand an empty release_group, and move on.
        if ((relErr as { code?: string }).code === '23505') {
          await db.from('release_groups').delete().eq('id', rgId);
          continue;
        }
        await db.from('release_groups').delete().eq('id', rgId); // never leave a 0-release group
        throw new Error(`release "${al.title}": ${relErr.message}`);
      }

      const recs = detail.tracks.map(t => ({
        id: randomUUID(), primary_artist_id: a.id, artist_display: t.artists || display,
        title: t.title, duration_ms: t.durationMs, source: 'spotify',
      }));
      const { error: recErr } = await db.from('recordings').insert(recs);
      if (recErr) throw new Error(`recordings "${al.title}": ${recErr.message}`);
      const rts = detail.tracks.map((t, i) => ({ release_id: relId, recording_id: recs[i].id, position: t.position, disc_number: 1 }));
      const { error: rtErr } = await db.from('release_tracks').insert(rts);
      if (rtErr) throw new Error(`release_tracks "${al.title}": ${rtErr.message}`);
      groups++;
    } catch (e) {
      skippedErrors++;
      console.warn(`  [spotify] "${al.title}" failed, skipping this album: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  // All attempts failed transiently (not a genuine empty catalog) -> retryable, not terminal.
  if (groups === 0 && skippedErrors > 0) {
    return { groups, titles, note: `${skippedErrors} album(s) failed and were skipped`, unavailable: true };
  }
  return { groups, titles, note: skippedErrors ? `${skippedErrors} album(s) failed and were skipped` : '' };
}

async function resolveOne(db: DB, a: Candidate, write: boolean, spotifyUsable: boolean): Promise<Result> {
  const base: Result = { id: a.id, name: a.name, outcome: 'no-link', provider: null, groups: 0, note: '', titles: [] };

  const links = await mbHardLinks(a.mbid);
  if (!links) return { ...base, outcome: 'error', note: 'MB lookup failed' };
  const noHardLink = !links.spotify.length && !links.apple.length && !links.deezer.length;
  if (noHardLink && !ALIAS_TIER) return base; // 'no-link'

  // MB listing two different ids for ONE provider means MB is unsure about THAT provider — it says
  // nothing about the others. Judge each independently (Skyminhyuk has one clean Spotify id and two
  // Deezer ids; discarding the whole artist over the Deezer ambiguity would throw away a hard link).
  const usable = {
    apple: links.apple.length === 1 ? links.apple[0] : null,
    deezer: links.deezer.length === 1 ? links.deezer[0] : null,
    spotify: links.spotify.length === 1 ? links.spotify[0] : null,
  };
  const ambiguous = Object.entries(links).filter(([, v]) => (v as string[]).length > 1).map(([k, v]) => `${(v as string[]).length} ${k}`);
  if (!usable.apple && !usable.deezer && !usable.spotify && !ALIAS_TIER) {
    return { ...base, outcome: 'ambiguous-link', note: `no unambiguous link (${ambiguous.join(', ')})` };
  }

  if (!(await stillEmpty(db, a.id))) return { ...base, outcome: 'already-has-releases', note: 'gained releases since selection — skipped' };

  // Provider preference: iTunes and Deezer are direct-id lookups we already ingest from.
  if (usable.apple && !itunesDisabled) {
    const r = await ingestFromItunes(db, a, Number(usable.apple), write);
    if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'itunes', groups: r.groups, titles: r.titles, note: r.note };
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'itunes', note: r.note };
    if (r.unavailable) return { ...base, outcome: 'provider-unavailable', provider: 'itunes', note: r.note };
    if (r.note) return { ...base, outcome: 'no-albums', provider: 'itunes', note: r.note };
  }
  if (usable.deezer) {
    const r = await ingestFromDeezer(db, a, Number(usable.deezer), write);
    if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'deezer', groups: r.groups, titles: r.titles, note: r.note };
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'deezer', note: r.note };
    if (r.unavailable) return { ...base, outcome: 'provider-unavailable', provider: 'deezer', note: r.note };
    if (r.note) return { ...base, outcome: 'no-albums', provider: 'deezer', note: r.note };
  }
  // Tracks a hard link we couldn't USE (e.g. Spotify breaker open) so that, if the alias tier is
  // also unavailable, we report the more informative 'provider-unavailable' rather than a
  // terminal-sounding verdict — this artist is still recoverable on a later run.
  let unavailableNote: string | null = null;
  if (usable.spotify) {
    if (!spotifyUsable) unavailableNote = 'spotify link only — circuit breaker OPEN at start of run';
    else {
      const r = await ingestFromSpotify(db, a, usable.spotify, write);
      if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'spotify', groups: r.groups, titles: r.titles, note: r.note };
      if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'spotify', note: r.note };
      // Not a terminal verdict — leave it re-runnable rather than recording "nothing to find".
      if (r.unavailable) unavailableNote = r.note;
      else if (r.note) return { ...base, outcome: 'no-albums', provider: 'spotify', note: r.note };
    }
    // Fall through to the alias tier when enabled: the hard link being unreachable right now says
    // nothing about whether iTunes can identify this artist by a corroborated name.
    if (!ALIAS_TIER) return { ...base, outcome: 'provider-unavailable', provider: 'spotify', note: unavailableNote ?? '' };
  }

  // TIER 2 fallback — only when no hard link could be used, and only when explicitly enabled.
  if (ALIAS_TIER && !itunesDisabled) {
    const res = await resolveItunesByAlias(a);
    if ('reject' in res) {
      // An unusable hard link outranks an alias rejection: it means "try again later", not "no".
      if (unavailableNote) return { ...base, outcome: 'provider-unavailable', provider: 'spotify', note: `${unavailableNote}; alias fallback: ${res.reject}` };
      // A 403 block is likewise not a verdict about this artist — keep it retryable.
      if (/itunes disabled/.test(res.reject)) return { ...base, outcome: 'provider-unavailable', provider: 'itunes-alias', note: res.reject };
      return { ...base, outcome: 'alias-rejected', note: res.reject };
    }
    const r = await ingestFromItunes(db, a, res.artistId, write);
    if (r.groups > 0) {
      return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: `itunes-alias`, groups: r.groups, titles: r.titles, note: `matched via "${res.via}"` };
    }
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'itunes-alias', note: r.note };
    if (r.unavailable) return { ...base, outcome: 'provider-unavailable', provider: 'itunes-alias', note: r.note };
    return { ...base, outcome: 'no-albums', provider: 'itunes-alias', note: r.note || 'alias resolved but no albums' };
  }
  return { ...base, outcome: 'no-albums', note: 'links present but no usable provider' };
}

async function main() {
  const db = getDB();

  let spotifyUsable = true;
  try { await assertSpotifyCircuitClosed(); } catch (e) { spotifyUsable = false; console.warn(`⚠ ${(e as Error).message}\n`); }

  console.log(`${WRITE ? '⚠ LIVE — WRITES TO CATALOG' : 'DRY-RUN (no writes)'} · ${ALIAS_TIER ? 'hard-link + MB-alias iTunes tier' : 'hard-link tier only'}\n`);

  let rows = await sql<Candidate>(`
    select a.id, a.name, a.name_native, a.country, e.external_id as mbid
    from artists a
    join artist_external_ids e on e.artist_id = a.id and e.source = 'musicbrainz'
    where not exists (select 1 from release_group_artists rga where rga.artist_id = a.id)
      and not exists (select 1 from release_groups rg where rg.primary_artist_id = a.id)
      ${ARTIST ? `and a.name ilike '${ARTIST.replace(/'/g, "''")}'` : ''}
      ${COUNTRY ? `and a.country = '${COUNTRY}'` : ''}
    order by md5(a.id::text)
    ${ALL ? '' : `limit ${LIMIT}`}
  `);
  if (!rows.length) { console.log('No matching zero-release artists.'); return; }
  if (ONLY_IDS) {
    const before = rows.length;
    rows = rows.filter(r => ONLY_IDS.has(r.id));
    console.log(`--only-ids: ${rows.length} of ${before} candidates approved for this run.`);
    if (!rows.length) { console.log('None of the supplied ids are still zero-release artists.'); return; }
  }

  let done: Result[] = [];
  if (RESUME && fs.existsSync(STATE)) {
    done = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log(`Resuming — ${done.length} already processed.`);
  }
  // Only TERMINAL verdicts are "done". 'provider-unavailable' and 'error' mean "couldn't check
  // right now" (Spotify breaker open, MB timeout) — skipping those on resume would silently
  // strand every artist whose link we simply hadn't been able to read yet.
  const RETRYABLE = new Set<Outcome>(['provider-unavailable', 'error']);
  const settled = new Set(done.filter(r => !RETRYABLE.has(r.outcome)).map(r => r.id));
  const retryCount = done.filter(r => RETRYABLE.has(r.outcome)).length;
  done = done.filter(r => !RETRYABLE.has(r.outcome)); // drop stale non-terminal rows; they re-run
  const todo = rows.filter(r => !settled.has(r.id));
  console.log(`${rows.length} candidates · ${todo.length} to process${retryCount ? ` (incl. ${retryCount} retryable from a previous run)` : ''}\n`);

  let n = 0;
  for (const a of todo) {
    let r: Result;
    try { r = await resolveOne(db, a, WRITE, spotifyUsable); }
    catch (e) { r = { id: a.id, name: a.name, outcome: 'error', provider: null, groups: 0, note: (e as Error).message.slice(0, 120), titles: [] }; }
    done.push(r);
    if (r.outcome === 'ingested' || r.outcome === 'would-ingest') {
      console.log(`  ${r.outcome === 'ingested' ? '✔ INGESTED' : '→ would ingest'} ${r.name} — ${r.groups} groups via ${r.provider}`);
      for (const t of r.titles.slice(0, 6)) console.log(`      ${t}`);
      if (r.titles.length > 6) console.log(`      … +${r.titles.length - 6} more`);
    } else if (r.outcome === 'error' || r.outcome === 'ambiguous-link') {
      console.log(`  ! ${r.outcome} ${r.name} — ${r.note}`);
    }
    if (++n % 20 === 0) { fs.writeFileSync(STATE, JSON.stringify(done)); console.log(`  … ${n}/${todo.length}`); }
  }
  fs.writeFileSync(STATE, JSON.stringify(done));

  const by: Record<string, Result[]> = {};
  for (const r of done) (by[r.outcome] ??= []).push(r);
  console.log(`\n════ ${WRITE ? 'WROTE' : 'DRY-RUN'} — ${done.length} artists ════`);
  for (const [k, v] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) {
    console.log(`${k.padEnd(22)} ${String(v.length).padStart(5)}`);
  }
  const gained = done.filter(r => r.outcome === 'ingested' || r.outcome === 'would-ingest');
  const groups = gained.reduce((s, r) => s + r.groups, 0);
  console.log(`\nArtists recovered: ${gained.length} · release groups ${WRITE ? 'written' : 'that would be written'}: ${groups}`);
  if (!WRITE && gained.length) console.log(`Re-run with --write to commit. Provenance: source='itunes'/'deezer', linked to MB later by reconcile:itunes.`);
}

main().catch(e => { console.error(e); process.exit(1); });
