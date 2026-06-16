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
// Fetch each album's tracklist (one extra iTunes lookup per album). Off by
// default to keep the discover→ingest loop fast; the backfill:tracklists script
// fills tracklists for existing rows. Use --with-tracks to populate at ingest.
const WITH_TRACKS = process.argv.includes('--with-tracks');
// Skip Single-type releases entirely. Singles are 66% of the catalog and are
// excluded from recommendations/leaderboards anyway, so for deliberate
// expansion runs this keeps new data album/EP-focused and improves the
// album:single composition ratio over time.
const SKIP_SINGLES = process.argv.includes('--skip-singles');
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

function isCollaborationArtist(name: string): boolean {
  if (LEGIT_COMPOUND_ACTS.has(name.toLowerCase())) return false;
  if (/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(name)) return true;
  if (/&/.test(name)) return true;
  if (/\s\+\s/.test(name)) return true;
  return false;
}

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

type Track = { position: number; title: string; durationMs: number | null; artists: string };

// Look up a collection's songs and map them to the album page's tracklist shape.
// Multi-disc albums repeat track numbers per disc, so fall back to a sequential
// running position to keep keys unique.
async function fetchTracks(collectionId: number): Promise<Track[]> {
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

// Detects ISO 639-1 language from script. Returns null for Latin/ASCII text.
function detectLanguage(s: string): string | null {
  if (/[가-힣ᄀ-ᇿ]/.test(s)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'zh';
  return null;
}

function hasNativeScript(s: string): boolean {
  return detectLanguage(s) !== null;
}

const LANGUAGE_TO_STORE: Record<string, string> = { ko: 'KR', ja: 'JP', zh: 'TW' };

// Fetch native-language names from the artist's local iTunes store.
// Only called when we know the artist's language (from name_native in the queue row).
// Returns a map of collectionId → { titleNative, artistNative, nativeLanguage }.
async function fetchNativeNames(
  artistId: number,
  storeCountry: string,
): Promise<Map<number, { titleNative: string; artistNative: string; nativeLanguage: string }>> {
  const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200&country=${storeCountry}`;
  const data = await itunesGet(url);
  const map = new Map<number, { titleNative: string; artistNative: string; nativeLanguage: string }>();
  if (!data) return map;
  for (const r of data.results ?? []) {
    if (r.wrapperType !== 'collection' || !r.collectionId) continue;
    const titleNative  = r.collectionName ?? '';
    const artistNative = r.artistName ?? '';
    const lang = detectLanguage(titleNative) ?? detectLanguage(artistNative);
    if (lang) {
      map.set(r.collectionId, { titleNative, artistNative, nativeLanguage: lang });
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
  nativeNames: { titleNative: string; artistNative: string; nativeLanguage: string } | undefined,
): Promise<'inserted' | 'enriched' | 'skipped'> {
  // 1. Already have this iTunes ID.
  // Use .limit(1) not .maybeSingle() — maybeSingle() returns null data (not the row)
  // when >1 rows match, causing the duplicate check to silently pass and insert again.
  const { data: byItunesRows } = await db
    .from('releases').select('id').eq('itunes_id', album.collectionId).limit(1);
  if (byItunesRows && byItunesRows.length > 0) return 'skipped';

  // 2. Existing record with same title+artist (Spotify-sourced) — enrich it.
  // Two passes: first match by English artist name, then by artist_native.
  // This catches cross-language-name duplicates like "Yerin Baek" (Spotify) vs
  // "백예린" (iTunes) where the title matches but the artist name script differs.
  let { data: byTitle } = await db
    .from('releases').select('id, title, artist, artist_native, cover_url')
    .ilike('title', album.collectionName)
    .ilike('artist', album.artistName)
    .maybeSingle();

  if (!byTitle) {
    const { data: byNative } = await db
      .from('releases').select('id, title, artist, artist_native, cover_url')
      .ilike('title', album.collectionName)
      .ilike('artist_native', album.artistName)
      .maybeSingle();
    byTitle = byNative;
  }

  const cover  = artworkUrl(album.artworkUrl100 ?? '');
  const genre  = mapGenre(album.primaryGenreName ?? '');
  const rtype  = releaseType(album.trackCount ?? 0, album.collectionName);
  const date   = album.releaseDate?.slice(0, 10) ?? null;

  if (SKIP_SINGLES && rtype === 'Single') return 'skipped';

  if (
    byTitle &&
    normalizeStr(byTitle.title) === normalizeStr(album.collectionName) &&
    (
      normalizeStr(byTitle.artist) === normalizeStr(album.artistName) ||
      (byTitle.artist_native && normalizeStr(byTitle.artist_native) === normalizeStr(album.artistName))
    )
  ) {
    const coverUpdate = cover && !(byTitle as any).cover_url
      ? { cover_url: cover, cover_source: 'itunes' }
      : {};
    await db.from('releases').update({
      itunes_id:        album.collectionId,
      canonical_source: 'itunes',
      ...(nativeNames ? { title_native: nativeNames.titleNative, artist_native: nativeNames.artistNative, native_language: nativeNames.nativeLanguage } : {}),
      ...coverUpdate,
    }).eq('id', byTitle.id);
    return 'enriched';
  }

  // 3. New record
  if (DRY_RUN) return 'inserted';
  const tracklist = WITH_TRACKS ? await fetchTracks(album.collectionId) : [];
  const { error } = await db.from('releases').insert({
    id:               crypto.randomUUID(),
    itunes_id:        album.collectionId,
    title:            album.collectionName,
    artist:           album.artistName,
    title_native:         nativeNames?.titleNative ?? null,
    artist_native:        nativeNames?.artistNative ?? null,
    native_language:      nativeNames?.nativeLanguage ?? null,
    release_date:     date,
    release_type:     rtype,
    cover_url:        cover || null,
    cover_source:     cover ? 'itunes' : null,
    genres:           genre || null,
    canonical_source: 'itunes',
    total_tracks:     album.trackCount ?? null,
    tracklist:        tracklist.length > 0 ? tracklist : null,
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
    .select('id, name, itunes_artist_id, name_native')
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

    // Skip collaboration entries (e.g. "Coldplay & BTS", "Drake feat. 21 Savage").
    // These are Last.fm collab nodes, not real standalone artist entities.
    if (isCollaborationArtist(row.name)) {
      process.stdout.write('collab — skipped\n');
      if (!DRY_RUN) {
        await db.from('artist_ingestion_queue')
          .update({ status: 'skipped', processed_at: new Date().toISOString() })
          .eq('id', row.id);
      }
      totalSkipped++;
      continue;
    }

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

      // Fetch discography (default store) + native names (local store if language known)
      const albums = await fetchDiscography(itunesId);
      // Only call the local store if we know the artist's language from name_native in queue.
      // Artists without name_native (added by queue:discover) skip this — backfill:native handles them.
      const artistLang = row.name_native ? detectLanguage(row.name_native) : null;
      const storeCountry = artistLang ? LANGUAGE_TO_STORE[artistLang] : null;
      const nativeMap = storeCountry ? await fetchNativeNames(itunesId, storeCountry) : new Map();
      process.stdout.write(`${albums.length} albums → `);

      let ins = 0, enr = 0, skp = 0;
      for (const album of albums) {
        const nativeNames = nativeMap.get(album.collectionId);
        const result = await upsertRelease(db, album, nativeNames);
        if (result === 'inserted') ins++;
        else if (result === 'enriched') enr++;
        else skp++;
      }

      // Propagate itunes_artist_id + name_native from the queue row to the artists table.
      // The artists table has an itunes_artist_id column that check:completeness reads;
      // it is never populated otherwise because resolution happens only in the queue flow.
      if (!DRY_RUN) {
        const artistUpdate: Record<string, any> = { itunes_artist_id: itunesId };
        if (row.name_native && artistLang) {
          artistUpdate.name_native     = row.name_native;
          artistUpdate.native_language = artistLang;
        }
        await db.from('artists')
          .update(artistUpdate)
          .ilike('name', row.name)
          .is('itunes_artist_id', null);
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
