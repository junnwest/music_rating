/**
 * GAPFILL — iTunes fallback for the holes MusicBrainz leaves (RENOVATION_PLAN §2).
 *
 * STRICTLY APPEND-ONLY + MB-AUTHORITATIVE: it only writes into empty fields (null cover,
 * empty tracklist) or adds entirely MB-missing artists. Everything it creates is tagged
 * `source='itunes'` (artists: `source_status='itunes_gapfill'`) so MB rows stay pure and
 * the provenance is auditable. Every `.is('source', null)` / `.is('cover_url', null)` guard
 * means an existing MB row is never overwritten — even if iTunes resolves to the same entity.
 *
 * Three jobs (all bounded; the pipeline's GAPFILL lane calls them on a slow cadence):
 *   gapfillGroups          — fill null `release_groups.cover_url` + empty canonical tracklists
 *   gapfillSkippedArtists  — re-ingest queue rows MB skipped (no_match / needs_review) from iTunes
 *
 * iTunes is rate-limited and IP-blocks on volume (see itunes-client.ts) — the client throws
 * ItunesBlockedError on a sustained block; callers propagate it so the lane can back off.
 */
import { randomUUID } from 'node:crypto';
import {
  getDB, normalizeStr, artworkUrl, mapGenre, detectLanguage,
  createIngestContext, findOrCreateArtist, findOrCreateReleaseGroup, ingestEdition,
  type DB,
} from './itunes-ingest-core';
import {
  searchAlbum, searchArtist, fetchDiscography, fetchAlbumTracks, type ItunesTrack,
} from './itunes-client';

const nowIso = () => new Date().toISOString();
const langOf = (s?: string | null) => (s ? detectLanguage(s) : null);

// ── Job A/B: covers + empty tracklists for already-ingested MB groups ───────────
export interface GroupGapResult { checked: number; covers: number; tracklists: number }

/**
 * For up to `limit` MB groups that are missing a cover (and not yet gap-checked): look the
 * album up on iTunes, fill `cover_url` if still null, and if the canonical release has no
 * tracks, fill recordings + release_tracks (source='itunes'). Marks `gapfill_checked_at` on
 * every attempt so permanent misses aren't re-queried forever.
 */
export async function gapfillGroups(db: DB, limit = 25): Promise<GroupGapResult> {
  const { data: groups, error } = await db
    .from('release_groups')
    .select('id, title, artist_display, native_title, primary_artist_id, cover_url')
    .is('cover_url', null)
    .is('gapfill_checked_at', null)
    .order('created_at')
    .limit(limit);
  if (error) {
    if (/gapfill_checked_at/.test(error.message)) throw new MigrationNeeded();
    throw error;
  }

  const res: GroupGapResult = { checked: 0, covers: 0, tracklists: 0 };
  for (const g of groups ?? []) {
    const lang = langOf((g as any).native_title) ?? langOf((g as any).title);
    const album = await searchAlbum((g as any).title, (g as any).artist_display ?? '', lang);

    if (album?.artworkUrl100) {
      const cover = artworkUrl(album.artworkUrl100, 600) || null;
      if (cover) {
        const { error: e } = await db.from('release_groups')
          .update({ cover_url: cover }).eq('id', (g as any).id).is('cover_url', null);
        if (!e) res.covers++;
      }
    }

    // Empty tracklist on the canonical edition? Fill from the same iTunes album.
    if (album) {
      const { data: canon } = await db.from('releases')
        .select('id').eq('release_group_id', (g as any).id).eq('is_canonical', true).maybeSingle();
      if (canon) {
        const { count } = await db.from('release_tracks')
          .select('recording_id', { count: 'exact', head: true }).eq('release_id', (canon as any).id);
        if ((count ?? 0) === 0) {
          const tracks = await fetchAlbumTracks(album.collectionId, lang);
          if (tracks.length && await insertTracks(db, (canon as any).id, (g as any).primary_artist_id, (g as any).artist_display, tracks)) {
            res.tracklists++;
          }
        }
      }
    }

    await db.from('release_groups').update({ gapfill_checked_at: nowIso() }).eq('id', (g as any).id);
    res.checked++;
  }
  return res;
}

async function insertTracks(db: DB, releaseId: string, primaryArtistId: string, artistDisplay: string, tracks: ItunesTrack[]): Promise<boolean> {
  const recs = tracks.map(t => ({
    id: randomUUID(), primary_artist_id: primaryArtistId,
    artist_display: t.artists || artistDisplay, title: t.title, isrc: null as string | null,
    duration_ms: t.durationMs, source: 'itunes',
  }));
  const { error: re } = await db.from('recordings').insert(recs);
  if (re) return false;
  const rts = tracks.map((t, i) => ({ release_id: releaseId, recording_id: recs[i].id, position: t.position, disc_number: 1 }));
  const { error: te } = await db.from('release_tracks').insert(rts);
  return !te;
}

// ── Job C: re-ingest MB-skipped artists from iTunes (entirely new, source-tagged) ─
export interface SkippedGapResult { processed: number; recovered: number; groups: number }

/**
 * Take up to `limit` queue rows MB skipped (status='skipped', under the retry cap) and try
 * to ingest the artist's discography from iTunes via the shared entity writers, then tag
 * every newly-created row `source='itunes'` (guarded so MB rows are never relabeled). On a
 * hit the queue row is marked 'done'; on a miss its attempt_count is bumped (needs the QC
 * migration's attempt_count column — degrades to status-only if absent).
 */
