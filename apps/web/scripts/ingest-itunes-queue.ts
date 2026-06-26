/**
 * iTunes queue ingest — drains artist_ingestion_queue via iTunes Search API.
 * No Spotify. No auth. Concurrency + a global rate limiter (not Spotify limits).
 *
 * Writes the post-renovation entity graph (via itunes-ingest-core.ts):
 *   artists (+aliases +external_ids) → release_groups → releases [→ release_tracks/recordings]
 *
 * Speed model (see RENOVATION_PLAN.md §6, §8b):
 *   - tracks are EAGER by default: each album's tracklist → recordings + release_tracks
 *     (fills the song DB at ingest). Pass --no-tracks for a fast album-only drain.
 *   - a worker POOL overlaps request latency; a GLOBAL per-IP limiter caps total
 *     req/min (default 220, safely under the ~300/min iTunes 429 ceiling).
 *   - --shard=i/N runs disjoint slices on separate machines/IPs (linear scaling).
 *
 * Run:
 *   npm run queue:ingest:albums                       # --skip-singles, eager tracks
 *   npm run queue:ingest:albums:fast                  # --skip-singles --no-tracks
 *   # multi-IP: Windows ── --shard=0/2 ; Mac ── --shard=1/2
 *   npx tsx --env-file=.env.local scripts/ingest-itunes-queue.ts --skip-singles --shard=0/2
 *   ... --dry-run | --limit=500 | --concurrency=8 | --rate=220
 *
 * Resumable: re-run anytime — queue rows are marked done, and existing iTunes
 * collections are skipped via the releases UNIQUE(itunes_id) constraint.
 */

import {
  getDB,
  createIngestContext,
  findOrCreateArtist,
  findOrCreateReleaseGroup,
  ingestEdition,
  normalizeStr,
  detectLanguage,
  artworkUrl,
  mapGenre,
  releaseType,
  isCollaborationArtist,
  LANGUAGE_TO_STORE,
  type AlbumInput,
  type TrackInput,
  type NativeNames,
} from './itunes-ingest-core';
import { makeItunesGet, pool, type ItunesGet } from './itunes-fetch';

const DRY_RUN      = process.argv.includes('--dry-run');
// Tracks are EAGER by default (fills the song DB at ingest — needed for song
// search/leaderboards at launch). Pass --no-tracks for the fast album-only drain.
const WITH_TRACKS  = !process.argv.includes('--no-tracks');
const SKIP_SINGLES = process.argv.includes('--skip-singles');
const numArg = (flag: string, def: number) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? parseInt(a.split('=')[1], 10) : def;
};
const BATCH_LIMIT  = numArg('--limit', 9999999);
const CONCURRENCY  = numArg('--concurrency', 8);
const RATE_PER_MIN = numArg('--rate', 220);

// Multi-IP sharding: run `--shard=0/2` on one machine/IP and `--shard=1/2` on
// another to drain disjoint slices of the queue in parallel. Each process has its
// own per-IP rate limiter, so total throughput scales ~linearly with IPs.
let SHARD = 0, SHARDS = 1;
{
  const a = process.argv.find(x => x.startsWith('--shard='));
  if (a) { const [i, n] = a.split('=')[1].split('/').map(Number); SHARD = i || 0; SHARDS = n || 1; }
}
function inShard(id: string): boolean {
  if (SHARDS <= 1) return true;
  const h = parseInt(id.replace(/-/g, '').slice(0, 8), 16); // stable hash of the uuid head
  return h % SHARDS === SHARD;
}

const ITUNES_BASE = 'https://itunes.apple.com';
let itunesGet: ItunesGet; // set in main()

// ── iTunes API ────────────────────────────────────────────────────────────────

const NOISE_RE = /\b(sped[- ]up|slowed|instrumental|karaoke|off[- ]vocal|mr\.?|inst\.?)\b/i;

