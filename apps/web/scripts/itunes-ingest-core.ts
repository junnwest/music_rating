/**
 * Shared iTunes-ingest core — the entity-graph writer for the post-renovation schema.
 *
 * Both ingest-itunes.ts (seed/discography/artist) and ingest-itunes-queue.ts
 * import this so the find-or-create logic for the new schema lives in ONE place:
 *
 *   artists (uuid) ──< artist_aliases        (N name variants → 1 artist)
 *           │       └─< artist_external_ids  (N source IDs → 1 artist)
 *           │
 *   release_groups ──< releases (editions) ──< release_tracks >── recordings
 *
 * The scripts stay responsible for talking to the iTunes API (rate limiting,
 * 429/403 backoff, pagination). This module only takes already-fetched plain
 * data and writes the DB graph. It keeps an in-process cache so repeated
 * artists / release groups within a single run don't re-hit the DB.
 *
 * Design decisions (2026-06-25, locked with product):
 *   - recordings: PER-RELEASE for v1. One recording row per track occurrence;
 *     the same song on a single and an album becomes two recordings. iTunes
 *     returns no ISRC, so cross-release unification is deferred to a later pass.
 *   - release_groups: editions collapse by artist + edition-suffix-stripped
 *     title (Remaster / Deluxe / Anniversary / Mono / … removed).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export type DB = SupabaseClient;

// ── DB handle ───────────────────────────────────────────────────────────────

export function getDB(): DB {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// ── Normalization ─────────────────────────────────────────────────────────────

// Lowercase, strip punctuation, keep word chars + CJK. Shared by every match.
export function normalizeStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArtist(s: string): string {
  return normalizeStr(s).replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();
}

// Edition-suffix stripping so "Kid A" and "Kid A (2021 Remaster)" share a group.
// Removes a trailing parenthesised/bracketed/dashed qualifier when it contains a
// known edition keyword — conservative: a plain "(Live)" or untitled paren stays.
const EDITION_KW =
  'remaster(?:ed)?|deluxe|expanded|anniversary|special edition|special|reissue|' +
  're[- ]?record(?:ed|ing)?|taylor\'?s version|mono|stereo|bonus(?: track)?(?:s)?|' +
  'edition|version|remix(?:es)?|instrumental(?:s)?';
const EDITION_PAREN_RE = new RegExp(
  `\\s*[\\(\\[][^)\\]]*\\b(?:${EDITION_KW})\\b[^)\\]]*[\\)\\]]\\s*$`,
  'i',
);
const EDITION_DASH_RE = new RegExp(`\\s*[-–—]\\s.*\\b(?:${EDITION_KW})\\b.*$`, 'i');

export function stripEditionSuffix(title: string): string {
  let t = title;
  // Strip repeatedly: "Album (Deluxe) (Remastered)" → "Album".
  for (let i = 0; i < 3; i++) {
    const next = t.replace(EDITION_PAREN_RE, '');
    if (next === t) break;
    t = next;
  }
  t = t.replace(EDITION_DASH_RE, '');
  return t.trim() || title.trim(); // never return empty
}

export function releaseGroupKey(title: string): string {
  return normalizeStr(stripEditionSuffix(title));
}

// ── iTunes value mapping ──────────────────────────────────────────────────────

export function artworkUrl(url: string, size = 600): string {
  return (url ?? '').replace('100x100', `${size}x${size}`).replace('100bb', `${size}bb`);
}

const GENRE_MAP: Record<string, string> = {
  'K-Pop': 'k-pop', 'Korean Pop': 'k-pop', 'Korean': 'k-pop',
  'J-Pop': 'j-pop', 'Asian Pop': 'k-pop',
  'Hip-Hop/Rap': 'hip-hop', 'Hip Hop/Rap': 'hip-hop',
  'R&B/Soul': 'r&b', 'Electronic': 'electronic', 'Dance': 'electronic',
  'Indie Pop': 'indie', 'Alternative': 'alternative', 'Rock': 'rock',
  'Pop': 'pop', 'Classical': 'classical', 'Jazz': 'jazz',
  'Soundtrack': 'soundtrack', 'Ballad': 'ballad',
  'Singer/Songwriter': 'singer-songwriter', 'Folk': 'folk',
};

export function mapGenre(g: string): string {
  return GENRE_MAP[g] ?? (g ?? '').toLowerCase();
}

// App-level release type (display) from track count + name.
export function releaseType(trackCount: number, name: string): string {
  const n = (name ?? '').toLowerCase();
  if (trackCount <= 3) return 'Single';
  if (trackCount <= 6 || n.includes(' ep') || n.endsWith('ep')) return 'EP';
  if (n.includes('live') || n.includes('concert')) return 'Live';
  if (n.includes('best of') || n.includes('greatest hits') || n.includes('compilation')) return 'Compilation';
  return 'Album';
}

// App release type → release_groups.release_group_type enum value.
export function toGroupType(appReleaseType: string): string {
  switch (appReleaseType.toLowerCase()) {
    case 'album':        return 'album';
    case 'ep':           return 'ep';
    case 'single':       return 'single';
    case 'live':         return 'live';
    case 'compilation':  return 'compilation';
    case 'soundtrack':   return 'soundtrack';
    default:             return 'other';
  }
}

// Detects ISO 639-1 language from script. Returns null for Latin/ASCII text.
export function detectLanguage(s: string): string | null {
  if (/[가-힣ᄀ-ᇿ]/.test(s)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'zh';
  return null;
}

export const LANGUAGE_TO_STORE: Record<string, string> = { ko: 'KR', ja: 'JP', zh: 'TW' };

// Collaboration / featured-credit detection — these are Last.fm collab nodes,
// not standalone artist entities, and should not become their own artist rows.
const LEGIT_COMPOUND_ACTS = new Set([
  'hall & oates', 'simon & garfunkel', 'sly & the family stone',
  'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash',
  'toots & the maytals', 'all natural lemon & lime flavors',
  'eric b. & rakim', 'pete rock & c.l. smooth',
  'above & beyond', 'pig&dan',
  'ampers&one', '15&', 'gd & top', 'h&d',
  'irene & seulgi', 'red velvet – irene & seulgi', 'red velvet - irene & seulgi',
  'moonbin & sanha', 'super junior-d&e', 'jinjin & rocky',
  'longguo & shihyun', 'soohyun & hoon',
  'kiha & the faces', 'shin jung hyun & yup juns',
  'richard & linda thompson',
]);

export function isCollaborationArtist(name: string): boolean {
  if (LEGIT_COMPOUND_ACTS.has(name.toLowerCase())) return false;
  if (/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(name)) return true;
  if (/&/.test(name)) return true;
  if (/\s\+\s/.test(name)) return true;
  return false;
}

// ── Concurrency: per-key async mutex ──────────────────────────────────────────
// Serializes operations that share a key (e.g. find-or-create for the same artist
// or release group) so concurrent workers can't double-create or race the
// canonical-edition read-modify-write. Distinct keys still run in parallel.
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn); // run fn after prev settles (success or fail)
    // Keep the chain alive but swallow errors on the stored tail so one failure
    // doesn't reject every future waiter on this key.
    this.tails.set(key, result.then(() => {}, () => {}));
    return result;
  }
}

// ── Ingest context (per-run caches) ───────────────────────────────────────────

export interface IngestOptions {
  dryRun: boolean;
  withTracks: boolean;
  skipSingles: boolean;
}

interface GroupCacheEntry {
  id: string;
  canonicalReleaseId: string | null;
  canonicalDate: string | null; // YYYY-MM-DD of the current canonical edition
}

export interface IngestContext {
  db: DB;
  opts: IngestOptions;
  mutex: KeyedMutex;                    // serializes same-key find-or-create under concurrency
  artistByItunes: Map<number, string>; // iTunes artistId → artist uuid
  artistByAlias: Map<string, string>;  // normalized alias → artist uuid
  groupByKey: Map<string, GroupCacheEntry>; // `${artistId}::${groupKey}::${type}` → group
}

export function createIngestContext(db: DB, opts: IngestOptions): IngestContext {
  return {
    db,
    opts,
    mutex: new KeyedMutex(),
    artistByItunes: new Map(),
    artistByAlias: new Map(),
    groupByKey: new Map(),
  };
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface AlbumInput {
  collectionId: number;
  artistId: number;        // iTunes artist id of the album's primary artist
  artistName: string;
  collectionName: string;
  releaseDate?: string;    // ISO 8601
  primaryGenreName?: string;
  trackCount?: number;
  artworkUrl100?: string;
  country?: string;        // iTunes store country, e.g. "USA"
}

export interface TrackInput {
  position: number;
  title: string;
  durationMs: number | null;
  artists: string;
}

export interface NativeNames {
  titleNative: string;
  artistNative: string;
  nativeLanguage: string;
}

// ── Artists ─────────────────────────────────────────────────────────────────

/**
 * Resolve the artist uuid for an iTunes (artistId, name), creating the artist +
 * its aliases + external id if absent. Resolution order:
 *   1. in-run cache by iTunes id
 *   2. artist_external_ids (source='itunes', external_id=artistId)
 *   3. artist_aliases (exact alias = name OR nativeName)  ← cross-source merge
 *   4. create new artist
 * The UNIQUE(alias) invariant means an existing alias always wins (collapses
 * variants onto one entity), which is the intended renovation behavior.
 */
