/**
 * iTunes-first catalog ingestion — zero Spotify API calls.
 *
 * Modes:
 *   seed        Work through the built-in Korean artist seed list
 *   discography Fetch iTunes discographies for every artist already in the DB
 *   artist      Single artist: --artist="NewJeans"
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/ingest-itunes.ts seed
 *   npx tsx --env-file=.env.local scripts/ingest-itunes.ts discography
 *   npx tsx --env-file=.env.local scripts/ingest-itunes.ts artist --artist="IU"
 *   Add --dry-run to preview without writing to DB.
 *   Add --with-tracks to also fetch tracklists (3× slower, costs more API calls).
 *
 * Deduplication logic (no Spotify needed):
 *   1. itunes_id already in DB → skip
 *   2. Exact normalized title+artist match on existing record → enrich with itunes_id
 *   3. No match → insert as new record (canonical_source = 'itunes')
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────

const MODE = process.argv.find(a => ['seed', 'discography', 'artist'].includes(a)) as
  'seed' | 'discography' | 'artist' | undefined;
const DRY_RUN   = process.argv.includes('--dry-run');
const WITH_TRACKS = process.argv.includes('--with-tracks');
const ARTIST_ARG  = process.argv.find(a => a.startsWith('--artist='))?.split('=').slice(1).join('=');

const DELAY_MS   = 600;   // 600ms ≈ 1.6 req/s; iTunes 429s at ~3 req/s sustained
const TRACK_DELAY_MS = 800;

const STATE_PATH = path.resolve('scripts/itunes-state.json');

if (!MODE) {
  console.error('Usage: ingest-itunes.ts <seed|discography|artist> [--dry-run] [--with-tracks] [--artist=NAME]');
  process.exit(1);
}
if (MODE === 'artist' && !ARTIST_ARG) {
  console.error('--artist=NAME required in artist mode');
  process.exit(1);
}

// ── iTunes API ────────────────────────────────────────────────────────────────

const ITUNES_BASE = 'https://itunes.apple.com';

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(DELAY_MS);
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-catalog-ingest/1.0' } });
  if (res.status === 429 || res.status === 403) {
    // 429 = rate limit; 403 = temporary IP block after sustained 429s
    const wait = Math.min(120000, 10000 * 2 ** attempt);  // 10s, 20s, 40s, 80s, 120s
    console.log(`\n  [${res.status}] iTunes blocked — waiting ${wait / 1000}s…`);
    await sleep(wait);
    if (attempt >= 5) throw new Error(`iTunes ${res.status} after ${attempt + 1} retries: ${url}`);
    return itunesGet(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`iTunes ${res.status}: ${url}`);
  return res.json();
}

interface ItunesArtist {
  artistId: number;
  artistName: string;
  artistType: string;
}

interface ItunesAlbum {
  collectionId: number;
  artistId: number;
  artistName: string;
  collectionName: string;
  releaseDate: string;       // ISO 8601
  primaryGenreName: string;
  trackCount: number;
  artworkUrl100: string;
  collectionType: string;    // 'Album'
  country: string;
  collectionPrice?: number;
  wrapperType: string;       // 'collection'
}

interface ItunesTrack {
  trackId: number;
  trackNumber: number;
  trackName: string;
  trackTimeMillis?: number;
  artistName: string;
  wrapperType: string;       // 'track'
}

async function searchArtist(name: string): Promise<ItunesArtist | null> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
  const data = await itunesGet(url);
  const results: any[] = data.results ?? [];
  // Find best name match
  const normName = normalizeTitle(name);
  const exact = results.find(r =>
    r.wrapperType === 'artist' && normalizeTitle(r.artistName) === normName
  );
  const best = exact ?? results.find(r => r.wrapperType === 'artist');
  if (!best) return null;
  return { artistId: best.artistId, artistName: best.artistName, artistType: best.artistType };
}

// Noise patterns: skip remix albums, sped-up/slowed variants, instrumentals, karaoke.
const NOISE_RE = /\b(sped[- ]up|slowed|remix(?:es)?|instrumental|karaoke|off[- ]vocal|mr\.?|inst\.?)\b/i;

function isNoiseRelease(album: ItunesAlbum): boolean {
  // Single-track remixes and instrumental variants are noise; full remix albums (Remixes) are ok
  const name = album.collectionName;
  if (NOISE_RE.test(name) && album.trackCount <= 3) return true;
  return false;
}

async function fetchDiscography(itunesArtistId: number): Promise<ItunesAlbum[]> {
  const url = `${ITUNES_BASE}/lookup?id=${itunesArtistId}&entity=album&limit=200`;
  const data = await itunesGet(url);
  return (data.results ?? []).filter(
    (r: any) => r.wrapperType === 'collection' && r.collectionType === 'Album' && !isNoiseRelease(r)
  ) as ItunesAlbum[];
}

async function fetchTracks(collectionId: number): Promise<ItunesTrack[]> {
  await sleep(TRACK_DELAY_MS);
  const url = `${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=50`;
  const data = await itunesGet(url);
  return (data.results ?? []).filter((r: any) => r.wrapperType === 'track') as ItunesTrack[];
}

function artworkUrl(url: string, size = 600): string {
  return url
    .replace('100x100', `${size}x${size}`)
    .replace('100bb', `${size}bb`);
}

function releaseTypeFromAlbum(album: ItunesAlbum): string {
  const name = album.collectionName.toLowerCase();
  if (album.trackCount === 1) return 'Single';
  if (album.trackCount <= 3) return 'Single';
  if (album.trackCount <= 6 || name.includes(' ep') || name.endsWith('ep')) return 'EP';
  if (name.includes('live') || name.includes('concert')) return 'Live';
  if (name.includes('best') || name.includes('greatest hits') || name.includes('compilation')) return 'Compilation';
  return 'Album';
}

// ── Normalization & deduplication ─────────────────────────────────────────────

// Keep CJK characters; strip punctuation but not letters or digits.
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtist(s: string): string {
  return normalizeTitle(s)
    .replace(/\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function exactMatch(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

// ── Genre mapping ─────────────────────────────────────────────────────────────

// Map iTunes genre names → internal genre tags used throughout the app.
const GENRE_MAP: Record<string, string> = {
  'K-Pop':          'k-pop',
  'Korean Pop':     'k-pop',
  'Korean':         'k-pop',
  'J-Pop':          'j-pop',
  'Asian Pop':      'k-pop',
  'Hip-Hop/Rap':    'hip-hop',
  'Hip Hop/Rap':    'hip-hop',
  'R&B/Soul':       'r&b',
  'Electronic':     'electronic',
  'Dance':          'electronic',
  'Indie Pop':      'indie',
  'Alternative':    'alternative',
  'Rock':           'rock',
  'Pop':            'pop',
  'Classical':      'classical',
  'Jazz':           'jazz',
  'Soundtrack':     'soundtrack',
  'Ballad':         'ballad',
};

function mapGenre(itunesGenre: string): string {
  return GENRE_MAP[itunesGenre] ?? itunesGenre.toLowerCase();
}

// ── State ─────────────────────────────────────────────────────────────────────

interface ItunesState {
  processedArtists: string[];  // artist names already fully processed
}

function loadState(): ItunesState {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return { processedArtists: [] };
}

function saveState(state: ItunesState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function getDB() {
  const url   = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key   = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

interface UpsertResult { action: 'inserted' | 'enriched' | 'skipped' }

async function upsertAlbum(
  db: ReturnType<typeof getDB>,
  album: ItunesAlbum,
  tracks: ItunesTrack[],
): Promise<UpsertResult> {
  // 1. Already have this itunes_id?
  const { data: existing } = await db
    .from('releases')
    .select('id, itunes_id')
    .eq('itunes_id', album.collectionId)
    .maybeSingle();

  if (existing) return { action: 'skipped' };

  // 2. Exact title+artist match on an existing record (Spotify-sourced)?
  const { data: byTitle } = await db
    .from('releases')
    .select('id, itunes_id, artist_id, title, artist')
    .ilike('title', album.collectionName)
    .ilike('artist', album.artistName)
    .maybeSingle();

  const cover = artworkUrl(album.artworkUrl100);
  const genre  = mapGenre(album.primaryGenreName);
  const rtype  = releaseTypeFromAlbum(album);
  const tracklist = tracks.map(t => ({
    position:   t.trackNumber,
    title:      t.trackName,
    durationMs: t.trackTimeMillis ?? null,
    artists:    t.artistName,
  }));

  if (byTitle && exactMatch(byTitle.title, album.collectionName) && exactMatch(byTitle.artist, album.artistName)) {
    // Enrich the existing Spotify record with itunes_id.
    // Don't overwrite tracklist — Spotify's is richer (has duration, ISRC, etc).
    const update: Record<string, any> = { itunes_id: album.collectionId, canonical_source: 'itunes' };
    if (!byTitle.artist_id && genre) update.genres = genre;  // backfill genre if Spotify left it empty
    const { error } = await db.from('releases').update(update).eq('id', byTitle.id);
    if (error) throw new Error(error.message);
    return { action: 'enriched' };
  }

  // 3. Insert new iTunes-only record. Use a UUID as the text PK since there's no Spotify ID.
  const newId = crypto.randomUUID();
  const { error } = await db.from('releases').insert({
    id:               newId,
    itunes_id:        album.collectionId,
    title:            album.collectionName,
    artist:           album.artistName,
    release_date:     album.releaseDate?.slice(0, 10) ?? null,
    release_type:     rtype,
    total_tracks:     album.trackCount,
    genres:           genre,
    cover_url:        cover,
    cover_source:     'itunes',
    canonical_source: 'itunes',
    tracklist:        tracklist.length ? tracklist : null,
    cached_at:        new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  return { action: 'inserted' };
}

// ── Seed artist list ──────────────────────────────────────────────────────────

// Curated list of Korean artists across genres.
// Add more artists here; the script will skip ones already processed.
const SEED_ARTISTS = [
  // K-pop 4th gen
  'aespa', 'NewJeans', 'IVE', 'LE SSERAFIM', 'NMIXX', 'Kep1er', 'ILLIT',
  'ENHYPEN', 'TXT', 'Stray Kids', 'ATEEZ', 'MONSTA X', 'The Boyz', 'ONEUS',
  'SEVENTEEN', 'NCT 127', 'NCT Dream', 'WayV', 'aespa',

  // K-pop 3rd gen
  'BTS', 'BLACKPINK', 'EXO', 'Red Velvet', 'TWICE', 'MAMAMOO', 'ITZY',
  '(G)I-DLE', 'OH MY GIRL', 'ASTRO', 'PENTAGON', 'Dreamcatcher', 'Weki Meki',

  // K-pop 2nd gen
  'Girls Generation', 'SHINee', 'Super Junior', 'BIGBANG', '2NE1', 'INFINITE',
  'B2ST', 'f(x)', 'Miss A', 'T-ara', 'After School', 'SISTAR', 'A Pink',
  'BEAST', 'Block B', 'Teen Top', 'VIXX',

  // K-pop 1st gen / classic
  'H.O.T', 'god', 'Shinhwa', 'S.E.S.', 'Fin.K.L', 'Baby V.O.X',
  'Seo Taiji and Boys',

  // Solo pop / R&B / ballad
  'IU', 'Taeyeon', 'Taeyang', 'G-Dragon', 'CL', 'Lee Hi', 'Heize',
  'Suzy', 'Baekhyun', 'Chanyeol', 'Sehun', 'Kai',

  // Korean R&B / Soul
  'Dean', 'Crush', 'Zion.T', 'GRAY', 'Colde', 'offonoff', 'pH-1',
  'MISO', 'SOLE', 'BIBI', 'Primary', 'Loco', 'Simon Dominic',
  'Hoody', 'Sik-K', 'Woo', 'PENOMECO',

  // Korean hip-hop
  'Epik High', 'Dynamic Duo', 'Dok2', 'The Quiett', 'Beenzino',
  'Lil Boi', 'Jay Park', 'Swings', 'Hash Swan', 'Changmo',
  'Nafla', 'Loco',

  // Korean indie / alternative
  'Hyukoh', 'Jannabi', 'Nell', 'The Rose', 'DAY6', 'N.Flying',
  'Silica Gel', 'Sunwoo Jung-a', 'Leenalchi', 'Adoy', 'Cifika',
  'Glen Check', 'Se So Neon', 'HONNE', 'LUCY', 'Sultan of the Disco',
  'Guckkasten', '술탄 오브 더 디스코',

  // Older Korean artists
  'Kim Kwang Seok', 'Lee Juck', 'Shin Hae Chul', 'Lee Seung Hwan',
  'Kim Gun Mo', 'Cho Yong Pil', 'Na Hoon A', 'Lim Chang Jung',
  'Park Hyo Shin', 'Song Chang Shik', 'Lee Moon Sae',
];

// ── Core processing ───────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function processArtist(
  name: string,
  db: ReturnType<typeof getDB> | null,
  stats: { inserted: number; enriched: number; skipped: number },
): Promise<'ok' | 'skip' | 'fatal'> {
  process.stdout.write(`  Searching iTunes for "${name}"… `);

  let artist;
  try {
    artist = await searchArtist(name);
  } catch (err: any) {
    console.log(`error: ${err.message}`);
    // Propagate fatal errors (exhausted retries on 429/403) to abort the run
    if (err.message.includes('retries')) return 'fatal';
    return 'skip';
  }
  if (!artist) {
    console.log('not found');
    return 'skip';
  }
  console.log(`found: ${artist.artistName} (id ${artist.artistId})`);

  const albums = await fetchDiscography(artist.artistId);
  console.log(`    ${albums.length} albums in iTunes discography`);

  for (const album of albums) {
    let tracks: ItunesTrack[] = [];
    if (WITH_TRACKS) tracks = await fetchTracks(album.collectionId);

    const year = album.releaseDate?.slice(0, 4) ?? '?';
    process.stdout.write(`    "${album.collectionName}" (${year}) … `);

    if (DRY_RUN || !db) {
      console.log('[dry run]');
      stats.inserted++;
      continue;
    }

    try {
      const result = await upsertAlbum(db, album, tracks);
      console.log(result.action);
      stats[result.action]++;
    } catch (err: any) {
      console.log(`error: ${err.message}`);
      if (err.message.includes('retries')) return 'fatal';
    }
  }
  return 'ok';
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function runSeed(db: ReturnType<typeof getDB> | null, state: ItunesState) {
  const todo = SEED_ARTISTS.filter(a => !state.processedArtists.includes(a));
  console.log(`   Seed list: ${SEED_ARTISTS.length} artists | Remaining: ${todo.length}\n`);

  const stats = { inserted: 0, enriched: 0, skipped: 0 };

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    console.log(`\n[${i + 1}/${todo.length}] ${name}`);
    const result = await processArtist(name, db, stats);
    if (result !== 'fatal') state.processedArtists.push(name);
    if (!DRY_RUN) saveState(state);
    if (result === 'fatal') {
      console.log('\n  iTunes blocked after max retries — progress saved, re-run to resume.');
      break;
    }
  }

  if (!DRY_RUN) saveState(state);
  return stats;
}

async function runDiscography(db: ReturnType<typeof getDB> | null, state: ItunesState) {
  if (!db) {
    console.error('Cannot run discography mode in dry-run without DB connection');
    process.exit(1);
  }

  const { data: artists } = await db.from('artists').select('name, spotify_artist_id').order('name');
  const list = (artists ?? []).map((a: any) => a.name as string);
  const todo = list.filter((a: string) => !state.processedArtists.includes(a));
  console.log(`   DB artists: ${list.length} | Remaining: ${todo.length}\n`);

  const stats = { inserted: 0, enriched: 0, skipped: 0 };

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    console.log(`\n[${i + 1}/${todo.length}] ${name}`);
    await processArtist(name, db, stats);
    state.processedArtists.push(name);
    if ((i + 1) % 5 === 0) saveState(state);
  }

  saveState(state);
  return stats;
}

async function runArtist(db: ReturnType<typeof getDB> | null, _state: ItunesState) {
  console.log(`   Artist: ${ARTIST_ARG}\n`);
  const stats = { inserted: 0, enriched: 0, skipped: 0 };
  await processArtist(ARTIST_ARG!, db, stats);
  return stats;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku iTunes ingest — mode: ${MODE}`);
  if (DRY_RUN)    console.log('  [DRY RUN — no DB writes]');
  if (WITH_TRACKS) console.log('  [WITH TRACKS — fetching tracklists]');
  console.log('');

  const db    = DRY_RUN ? null : getDB();
  const state = loadState();

  let stats: { inserted: number; enriched: number; skipped: number };

  if (MODE === 'seed')        stats = await runSeed(db, state);
  else if (MODE === 'discography') stats = await runDiscography(db, state);
  else                        stats = await runArtist(db, state);

  const total = stats.inserted + stats.enriched + stats.skipped;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mode      : ${MODE}
  Processed : ${total} albums
  Inserted  : ${stats.inserted} new records${DRY_RUN ? ' (dry run)' : ''}
  Enriched  : ${stats.enriched} existing records got itunes_id
  Skipped   : ${stats.skipped} already in DB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