export async function gapfillSkippedArtists(db: DB, limit = 5, maxAttempts = 3): Promise<SkippedGapResult> {
  const { data: rows } = await db
    .from('artist_ingestion_queue')
    .select('id, name, attempt_count')
    .eq('status', 'skipped')
    .order('created_at')
    .limit(limit * 4); // over-fetch; many will be over the cap
  const res: SkippedGapResult = { processed: 0, recovered: 0, groups: 0 };
  const ctx = createIngestContext(db, { dryRun: false, withTracks: true, skipSingles: false });

  for (const row of rows ?? []) {
    if (res.processed >= limit) break;
    const attempts = (row as any).attempt_count ?? 0;
    if (attempts >= maxAttempts) continue;
    res.processed++;

    const found = await searchArtist((row as any).name);
    if (!found) { await bumpAttempt(db, (row as any).id, attempts); continue; }

    const albums = await fetchDiscography(found.artistId);
    if (!albums.length) { await bumpAttempt(db, (row as any).id, attempts); continue; }

    const groupIds = new Set<string>();
    let artistUuid: string | null = null;
    for (const al of albums) {
      const aId = await findOrCreateArtist(ctx, { itunesArtistId: al.artistId, name: al.artistName, country: al.country ?? null });
      if (al.artistId === found.artistId) artistUuid = aId;
      const group = await findOrCreateReleaseGroup(ctx, {
        primaryArtistId: aId, artistDisplay: al.artistName, title: al.collectionName,
        appReleaseType: 'Album', firstReleaseDate: al.releaseDate?.slice(0, 10) ?? null,
        coverUrl: artworkUrl(al.artworkUrl100 ?? '', 600) || null, genre: mapGenre(al.primaryGenreName ?? '') || null,
      });
      groupIds.add(group.id);
      const tracks = await fetchAlbumTracks(al.collectionId, langOf(al.artistName));
      await ingestEdition(ctx, {
        album: {
          collectionId: al.collectionId, artistId: al.artistId, artistName: al.artistName,
          collectionName: al.collectionName, releaseDate: al.releaseDate, primaryGenreName: al.primaryGenreName,
          trackCount: al.trackCount, artworkUrl100: al.artworkUrl100, country: al.country,
        },
        primaryArtistId: aId, group, tracks,
      });
    }

    artistUuid = artistUuid ?? (groupIds.size ? await firstArtistOfGroup(db, [...groupIds][0]) : null);
    if (artistUuid) await tagItunesProvenance(db, artistUuid, [...groupIds]);
    await db.from('artist_ingestion_queue')
      .update({ status: 'done', processed_at: nowIso(), error: 'itunes-gapfill', releases_added: groupIds.size })
      .eq('id', (row as any).id);
    res.recovered++; res.groups += groupIds.size;
  }
  return res;
}

async function firstArtistOfGroup(db: DB, groupId: string): Promise<string | null> {
  const { data } = await db.from('release_groups').select('primary_artist_id').eq('id', groupId).maybeSingle();
  return (data as any)?.primary_artist_id ?? null;
}

// Tag every newly-created row source='itunes' — guarded so MB rows (source='musicbrainz')
// are never relabeled even if iTunes resolved to an existing MB artist via an alias merge.
async function tagItunesProvenance(db: DB, artistUuid: string, groupIds: string[]) {
  await db.from('release_groups').update({ source: 'itunes' }).eq('primary_artist_id', artistUuid).is('source', null);
  await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', artistUuid).is('source', null);
  for (let i = 0; i < groupIds.length; i += 100) {
    await db.from('releases').update({ source: 'itunes' }).in('release_group_id', groupIds.slice(i, i + 100)).is('source', null);
  }
  await db.from('artists')
    .update({ ingest_state: 'tracks_done', source_status: 'itunes_gapfill', last_ingested_at: nowIso() })
    .eq('id', artistUuid).neq('source_status', 'mb_verified');
}

async function bumpAttempt(db: DB, id: string, attempts: number) {
  const { error } = await db.from('artist_ingestion_queue').update({ attempt_count: attempts + 1 }).eq('id', id);
  // attempt_count column missing (QC migration not applied) → leave as-is; lane still works.
  if (error && !/attempt_count/.test(error.message)) throw error;
}

export class MigrationNeeded extends Error {
  constructor() { super('release_groups.gapfill_checked_at missing — apply migration 20260626000003'); this.name = 'MigrationNeeded'; }
}

// ── CLI: bounded one-shot for manual runs / validation ─────────────────────────
async function main() {
  const db = getDB();
  const dry = process.argv.includes('--dry-run');
  if (dry) {
    const { count: nullCovers } = await db.from('release_groups').select('id', { count: 'exact', head: true }).is('cover_url', null);
    const { count: skipped } = await db.from('artist_ingestion_queue').select('id', { count: 'exact', head: true }).eq('status', 'skipped');
    console.log(`\n  [gapfill dry-run] ${nullCovers ?? 0} groups missing cover · ${skipped ?? 0} skipped artists in queue`);
    console.log('  (run without --dry-run to fill a bounded batch)\n');
    return;
  }
  const g = await gapfillGroups(db, 25);
  console.log(`  [gapfill] groups: checked ${g.checked}, covers +${g.covers}, tracklists +${g.tracklists}`);
  const s = await gapfillSkippedArtists(db, 5);
  console.log(`  [gapfill] skipped artists: processed ${s.processed}, recovered ${s.recovered} (+${s.groups} groups)`);
}

if (process.argv[1] && process.argv[1].endsWith('mb-gapfill.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