async function findItunesArtistId(name: string): Promise<number | null> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
  const data = await itunesGet(url);
  if (!data) return null;
  const results: any[] = data.results ?? [];
  const normName = normalizeStr(name);
  const match =
    results.find(r => r.wrapperType === 'artist' && normalizeStr(r.artistName) === normName) ??
    results.find(r => r.wrapperType === 'artist');
  return match ? match.artistId : null;
}

// Map a collection's songs to TrackInput. Multi-disc albums repeat track numbers
// per disc, so flatten to a running position for unique keys.
async function fetchTracks(collectionId: number): Promise<TrackInput[]> {
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=300`);
  const songs: any[] = (data?.results ?? []).filter(
    (r: any) => r.wrapperType === 'track' && r.kind === 'song' && r.trackName,
  );
  if (songs.length === 0) return [];
  songs.sort((a, b) =>
    ((a.discNumber ?? 1) - (b.discNumber ?? 1)) || ((a.trackNumber ?? 0) - (b.trackNumber ?? 0)),
  );
  const multiDisc = new Set(songs.map(s => s.discNumber ?? 1)).size > 1;
  return songs.map((s, i) => ({
    position:   multiDisc ? i + 1 : (s.trackNumber ?? i + 1),
    title:      s.trackName,
    durationMs: s.trackTimeMillis ?? null,
    artists:    s.artistName ?? '',
  }));
}

async function fetchDiscography(artistId: number): Promise<AlbumInput[]> {
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200`);
  if (!data) return [];
  return (data.results ?? []).filter((r: any) =>
    r.wrapperType === 'collection' &&
    r.collectionType === 'Album' &&
    !NOISE_RE.test(r.collectionName)
  ) as AlbumInput[];
}

