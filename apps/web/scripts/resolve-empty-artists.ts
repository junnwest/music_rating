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
type Outcome = 'ingested' | 'would-ingest' | 'no-link' | 'ambiguous-link' | 'provider-unavailable' | 'no-albums' | 'already-has-releases' | 'name-mismatch' | 'error';
interface Result { id: string; name: string; outcome: Outcome; provider: string | null; groups: number; note: string; titles: string[] }

// ── Second signal: does the provider's artist NAME corroborate the MB link? ──
// The MB url-rel is the identity, but a mis-entered rel would hand us a stranger's ENTIRE
// discography — the highest-cost failure this script can have. So we cross-check the name and
// SKIP (reporting it) when it doesn't corroborate, rather than trusting one signal blindly.
// Deliberately lenient about romanization: iTunes/Deezer list Korean acts natively (스카이민혁)
// while we may store the Latin form (Skyminhyuk), so a substring or alias hit counts.
const nameKey = (s: string) => (s ?? '').toLowerCase()
  .replace(/[''`"]/g, '').replace(/[^\w가-힣぀-ゟ゠-ヿ一-鿿]/gu, '').trim();

async function mbAliases(mbid: string): Promise<string[]> {
  await sleep(1100);
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=aliases&fmt=json`, { headers: { 'User-Agent': MB_UA } });
    if (!r.ok) return [];
    const j: any = await r.json();
    return [j.name, j['sort-name'], ...(j.aliases ?? []).map((a: any) => a.name)].filter(Boolean);
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
async function ingestFromItunes(db: DB, a: Candidate, appleArtistId: number, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean }> {
  if (itunesDisabled) return { groups: 0, titles: [], note: 'itunes disabled (403 streak)' };
  const nativeLang = a.name_native ? 'ko' : (a.country === 'KR' ? 'ko' : null);
  let albums;
  try {
    albums = await fetchDiscography(appleArtistId);
    itunes403Streak = 0;
  } catch (e) {
    if (/403|429/.test((e as Error).message)) {
      if (++itunes403Streak >= ITUNES_403_LIMIT) { itunesDisabled = true; console.warn('  [itunes] disabling after 403 streak'); }
    }
    return { groups: 0, titles: [], note: `itunes error: ${(e as Error).message.slice(0, 80)}` };
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
  for (const al of own) {
    const key = releaseGroupKey(al.collectionName);
    if (seen.has(key)) continue;
    seen.add(key);
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
  }
  if (write && groups > 0) {
    // Sweep-tag AFTER the loop, artist-scoped. Doing it per-group left a crash window: an
    // interrupt between the release_group insert and its source update would strand a source=NULL
    // row, which reconcile-itunes-mb (source in itunes/deezer) would never pick up — an
    // unreconcilable row that becomes a cross-source duplicate when MB catalogs the album. A
    // sweep also self-heals any such row left by an earlier interrupted run.
    await db.from('release_groups').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
    const { data: rgIds } = await db.from('release_groups').select('id').eq('primary_artist_id', a.id);
    for (const rg of (rgIds ?? []) as any[]) {
      await db.from('releases').update({ source: 'itunes' }).eq('release_group_id', rg.id).is('source', null);
    }
    await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
  }
  return { groups, titles, note: '' };
}

// ── Deezer ingest (mirrors mb-deezer-fallback's writer, but never creates an artist) ──
async function ingestFromDeezer(db: DB, a: Candidate, dzArtistId: number, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean }> {
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
  for (const al of albums) {
    const key = releaseGroupKey(al.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const date = (al.releaseDate || '').slice(0, 10) || null;
    titles.push(`${date ?? '????'} ${al.title}`);
    if (!write) { groups++; continue; }

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
    if (relErr) throw new Error(`release "${al.title}": ${relErr.message}`);

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
  }
  return { groups, titles, note: '' };
}

// ── Spotify ingest (the majority of hard links) ──
// Direct inserts rather than ingest-core, because `releases.spotify_id` is UNIQUE — that gives this
// path the same DB-enforced re-run safety the iTunes path gets from UNIQUE(itunes_id), which the
// Deezer path cannot have (there is no deezer id column).
async function ingestFromSpotify(db: DB, a: Candidate, spotifyArtistId: string, write: boolean): Promise<{ groups: number; titles: string[]; note: string; mismatch?: boolean; unavailable?: boolean }> {
  // Fail loudly rather than hammering a rate-limited API — the breaker is shared with production.
  try { await assertSpotifyCircuitClosed(); }
  catch (e) { return { groups: 0, titles: [], note: (e as Error).message.slice(0, 90), unavailable: true }; }

  const artist = await getSpotifyArtist(spotifyArtistId);
  if (!artist) return { groups: 0, titles: [], note: 'spotify artist lookup failed', unavailable: true };
  if (!(await nameCorroborates(a, artist.name))) {
    return { groups: 0, titles: [], note: `NAME MISMATCH: spotify id is "${artist.name}"`, mismatch: true };
  }

  // NOTE: getSpotifyArtistAlbums swallows every error and returns [] — indistinguishable from an
  // artist who genuinely has no albums (the same silent-failure shape as the getReleaseTracks bug
  // fixed 2026-07-22). Re-check the breaker on an empty result so a rate-limit mid-run is never
  // recorded as the terminal verdict "this artist has nothing".
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
  for (const al of page.releases) {
    const key = releaseGroupKey(al.title);
    if (seen.has(key)) continue;
    seen.add(key);
    const date = (al.date || '').slice(0, 10) || null;
    titles.push(`${date ?? '????'} ${al.title}`);
    if (!write) { groups++; continue; }

    const detail = await getSpotifyAlbum(al.spotifyId ?? al.id);
    if (!detail || detail.tracks.length === 0) continue;
    // Guard the fallback path inside getSpotifyArtistAlbums: only ingest what this artist is on.
    if (detail.artists?.length && !detail.artists.some(ar => ar.id === spotifyArtistId)) continue;

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
    await sleep(250); // gentle: this is the shared production Spotify credential
  }
  return { groups, titles, note: '' };
}

async function resolveOne(db: DB, a: Candidate, write: boolean, spotifyUsable: boolean): Promise<Result> {
  const base: Result = { id: a.id, name: a.name, outcome: 'no-link', provider: null, groups: 0, note: '', titles: [] };

  const links = await mbHardLinks(a.mbid);
  if (!links) return { ...base, outcome: 'error', note: 'MB lookup failed' };
  if (!links.spotify.length && !links.apple.length && !links.deezer.length) return base;

  // MB listing two different ids for ONE provider means MB is unsure about THAT provider — it says
  // nothing about the others. Judge each independently (Skyminhyuk has one clean Spotify id and two
  // Deezer ids; discarding the whole artist over the Deezer ambiguity would throw away a hard link).
  const usable = {
    apple: links.apple.length === 1 ? links.apple[0] : null,
    deezer: links.deezer.length === 1 ? links.deezer[0] : null,
    spotify: links.spotify.length === 1 ? links.spotify[0] : null,
  };
  const ambiguous = Object.entries(links).filter(([, v]) => (v as string[]).length > 1).map(([k, v]) => `${(v as string[]).length} ${k}`);
  if (!usable.apple && !usable.deezer && !usable.spotify) {
    return { ...base, outcome: 'ambiguous-link', note: `no unambiguous link (${ambiguous.join(', ')})` };
  }

  if (!(await stillEmpty(db, a.id))) return { ...base, outcome: 'already-has-releases', note: 'gained releases since selection — skipped' };

  // Provider preference: iTunes and Deezer are direct-id lookups we already ingest from.
  if (usable.apple && !itunesDisabled) {
    const r = await ingestFromItunes(db, a, Number(usable.apple), write);
    if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'itunes', groups: r.groups, titles: r.titles, note: r.note };
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'itunes', note: r.note };
    if (r.note) return { ...base, outcome: 'no-albums', provider: 'itunes', note: r.note };
  }
  if (usable.deezer) {
    const r = await ingestFromDeezer(db, a, Number(usable.deezer), write);
    if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'deezer', groups: r.groups, titles: r.titles, note: r.note };
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'deezer', note: r.note };
    if (r.note) return { ...base, outcome: 'no-albums', provider: 'deezer', note: r.note };
  }
  if (usable.spotify) {
    if (!spotifyUsable) return { ...base, outcome: 'provider-unavailable', provider: 'spotify', note: 'circuit breaker OPEN at start of run' };
    const r = await ingestFromSpotify(db, a, usable.spotify, write);
    if (r.groups > 0) return { ...base, outcome: write ? 'ingested' : 'would-ingest', provider: 'spotify', groups: r.groups, titles: r.titles, note: r.note };
    if (r.mismatch) return { ...base, outcome: 'name-mismatch', provider: 'spotify', note: r.note };
    // Not a terminal verdict — leave it re-runnable rather than recording "nothing to find".
    if (r.unavailable) return { ...base, outcome: 'provider-unavailable', provider: 'spotify', note: r.note };
    if (r.note) return { ...base, outcome: 'no-albums', provider: 'spotify', note: r.note };
  }
  return { ...base, outcome: 'no-albums', note: 'links present but no usable provider' };
}

async function main() {
  const db = getDB();

  let spotifyUsable = true;
  try { await assertSpotifyCircuitClosed(); } catch (e) { spotifyUsable = false; console.warn(`⚠ ${(e as Error).message}\n`); }

  console.log(`${WRITE ? '⚠ LIVE — WRITES TO CATALOG' : 'DRY-RUN (no writes)'} · hard-link tier only\n`);

  const rows = await sql<Candidate>(`
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

  let done: Result[] = [];
  if (RESUME && fs.existsSync(STATE)) {
    done = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log(`Resuming — ${done.length} already processed.`);
  }
  const seen = new Set(done.map(r => r.id));
  const todo = rows.filter(r => !seen.has(r.id));
  console.log(`${rows.length} candidates · ${todo.length} to process\n`);

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
