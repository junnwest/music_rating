/**
 * Spotify-ingest core for the recency lane (discover-spotify-recency.ts) — the
 * entity-graph writer for Spotify-sourced releases, mirroring itunes-ingest-core.ts's
 * shape and safety invariants (dedup-safe, idempotent, per-key mutex under
 * concurrency) but writing Spotify's own id columns (`releases.spotify_id`,
 * `source='spotify'`) instead of iTunes's.
 *
 * Deliberately a SEPARATE module from itunes-ingest-core.ts rather than a shared,
 * source-parametrized one: that file backs already-live iTunes ingest paths
 * (ingest-itunes.ts, ingest-itunes-queue.ts) and refactoring it to be generic risks
 * destabilizing working code for a modest amount of saved duplication. The pure,
 * source-agnostic utilities (normalization, edition-stripping, the mutex) ARE
 * reused directly from there — only the artist/release-group/edition writers,
 * which touch source-specific columns, are separate.
 */

import { randomUUID } from 'crypto';
import {
  type DB, getDB, normalizeStr, releaseGroupKey, detectLanguage, mapGenre, releaseType,
  toGroupType, KeyedMutex,
} from './itunes-ingest-core';

export { getDB, releaseGroupKey };
export type { DB };

// ── Ingest context (per-run caches) ───────────────────────────────────────────

export interface SpotifyIngestOptions {
  dryRun: boolean;
  withTracks: boolean;
}

interface GroupCacheEntry {
  id: string;
  canonicalReleaseId: string | null;
  canonicalDate: string | null;
}

export interface SpotifyIngestContext {
  db: DB;
  opts: SpotifyIngestOptions;
  mutex: KeyedMutex;
  artistBySpotify: Map<string, string>; // Spotify artist id → artist uuid
  artistByAlias: Map<string, string>;
  groupByKey: Map<string, GroupCacheEntry>;
}