// Native-language names from the artist's local store (only when language is known).
async function fetchNativeNames(artistId: number, storeCountry: string): Promise<Map<number, NativeNames>> {
  const data = await itunesGet(`${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200&country=${storeCountry}`);
  const map = new Map<number, NativeNames>();
  if (!data) return map;
  for (const r of data.results ?? []) {
    if (r.wrapperType !== 'collection' || !r.collectionId) continue;
    const titleNative  = r.collectionName ?? '';
    const artistNative = r.artistName ?? '';
    const lang = detectLanguage(titleNative) ?? detectLanguage(artistNative);
    if (lang) map.set(r.collectionId, { titleNative, artistNative, nativeLanguage: lang });
  }
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

type QueueRow = { id: string; name: string; itunes_artist_id: number | null; name_native: string | null };

async function main() {
  console.log(`\n  sillajuku iTunes queue ingest${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  concurrency=${CONCURRENCY} · rate=${RATE_PER_MIN}/min · tracks=${WITH_TRACKS ? 'eager' : 'off'} · skipSingles=${SKIP_SINGLES}${SHARDS > 1 ? ` · shard=${SHARD}/${SHARDS}` : ''}\n`);

  const db = getDB();
  const ctx = createIngestContext(db, { dryRun: DRY_RUN, withTracks: WITH_TRACKS, skipSingles: SKIP_SINGLES });
  itunesGet = makeItunesGet({ perMin: RATE_PER_MIN, userAgent: 'sillajuku-queue-ingest/2.0' });

  let totalInserted = 0, totalSkipped = 0, artistsFailed = 0, artistsNoMatch = 0;
  let processed = 0;
  let pageNum = 0;
  let afterId: string | null = null; // keyset cursor (by id) — avoids re-reading other shards' rows

  while (processed < BATCH_LIMIT) {
    let q = db
      .from('artist_ingestion_queue')
      .select('id, name, itunes_artist_id, name_native')
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(1000);
    if (afterId) q = q.gt('id', afterId);
    const { data: page, error: qErr } = await q;

    if (qErr) { console.error('Queue fetch error:', qErr.message); process.exit(1); }
    if (!page || page.length === 0) {
      if (pageNum === 0) console.log('  No pending artists in queue. Run queue:build:global first.');
      break;
    }
    afterId = page[page.length - 1].id;

    // Keep only this shard's slice, and respect the overall --limit.
    const slice = (page as QueueRow[])
      .filter(r => inShard(r.id))
      .slice(0, Math.max(0, BATCH_LIMIT - processed));
    if (slice.length === 0) continue; // whole page belonged to other shards / over limit — advance

    pageNum++;
    console.log(`  Page ${pageNum} — ${slice.length} for this worker (${processed} done so far)\n`);

    await pool(slice, CONCURRENCY, async (row) => {
      const n = ++processed;
      const label = `[${n}] ${row.name.slice(0, 32).padEnd(32)}`;

      if (isCollaborationArtist(row.name)) {
        if (!DRY_RUN) await db.from('artist_ingestion_queue')
          .update({ status: 'skipped', processed_at: new Date().toISOString() }).eq('id', row.id);
        console.log(`${label} collab — skipped`);
        return;
      }

      if (!DRY_RUN) await db.from('artist_ingestion_queue').update({ status: 'processing' }).eq('id', row.id);

      try {
        let itunesId = row.itunes_artist_id;
        if (!itunesId) {
          itunesId = await findItunesArtistId(row.name);
          if (!itunesId) {
            if (!DRY_RUN) await db.from('artist_ingestion_queue')
              .update({ status: 'skipped', processed_at: new Date().toISOString() }).eq('id', row.id);
            artistsNoMatch++;
            console.log(`${label} no iTunes match`);
            return;
          }
          if (!DRY_RUN) await db.from('artist_ingestion_queue').update({ itunes_artist_id: itunesId }).eq('id', row.id);
        }

        const albums = await fetchDiscography(itunesId);
        const artistLang = row.name_native ? detectLanguage(row.name_native) : null;
        const storeCountry = artistLang ? LANGUAGE_TO_STORE[artistLang] : null;
        const nativeMap = storeCountry ? await fetchNativeNames(itunesId, storeCountry) : new Map<number, NativeNames>();

        let ins = 0, skp = 0;
        for (const album of albums) {
          const rtype = releaseType(album.trackCount ?? 0, album.collectionName);
          if (SKIP_SINGLES && rtype === 'Single') { skp++; continue; }

          const native = nativeMap.get(album.collectionId) ?? null;
          const artistNative = native?.artistNative ?? (album.artistId === itunesId ? row.name_native : null);
          const primaryArtistId = await findOrCreateArtist(ctx, {
            itunesArtistId: album.artistId,
            name:           album.artistName,
            nativeName:     artistNative,
            lang:           native?.nativeLanguage ?? (album.artistId === itunesId ? artistLang : null),
          });
          const group = await findOrCreateReleaseGroup(ctx, {
            primaryArtistId,
            artistDisplay:    album.artistName,
            title:            album.collectionName,
            appReleaseType:   rtype,
            firstReleaseDate: album.releaseDate?.slice(0, 10) ?? null,
            coverUrl:         artworkUrl(album.artworkUrl100 ?? '') || null,
            genre:            mapGenre(album.primaryGenreName ?? '') || null,
          });
          const tracks = WITH_TRACKS ? await fetchTracks(album.collectionId) : [];
          const result = await ingestEdition(ctx, { album, primaryArtistId, group, native, tracks });
          if (result === 'inserted') ins++; else skp++;
        }

        totalInserted += ins;
        totalSkipped  += skp;
        if (!DRY_RUN) await db.from('artist_ingestion_queue').update({
          status: 'done', releases_added: ins, processed_at: new Date().toISOString(),
        }).eq('id', row.id);
        console.log(`${label} ${albums.length} albums → +${ins} new, ${skp} skipped`);

      } catch (err) {
        artistsFailed++;
        if (!DRY_RUN) await db.from('artist_ingestion_queue').update({
          status: 'failed', error: (err as Error).message.slice(0, 255), processed_at: new Date().toISOString(),
        }).eq('id', row.id);
        console.log(`${label} ERROR: ${(err as Error).message}`);
      }
    });
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Releases inserted  : ${totalInserted}
  Releases skipped   : ${totalSkipped}
  Artists no match   : ${artistsNoMatch}
  Artists failed     : ${artistsFailed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