type ArtistArgs = { itunesArtistId: number; name: string; nativeName?: string | null; lang?: string | null; country?: string | null };

export async function findOrCreateArtist(ctx: IngestContext, args: ArtistArgs): Promise<string> {
  // Fast path outside the lock.
  const cached = ctx.artistByItunes.get(args.itunesArtistId);
  if (cached) return cached;
  // Serialize same-artist resolution so concurrent workers don't double-create.
  return ctx.mutex.run(`a:${args.itunesArtistId}`, () => createArtist(ctx, args));
}

async function createArtist(ctx: IngestContext, args: ArtistArgs): Promise<string> {
  const { db, opts } = ctx;
  const { itunesArtistId, name } = args;
  const nativeName = args.nativeName || null;
  const lang = args.lang || (nativeName ? detectLanguage(nativeName) : null);

  // 1. re-check cache inside the lock (another worker may have just created it)
  const again = ctx.artistByItunes.get(itunesArtistId);
  if (again) return again;

  // 2. external id
  {
    const { data } = await db
      .from('artist_external_ids')
      .select('artist_id')
      .eq('source', 'itunes')
      .eq('external_id', String(itunesArtistId))
      .maybeSingle();
    if (data?.artist_id) {
      ctx.artistByItunes.set(itunesArtistId, data.artist_id);
      return data.artist_id;
    }
  }

  // 3. alias (name first, then native)
  const aliasCandidates = [name, nativeName].filter(Boolean) as string[];
  let artistId: string | null = null;
  for (const alias of aliasCandidates) {
    const cachedAlias = ctx.artistByAlias.get(normalizeStr(alias));
    if (cachedAlias) { artistId = cachedAlias; break; }
    const { data } = await db
      .from('artist_aliases')
      .select('artist_id')
      .eq('alias', alias)
      .maybeSingle();
    if (data?.artist_id) { artistId = data.artist_id; break; }
  }

  // 4. create
  if (!artistId) {
    artistId = randomUUID();
    if (!opts.dryRun) {
      const { error } = await db.from('artists').insert({
        id:               artistId,
        name,
        name_native:      nativeName,
        native_language:  lang,
        country:          args.country ?? null,
        ingest_priority:  'known',
        itunes_artist_id: itunesArtistId, // legacy column kept; external_ids is source of truth
        last_ingested_at: new Date().toISOString(),
        cached_at:        new Date().toISOString(),
      });
      if (error) throw new Error(`artist insert "${name}": ${error.message}`);
    }
  }

  // Ensure aliases exist (idempotent; UNIQUE(alias) — ignore conflicts).
  if (!opts.dryRun) {
    const aliasRows = aliasCandidates.map(alias => ({
      artist_id: artistId,
      alias,
      locale: detectLanguage(alias) ?? (alias === nativeName ? lang : null),
    }));
    if (aliasRows.length > 0) {
      await db.from('artist_aliases').upsert(aliasRows, { onConflict: 'alias', ignoreDuplicates: true });
    }
    // Link the iTunes external id (PK source+external_id — ignore if present).
    await db.from('artist_external_ids').upsert(
      { source: 'itunes', external_id: String(itunesArtistId), artist_id: artistId },
      { onConflict: 'source,external_id', ignoreDuplicates: true },
    );
  }

  ctx.artistByItunes.set(itunesArtistId, artistId);
  for (const alias of aliasCandidates) ctx.artistByAlias.set(normalizeStr(alias), artistId);
  return artistId;
}