export function createSpotifyIngestContext(db: DB, opts: SpotifyIngestOptions): SpotifyIngestContext {
  return {
    db, opts,
    mutex: new KeyedMutex(),
    artistBySpotify: new Map(),
    artistByAlias: new Map(),
    groupByKey: new Map(),
  };
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface SpotifyAlbumInput {
  spotifyId: string;
  artistSpotifyId: string;
  artistName: string;
  name: string;
  releaseDate: string; // ISO date, precision may be year/month/day
  albumType: string;   // 'album' | 'single' | 'compilation'
  totalTracks: number;
  coverUrl: string | null;
  upc: string | null;
}

export interface SpotifyTrackInput {
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

// App-level release type from Spotify's own album_type + track count (Spotify already
// separates single/album/compilation for us — only EP needs inferring, same heuristic
// itunes-ingest-core.ts uses since Spotify has no EP album_type of its own).
export function spotifyReleaseType(albumType: string, trackCount: number, name: string): string {
  if (albumType === 'compilation') return 'Compilation';
  if (albumType === 'single') return trackCount > 3 ? 'EP' : 'Single'; // Spotify calls some EPs "single"
  return releaseType(trackCount, name);
}

// ── Artists ─────────────────────────────────────────────────────────────────

type ArtistArgs = { spotifyArtistId: string; name: string; nativeName?: string | null; lang?: string | null; country?: string | null };

/**
 * Resolve the artist uuid for a Spotify (artistId, name). Resolution order:
 *   1. in-run cache by Spotify id
 *   2. artist_external_ids (source='spotify', external_id=artistId)
 *   3. artist_aliases (exact alias = name OR nativeName) ← cross-source merge onto
 *      an existing MB/iTunes artist row, never a second artist entity
 *   4. give up — recency callers pass a KNOWN owned-artist uuid directly instead of
 *      calling this for the primary artist (see scanArtistRecency); this path only
 *      exists for completeness / future use, never called on the hot path today.
 */
export async function findOrCreateArtistBySpotify(ctx: SpotifyIngestContext, args: ArtistArgs): Promise<string | null> {
  const cached = ctx.artistBySpotify.get(args.spotifyArtistId);
  if (cached) return cached;
  return ctx.mutex.run(`a:${args.spotifyArtistId}`, () => resolveArtist(ctx, args));
}

async function resolveArtist(ctx: SpotifyIngestContext, args: ArtistArgs): Promise<string | null> {
  const { db } = ctx;
  const again = ctx.artistBySpotify.get(args.spotifyArtistId);
  if (again) return again;

  const { data: ext } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'spotify').eq('external_id', args.spotifyArtistId).maybeSingle();
  if (ext?.artist_id) { ctx.artistBySpotify.set(args.spotifyArtistId, ext.artist_id); return ext.artist_id; }

  const aliasCandidates = [args.name, args.nativeName].filter(Boolean) as string[];
  for (const alias of aliasCandidates) {
    const cachedAlias = ctx.artistByAlias.get(normalizeStr(alias));
    if (cachedAlias) { ctx.artistBySpotify.set(args.spotifyArtistId, cachedAlias); return cachedAlias; }
    const { data } = await db.from('artist_aliases').select('artist_id').eq('alias', alias).maybeSingle();
    if (data?.artist_id) {
      ctx.artistBySpotify.set(args.spotifyArtistId, data.artist_id);
      if (!ctx.opts.dryRun) {
        await db.from('artist_external_ids').upsert(
          { source: 'spotify', external_id: args.spotifyArtistId, artist_id: data.artist_id },
          { onConflict: 'source,external_id', ignoreDuplicates: true },
        );
      }
      return data.artist_id;
    }
  }
  return null; // no match — caller decides what to do (recency never creates new artists)
}

// ── Release groups ────────────────────────────────────────────────────────────

type ReleaseGroupArgs = {
  primaryArtistId: string;
  artistDisplay: string;
  title: string;
  appReleaseType: string;
  firstReleaseDate: string | null;
  coverUrl: string | null;
};

export async function findOrCreateReleaseGroup(ctx: SpotifyIngestContext, args: ReleaseGroupArgs): Promise<GroupCacheEntry> {
  const groupType = toGroupType(args.appReleaseType);
  const key = `${args.primaryArtistId}::${releaseGroupKey(args.title)}::${groupType}`;
  const cached = ctx.groupByKey.get(key);
  if (cached) return cached;
  return ctx.mutex.run(`g:${key}`, () => loadOrCreateGroup(ctx, args, groupType, key));
}

async function loadOrCreateGroup(
  ctx: SpotifyIngestContext, args: ReleaseGroupArgs, groupType: string, key: string,
): Promise<GroupCacheEntry> {
  const { db, opts } = ctx;
  const again = ctx.groupByKey.get(key);
  if (again) return again;

  const { data: rows } = await db.from('release_groups')
    .select('id, title, first_release_date')
    .eq('primary_artist_id', args.primaryArtistId).eq('release_group_type', groupType);
  const wantKey = releaseGroupKey(args.title);
  const match = (rows ?? []).find(r => releaseGroupKey(r.title) === wantKey);

  if (match) {
    const { data: canon } = await db.from('releases')
      .select('id, release_date').eq('release_group_id', match.id).eq('is_canonical', true).maybeSingle();
    const entry: GroupCacheEntry = { id: match.id, canonicalReleaseId: canon?.id ?? null, canonicalDate: canon?.release_date ?? null };
    ctx.groupByKey.set(key, entry);
    return entry;
  }

  const id = randomUUID();
  if (!opts.dryRun) {
    // is('source', null) never relabels an existing MB/Deezer group — this only
    // ever runs when no title-key match exists at all, i.e. a genuinely new group.
    const { error } = await db.from('release_groups').insert({
      id, primary_artist_id: args.primaryArtistId, artist_display: args.artistDisplay,
      title: args.title, release_group_type: groupType, first_release_date: args.firstReleaseDate,
      cover_url: args.coverUrl, source: 'spotify',
    });
    if (error) throw new Error(`release_group insert "${args.title}": ${error.message}`);
  }
  const entry: GroupCacheEntry = { id, canonicalReleaseId: null, canonicalDate: null };
  ctx.groupByKey.set(key, entry);
  return entry;
}

// ── Editions (releases) + recordings + release_tracks ──────────────────────────

export type IngestResult = 'inserted' | 'skipped';

export async function ingestEdition(
  ctx: SpotifyIngestContext,
  args: { album: SpotifyAlbumInput; primaryArtistId: string; group: GroupCacheEntry; native?: NativeNames | null; tracks: SpotifyTrackInput[] },
): Promise<IngestResult> {
  const { db, opts } = ctx;
  const { album, group } = args;
  if (opts.dryRun) return 'inserted';

  return ctx.mutex.run(`g:${group.id}`, async (): Promise<IngestResult> => {
    const date = album.releaseDate?.slice(0, 10) ?? null;
    const native = args.native ?? null;
    const isCanonical = group.canonicalDate === null || (date !== null && date < group.canonicalDate);
    const releaseId = randomUUID();

    // Idempotent + race-safe: UNIQUE(spotify_id) arbitrates duplicates, so a 23505
    // means this album already exists → skip (no pre-SELECT round-trip needed).
    const { error } = await db.from('releases').insert({
      id: releaseId, release_group_id: group.id, is_canonical: isCanonical,
      spotify_id: album.spotifyId, spotify_url: `https://open.spotify.com/album/${album.spotifyId}`,
      title: album.name, artist: album.artistName,
      title_native: native?.titleNative ?? null, artist_native: native?.artistNative ?? null,
      native_language: native?.nativeLanguage ?? null,
      release_date: date, release_type: spotifyReleaseType(album.albumType, album.totalTracks, album.name),
      cover_url: album.coverUrl, cover_source: album.coverUrl ? 'spotify' : null,
      genres: null, canonical_source: 'spotify', total_tracks: album.totalTracks ?? null,
      upc: album.upc ?? null,
      tracklist: args.tracks.length > 0 ? args.tracks : null,
      cached_at: new Date().toISOString(), source: 'spotify',
    });
    if (error) {
      if ((error as { code?: string }).code === '23505') return 'skipped';
      throw new Error(`release insert "${album.name}": ${error.message}`);
    }

    if (isCanonical) {
      if (group.canonicalReleaseId && group.canonicalReleaseId !== releaseId) {
        await db.from('releases').update({ is_canonical: false }).eq('id', group.canonicalReleaseId);
      }
      group.canonicalReleaseId = releaseId;
      group.canonicalDate = date;
    }

    if (args.tracks.length > 0) {
      const recordingRows = args.tracks.map(t => ({
        id: randomUUID(), primary_artist_id: args.primaryArtistId,
        artist_display: t.artists || album.artistName, title: t.title,
        isrc: null as string | null, duration_ms: t.durationMs, source: 'spotify',
      }));
      const { error: recErr } = await db.from('recordings').insert(recordingRows);
      if (recErr) throw new Error(`recordings insert "${album.name}": ${recErr.message}`);

      const trackRows = args.tracks.map((t, i) => ({
        release_id: releaseId, recording_id: recordingRows[i].id, position: t.position, disc_number: 1,
      }));
      const { error: rtErr } = await db.from('release_tracks').insert(trackRows);
      if (rtErr) throw new Error(`release_tracks insert "${album.name}": ${rtErr.message}`);
    }

    return 'inserted';
  });
}

export { detectLanguage, mapGenre };
