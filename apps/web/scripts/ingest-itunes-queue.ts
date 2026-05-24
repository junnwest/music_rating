/**
 * iTunes queue ingest — drains artist_ingestion_queue via iTunes Search API.
 * No Spotify. No auth. No rate limits beyond iTunes throttling.
 *
 * For each pending artist:
 *   1. Search iTunes for the artist ID
 *   2. Fetch their full discography (albums + EPs)
 *   3. Upsert releases into DB (dedup on itunes_id, then title+artist)
 *   4. Mark queue row as done / failed / skipped
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/ingest-itunes-queue.ts
 *   npx tsx --env-file=.env.local scripts/ingest-itunes-queue.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/ingest-itunes-queue.ts --limit=50
 *
 * Resumable: re-run anytime — processed artists are marked done in the queue.
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN   = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const BATCH_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 9999;
const DELAY_MS  = 650;   // stay comfortably below iTunes 429 threshold
const ITUNES_BASE = 'https://itunes.apple.com';

// ── iTunes API ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(DELAY_MS);
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-queue-ingest/1.0' } });
  if (res.status === 429 || res.status === 403) {
    const wait = Math.min(120000, 10000 * 2 ** attempt);
    process.stdout.write(`\n  [${res.status}] iTunes blocked — waiting ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 5) return null;
    return itunesGet(url, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

function normalizeStr(s: string): string {
  return s.toLowerCase()
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE_RE = /\b(sped[- ]up|slowed|instrumental|karaoke|off[- ]vocal|mr\.?|inst\.?)\b/i;

function artworkUrl(url: string): string {
  return url.replace('100x100', '600x600').replace('100bb', '600bb');
}

function releaseType(trackCount: number, name: string): string {
  const n = name.toLowerCase();
  if (trackCount <= 3) return 'Single';
  if (trackCount <= 6 || n.includes(' ep') || n.endsWith('ep')) return 'EP';
  if (n.includes('live') || n.includes('concert')) return 'Live';
  if (n.includes('best of') || n.includes('greatest hits') || n.includes('compilation')) return 'Compilation';
  return 'Album';
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

function mapGenre(g: string): string {
  return GENRE_MAP[g] ?? g.toLowerCase();
}

async function findItunesArtistId(name: string): Promise<{ id: number; canonicalName: string } | null> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
  const data = await itunesGet(url);
  if (!data) return null;
  const results: any[] = data.results ?? [];
  const normName = normalizeStr(name);
  const match =
    results.find(r => r.wrapperType === 'artist' && normalizeStr(r.artistName) === normName) ??
    results.find(r => r.wrapperType === 'artist');
  if (!match) return null;
  return { id: match.artistId, canonicalName: match.artistName };
}

async function fetchDiscography(artistId: number): Promise<any[]> {
  const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200`;
  const data = await itunesGet(url);
  if (!data) return [];
  return (data.results ?? []).filter((r: any) =>
    r.wrapperType === 'collection' &&
    r.collectionType === 'Album' &&
    !NOISE_RE.test(r.collectionName)
  );
}

function hasHangul(s: string): boolean {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(s);
}

// Fetch Korean names for an artist's albums from the KR iTunes store.
// Returns a map of collectionId → { titleKo, artistKo } for entries with Hangul.
async function fetchKoreanNames(artistId: number): Promise<Map<number, { titleKo: string; artistKo: string }>> {
  const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200&country=KR`;
  const data = await itunesGet(url);
  const map = new Map<number, { titleKo: string; artistKo: string }>();
  if (!data) return map;
  for (const r of data.results ?? []) {
    if (r.wrapperType !== 'collection' || !r.collectionId) continue;
    const titleKo = r.collectionName ?? '';
    const artistKo = r.artistName ?? '';
    if (hasHangul(titleKo) || hasHangul(artistKo)) {
      map.set(r.collectionId, { titleKo, artistKo });
    }
  }
  return map;
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

type DB = ReturnType<typeof getDB>;

async function upsertRelease(
  db: DB,
  album: any,
  koNames: { titleKo: string; artistKo: string } | undefined,
): Promise<'inserted' | 'enriched' | 'skipped'> {
  // 1. Already have this iTunes ID
  const { data: byItunes } = await db
    .from('releases').select('id').eq('itunes_id', album.collectionId).maybeSingle();
  if (byItunes) return 'skipped';

  // 2. Existing record with same title+artist (Spotify-sourced) — enrich it
  const { data: byTitle } = await db
    .from('releases').select('id, title, artist, cover_url')
    .ilike('title', album.collectionName)
    .ilike('artist', album.artistName)
    .maybeSingle();

  const cover  = artworkUrl(album.artworkUrl100 ?? '');
  const genre  = mapGenre(album.primaryGenreName ?? '');
  const rtype  = releaseType(album.trackCount ?? 0, album.collectionName);
  const date   = album.releaseDate?.slice(0, 10) ?? null;

  if (
    byTitle &&
    normalizeStr(byTitle.title) === normalizeStr(album.collectionName) &&
    normalizeStr(byTitle.artist) === normalizeStr(album.artistName)
  ) {
    const coverUpdate = cover && !(byTitle as any).cover_url
      ? { cover_url: cover, cover_source: 'itunes' }
      : {};
    await db.from('releases').update({
      itunes_id:        album.collectionId,
      canonical_source: 'itunes',
      ...(koNames ? { title_ko: koNames.titleKo, artist_ko: koNames.artistKo } : {}),
      ...coverUpdate,
    }).eq('id', byTitle.id);
    return 'enriched';
  }

  // 3. New record
  if (DRY_RUN) return 'inserted';
  const { error } = await db.from('releases').insert({
    id:               crypto.randomUUID(),
    itunes_id:        album.collectionId,
    title:            album.collectionName,
    artist:           album.artistName,
    title_ko:         koNames?.titleKo ?? null,
    artist_ko:        koNames?.artistKo ?? null,
    release_date:     date,
    release_type:     rtype,
    cover_url:        cover || null,
    cover_source:     cover ? 'itunes' : null,
    genres:           genre || null,
    canonical_source: 'itunes',
    total_tracks:     album.trackCount ?? null,
    cached_at:        new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return 'inserted';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku iTunes queue ingest${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db = getDB();

  // Pull pending artists from queue
  const { data: queue, error: qErr } = await db
    .from('artist_ingestion_queue')
    .select('id, name, itunes_artist_id')
    .eq('status', 'pending')
    .order('created_at')
    .limit(BATCH_LIMIT);

  if (qErr) { console.error('Queue fetch error:', qErr.message); process.exit(1); }
  if (!queue || queue.length === 0) {
    console.log('  No pending artists in queue. Run npm run queue:build first.');
    return;
  }

  console.log(`  Pending artists : ${queue.length}${BATCH_LIMIT < 9999 ? ` (limited to ${BATCH_LIMIT})` : ''}\n`);

  let totalInserted = 0, totalEnriched = 0, totalSkipped = 0, artistsFailed = 0, artistsNoMatch = 0;

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    process.stdout.write(`  [${i + 1}/${queue.length}] ${row.name.padEnd(35)} `);

    // Mark as processing
    if (!DRY_RUN) {
      await db.from('artist_ingestion_queue')
        .update({ status: 'processing' })
        .eq('id', row.id);
    }

    try {
      // Resolve iTunes artist ID (use cached one if already found)
      let itunesId = row.itunes_artist_id;
      let canonicalName = row.name;

      if (!itunesId) {
        const found = await findItunesArtistId(row.name);
        if (!found) {
          process.stdout.write('no iTunes match\n');
          if (!DRY_RUN) {
            await db.from('artist_ingestion_queue')
              .update({ status: 'skipped', processed_at: new Date().toISOString() })
              .eq('id', row.id);
          }
          artistsNoMatch++;
          continue;
        }
        itunesId = found.id;
        canonicalName = found.canonicalName;
        if (!DRY_RUN) {
          await db.from('artist_ingestion_queue')
            .update({ itunes_artist_id: itunesId })
            .eq('id', row.id);
        }
      }

      // Fetch discography (default store) + Korean names (KR store)
      const albums = await fetchDiscography(itunesId);
      const koMap  = await fetchKoreanNames(itunesId);
      process.stdout.write(`${albums.length} albums → `);

      let ins = 0, enr = 0, skp = 0;
      for (const album of albums) {
        const koNames = koMap.get(album.collectionId);
        const result = await upsertRelease(db, album, koNames);
        if (result === 'inserted') ins++;
        else if (result === 'enriched') enr++;
        else skp++;
      }

      process.stdout.write(`+${ins} new, ~${enr} enriched, ${skp} skipped\n`);
      totalInserted += ins;
      totalEnriched += enr;
      totalSkipped  += skp;

      if (!DRY_RUN) {
        await db.from('artist_ingestion_queue').update({
          status:        'done',
          releases_added: ins,
          processed_at:  new Date().toISOString(),
        }).eq('id', row.id);
      }

    } catch (err) {
      process.stdout.write(`ERROR: ${(err as Error).message}\n`);
      if (!DRY_RUN) {
        await db.from('artist_ingestion_queue').update({
          status:       'failed',
          error:        (err as Error).message.slice(0, 255),
          processed_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
      artistsFailed++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Releases inserted  : ${totalInserted}
  Releases enriched  : ${totalEnriched}
  Releases skipped   : ${totalSkipped}
  Artists no match   : ${artistsNoMatch}
  Artists failed     : ${artistsFailed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