// ── Release groups ────────────────────────────────────────────────────────────

/**
 * Resolve the release_group uuid for (primary artist, edition-stripped title,
 * group type), creating it if absent. Matching is done in code on the
 * edition-stripped normalized title since the column isn't normalized in SQL.
 */
type ReleaseGroupArgs = {
  primaryArtistId: string;
  artistDisplay: string;
  title: string;
  appReleaseType: string;
  firstReleaseDate: string | null;
  coverUrl: string | null;
  genre: string | null;
};

export async function findOrCreateReleaseGroup(ctx: IngestContext, args: ReleaseGroupArgs): Promise<GroupCacheEntry> {
  const groupType = toGroupType(args.appReleaseType);
  const key = `${args.primaryArtistId}::${releaseGroupKey(args.title)}::${groupType}`;
  const cached = ctx.groupByKey.get(key);
  if (cached) return cached;
  // Serialize same-group resolution (and its canonical bookkeeping) across workers.
  return ctx.mutex.run(`g:${key}`, () => loadOrCreateGroup(ctx, args, groupType, key));
}

async function loadOrCreateGroup(
  ctx: IngestContext,
  args: ReleaseGroupArgs,
  groupType: string,
  key: string,
): Promise<GroupCacheEntry> {
  const { db, opts } = ctx;
  const again = ctx.groupByKey.get(key);
  if (again) return again;

  // DB: fetch this artist's groups of this type, match on stripped key in code.
  const { data: rows } = await db
    .from('release_groups')
    .select('id, title, first_release_date')
    .eq('primary_artist_id', args.primaryArtistId)
    .eq('release_group_type', groupType);

  const wantKey = releaseGroupKey(args.title);
  const match = (rows ?? []).find(r => releaseGroupKey(r.title) === wantKey);

  if (match) {
    // Load the existing canonical edition so cross-run canonical logic is correct.
    const { data: canon } = await db
      .from('releases')
      .select('id, release_date')
      .eq('release_group_id', match.id)
      .eq('is_canonical', true)
      .maybeSingle();
    const entry: GroupCacheEntry = {
      id: match.id,
      canonicalReleaseId: canon?.id ?? null,
      canonicalDate: canon?.release_date ?? null,
    };
    ctx.groupByKey.set(key, entry);
    return entry;
  }

  // Create.
  const id = randomUUID();
  if (!opts.dryRun) {
    const { error } = await db.from('release_groups').insert({
      id,
      primary_artist_id:  args.primaryArtistId,
      artist_display:     args.artistDisplay,
      title:              args.title,
      release_group_type: groupType,
      first_release_date: args.firstReleaseDate,
      cover_url:          args.coverUrl,
      genres:             args.genre ? [args.genre] : null,
    });
    if (error) throw new Error(`release_group insert "${args.title}": ${error.message}`);
  }
  const entry: GroupCacheEntry = { id, canonicalReleaseId: null, canonicalDate: null };
  ctx.groupByKey.set(key, entry);
  return entry;
}

// ── Editions (releases) + recordings + release_tracks ──────────────────────────

export type IngestResult = 'inserted' | 'skipped';

/**
 * Insert one edition (releases row) under its release_group, maintaining the
 * single canonical edition (earliest release date wins), then create per-release
 * recordings + release_tracks from the supplied tracklist.
 *
 * Idempotent across runs: an existing releases row with the same itunes_id is
 * skipped, so re-running the ingest never duplicates editions.
 */
export async function ingestEdition(
  ctx: IngestContext,
  args: {
    album: AlbumInput;
    primaryArtistId: string;
    group: GroupCacheEntry;
    native?: NativeNames | null;
    tracks: TrackInput[]; // [] when --with-tracks is off
  },
): Promise<IngestResult> {
  const { db, opts } = ctx;
  const { album, group } = args;

  const rtype = releaseType(album.trackCount ?? 0, album.collectionName);
  if (opts.skipSingles && rtype === 'Single') return 'skipped';
  if (opts.dryRun) return 'inserted';

  // Serialize per-group so the canonical read-modify-write is race-free under concurrency.
  return ctx.mutex.run(`g:${group.id}`, async (): Promise<IngestResult> => {
    const cover = artworkUrl(album.artworkUrl100 ?? '') || null;
    const genre = mapGenre(album.primaryGenreName ?? '') || null;
    const date  = album.releaseDate?.slice(0, 10) ?? null;
    const native = args.native ?? null;

    // Canonical: wins if the group has no canonical yet, or this edition is dated earlier.
    const isCanonical =
      group.canonicalDate === null ||
      (date !== null && date < group.canonicalDate);

    const releaseId = randomUUID();
    // Idempotent + race-safe: UNIQUE(itunes_id) arbitrates duplicates, so a 23505
    // means this collection already exists → skip (no pre-SELECT round-trip needed).
    const { error } = await db.from('releases').insert({
      id:               releaseId,
      release_group_id: group.id,
      is_canonical:     isCanonical,
      region:           album.country ?? null,
      itunes_id:        album.collectionId,
      title:            album.collectionName,
      artist:           album.artistName,
      title_native:     native?.titleNative ?? null,
      artist_native:    native?.artistNative ?? null,
      native_language:  native?.nativeLanguage ?? null,
      release_date:     date,
      release_type:     rtype,
      cover_url:        cover,
      cover_source:     cover ? 'itunes' : null,
      genres:           genre,
      canonical_source: 'itunes',
      total_tracks:     album.trackCount ?? null,
      tracklist:        args.tracks.length > 0 ? args.tracks : null, // kept for display continuity
      cached_at:        new Date().toISOString(),
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'skipped'; // dup itunes_id → already ingested
      throw new Error(`release insert "${album.collectionName}": ${error.message}`);
    }

    // Maintain the single canonical edition.
    if (isCanonical) {
      if (group.canonicalReleaseId && group.canonicalReleaseId !== releaseId) {
        await db.from('releases').update({ is_canonical: false }).eq('id', group.canonicalReleaseId);
      }
      group.canonicalReleaseId = releaseId;
      group.canonicalDate = date;
    }

    // Per-release recordings + release_tracks (v1: no cross-release unification).
    // Empty in the bulk drain (lazy track hydration); populated by the seed / --with-tracks.
    if (args.tracks.length > 0) {
      const recordingRows = args.tracks.map(t => ({
        id:                randomUUID(),
        primary_artist_id: args.primaryArtistId,
        artist_display:    t.artists || album.artistName,
        title:             t.title,
        isrc:              null as string | null,
        duration_ms:       t.durationMs,
      }));
      const { error: recErr } = await db.from('recordings').insert(recordingRows);
      if (recErr) throw new Error(`recordings insert "${album.collectionName}": ${recErr.message}`);

      const trackRows = args.tracks.map((t, i) => ({
        release_id:   releaseId,
        recording_id: recordingRows[i].id,
        position:     t.position,
        disc_number:  1, // tracklist positions are already flattened across discs
      }));
      const { error: rtErr } = await db.from('release_tracks').insert(trackRows);
      if (rtErr) throw new Error(`release_tracks insert "${album.collectionName}": ${rtErr.message}`);
    }

    return 'inserted';
  });
}
