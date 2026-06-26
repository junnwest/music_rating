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
 *   npx tsx --env-file=.env.local scripts/ingest-itunes.ts artist --itunes-id=1052669308
 *   Add --dry-run to preview without writing to DB.
 *   Add --with-tracks to also fetch tracklists (3× slower, costs more API calls).
 *
 * Use --itunes-id instead of --artist for non-English artists where name search
 * is unreliable (e.g. 드레스, 周杰倫). Get the ID from the audit-catalog test set.
 *
 * Deduplication logic (no Spotify needed):
 *   1. itunes_id already in DB → skip
 *   2. Exact normalized title+artist match on existing record → enrich with itunes_id
 *   3. No match → insert as new record (canonical_source = 'itunes')
 */

import fs from 'fs';
import path from 'path';
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
  type IngestContext,
  type AlbumInput,
  type TrackInput,
} from './itunes-ingest-core';

// ── Config ────────────────────────────────────────────────────────────────────

const MODE = process.argv.find(a => ['seed', 'discography', 'artist'].includes(a)) as
  'seed' | 'discography' | 'artist' | undefined;
const DRY_RUN     = process.argv.includes('--dry-run');
const WITH_TRACKS = process.argv.includes('--with-tracks');
const ARTIST_ARG  = process.argv.find(a => a.startsWith('--artist='))?.split('=').slice(1).join('=');
const ITUNES_ID_ARG = (() => {
  const raw = process.argv.find(a => a.startsWith('--itunes-id='))?.split('=')[1];
  return raw ? parseInt(raw, 10) : undefined;
})();

const DELAY_MS   = 600;   // 600ms ≈ 1.6 req/s; iTunes 429s at ~3 req/s sustained
const TRACK_DELAY_MS = 800;

const STATE_PATH = path.resolve('scripts/itunes-state.json');

if (!MODE) {
  console.error('Usage: ingest-itunes.ts <seed|discography|artist> [--dry-run] [--with-tracks] [--artist=NAME]');
  process.exit(1);
}
if (MODE === 'artist' && !ARTIST_ARG && !ITUNES_ID_ARG) {
  console.error('--artist=NAME or --itunes-id=NUMBER required in artist mode');
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
  const normName = normalizeStr(name);
  const exact = results.find(r =>
    r.wrapperType === 'artist' && normalizeStr(r.artistName) === normName
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

// Map a collection's songs to the shared TrackInput shape. Multi-disc albums
// repeat track numbers per disc, so flatten to a running position for unique keys.
async function fetchTracks(collectionId: number): Promise<TrackInput[]> {
  await sleep(TRACK_DELAY_MS);
  const url = `${ITUNES_BASE}/lookup?id=${collectionId}&entity=song&limit=300`;
  const data = await itunesGet(url);
  const songs: any[] = (data.results ?? []).filter(
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

// (DB handle + entity-graph writes now live in itunes-ingest-core.ts)

// ── Seed artist list ──────────────────────────────────────────────────────────

// Curated list of artists across markets and genres.
// Add more artists here; the script will skip ones already processed.
// NOTE: For non-English artists where name search is unreliable, use
//       `itunes:artist --itunes-id=NUMBER` instead of adding to this list.
const SEED_ARTISTS = [
  // ── Korean: K-pop 4th gen ─────────────────────────────────────────────────
  'aespa', 'NewJeans', 'IVE', 'LE SSERAFIM', 'NMIXX', 'Kep1er', 'ILLIT',
  'ENHYPEN', 'TXT', 'Stray Kids', 'ATEEZ', 'MONSTA X', 'The Boyz', 'ONEUS',
  'SEVENTEEN', 'NCT 127', 'NCT Dream', 'WayV',

  // ── Korean: K-pop 3rd gen ─────────────────────────────────────────────────
  'BTS', 'BLACKPINK', 'EXO', 'Red Velvet', 'TWICE', 'MAMAMOO', 'ITZY',
  '(G)I-DLE', 'OH MY GIRL', 'ASTRO', 'PENTAGON', 'Dreamcatcher', 'Weki Meki',

  // ── Korean: K-pop 2nd gen ─────────────────────────────────────────────────
  'Girls Generation', 'SHINee', 'Super Junior', 'BIGBANG', '2NE1', 'INFINITE',
  'B2ST', 'f(x)', 'Miss A', 'T-ara', 'After School', 'SISTAR', 'A Pink',
  'BEAST', 'Block B', 'Teen Top', 'VIXX',

  // ── Korean: K-pop 1st gen / classic ──────────────────────────────────────
  'H.O.T', 'god', 'Shinhwa', 'S.E.S.', 'Fin.K.L', 'Baby V.O.X',
  'Seo Taiji and Boys',

  // ── Korean: Solo pop / R&B / ballad ──────────────────────────────────────
  'IU', 'Taeyeon', 'Taeyang', 'G-Dragon', 'CL', 'Lee Hi', 'Heize',
  'Suzy', 'Baekhyun', 'Chanyeol', 'Sehun', 'Kai',

  // ── Korean: R&B / Soul ────────────────────────────────────────────────────
  'Dean', 'Crush', 'Zion.T', 'GRAY', 'Colde', 'offonoff', 'pH-1',
  'MISO', 'SOLE', 'BIBI', 'Primary', 'Loco', 'Simon Dominic',
  'Hoody', 'Sik-K', 'Woo', 'PENOMECO',

  // ── Korean: Hip-hop ───────────────────────────────────────────────────────
  'Epik High', 'Dynamic Duo', 'Dok2', 'The Quiett', 'Beenzino',
  'Lil Boi', 'Jay Park', 'Swings', 'Hash Swan', 'Changmo',
  'Nafla',

  // ── Korean: Indie / alternative ───────────────────────────────────────────
  'Hyukoh', 'Jannabi', 'Nell', 'The Rose', 'DAY6', 'N.Flying',
  'Silica Gel', 'Sunwoo Jung-a', 'Leenalchi', 'Adoy', 'Cifika',
  'Glen Check', 'Se So Neon', 'LUCY', 'Sultan of the Disco',
  'Guckkasten',

  // ── Korean: Older artists ─────────────────────────────────────────────────
  'Kim Kwang Seok', 'Lee Juck', 'Shin Hae Chul', 'Lee Seung Hwan',
  'Kim Gun Mo', 'Cho Yong Pil', 'Na Hoon A', 'Lim Chang Jung',
  'Park Hyo Shin', 'Song Chang Shik', 'Lee Moon Sae',

  // ── Japanese ──────────────────────────────────────────────────────────────
  'YOASOBI', 'Hikaru Utada', 'Kenshi Yonezu', 'Aimyon', 'Official HIGE DANdism',
  'King Gnu', 'Fujii Kaze', 'Mrs. GREEN APPLE', 'Vaundy', 'Eve',
  'Yorushika', 'Hoshino Gen', 'RADWIMPS', 'Bump of Chicken',
  'Spitz', 'Shiina Ringo', 'Ado', 'imase',

  // ── Western: Pop ──────────────────────────────────────────────────────────
  'Taylor Swift', 'Adele', 'Beyoncé', 'Dua Lipa', 'Ariana Grande',
  'Ed Sheeran', 'Harry Styles', 'Olivia Rodrigo', 'Billie Eilish',
  'Sabrina Carpenter', 'Chappell Roan', 'Charli XCX', 'P!nk',
  'Katy Perry', 'Lady Gaga', 'Miley Cyrus', 'Selena Gomez',
  'Post Malone', 'The Weeknd',

  // ── Western: Hip-hop / R&B ────────────────────────────────────────────────
  'Drake', 'Kendrick Lamar', 'J. Cole', 'Travis Scott', 'Tyler, the Creator',
  'SZA', 'Frank Ocean', 'Childish Gambino', '21 Savage', 'Lil Baby',
  'Gunna', 'Future', 'Metro Boomin', 'Nicki Minaj', 'Cardi B',
  'Megan Thee Stallion', 'Doja Cat', 'Roddy Ricch',

  // ── Western: Rock / Alternative / Indie ──────────────────────────────────
  'Radiohead', 'Arctic Monkeys', 'Tame Impala', 'Beach House', 'Bon Iver',
  'The National', 'Phoebe Bridgers', 'Japanese Breakfast', 'boygenius',
  'Vampire Weekend', 'Fleet Foxes', 'Sufjan Stevens', 'Big Thief',
  'Mitski', 'Soccer Mommy', 'Snail Mail', 'Lucy Dacus',

  // ── Western: Electronic ───────────────────────────────────────────────────
  'Four Tet', 'Fred again..', 'Floating Points', 'Jamie xx',
  'Daft Punk', 'Justice', 'Air', 'Moderat', 'Jon Hopkins',
  'Aphex Twin', 'Boards of Canada', 'James Blake',

  // ── Western: Classic / Legacy ─────────────────────────────────────────────
  'The Beatles', 'Prince', 'Björk', 'Radiohead',
  'David Bowie', 'Bob Dylan', 'Bruce Springsteen', 'Neil Young',

  // ── Jazz ──────────────────────────────────────────────────────────────────
  'Miles Davis', 'John Coltrane', 'Bill Evans', 'Charlie Parker',
  'Dave Brubeck', 'Thelonious Monk', 'Herbie Hancock', 'Wayne Shorter',
  'Art Blakey', 'Wes Montgomery', 'Chet Baker',

  // ── Latin ─────────────────────────────────────────────────────────────────
  'Bad Bunny', 'J Balvin', 'Ozuna', 'Rauw Alejandro', 'Karol G',
  'ROSALÍA', 'Maluma', 'Anuel AA', 'Jhay Cortez', 'Myke Towers',
  'Sech', 'Farruko', 'Peso Pluma', 'Fuerza Regida', 'Natanael Cano',
  'Nicki Nicole', 'Bizarrap', 'Anitta',

  // ── Afrobeats / African ───────────────────────────────────────────────────
  'Burna Boy', 'Wizkid', 'Davido', 'Asake', 'Rema', 'Black Coffee',
  'Fireboy DML', 'CKay', 'Omah Lay', 'Ayra Starr', 'Tems',
  'Kizz Daniel', 'Olamide', 'Yemi Alade', 'Tiwa Savage',

  // ── French-language ───────────────────────────────────────────────────────
  'Stromae', 'Aya Nakamura', 'PNL', 'Angèle', 'Damso',
  'Ninho', 'Nekfeu', 'Orelsan', 'SCH', 'Hamza', 'Jul',

  // ── Indian ────────────────────────────────────────────────────────────────
  'Arijit Singh', 'A.R. Rahman', 'Shreya Ghoshal', 'Atif Aslam',
  'Jubin Nautiyal', 'Diljit Dosanjh', 'Neha Kakkar',
];

// ── Core processing ───────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

type Stats = { inserted: number; skipped: number };

async function processArtist(
  name: string,
  ctx: IngestContext,
  stats: Stats,
  knownItunesId?: number,
): Promise<'ok' | 'skip' | 'fatal'> {
  if (knownItunesId) {
    console.log(`  Using iTunes ID ${knownItunesId} for "${name}"`);
  } else {
    process.stdout.write(`  Searching iTunes for "${name}"… `);
    let artist;
    try {
      artist = await searchArtist(name);
    } catch (err: any) {
      console.log(`error: ${err.message}`);
      if (err.message.includes('retries')) return 'fatal';
      return 'skip';
    }
    if (!artist) {
      console.log('not found');
      return 'skip';
    }
    console.log(`found: ${artist.artistName} (id ${artist.artistId})`);
    knownItunesId = artist.artistId;
  }

  const albums = await fetchDiscography(knownItunesId);
  console.log(`    ${albums.length} albums in iTunes discography`);

  for (const album of albums) {
    const year = album.releaseDate?.slice(0, 4) ?? '?';
    process.stdout.write(`    "${album.collectionName}" (${year}) … `);

    try {
      const primaryArtistId = await findOrCreateArtist(ctx, {
        itunesArtistId: album.artistId,
        name:           album.artistName,
        nativeName:     detectLanguage(album.artistName) ? album.artistName : null,
      });
      const rtype = releaseType(album.trackCount ?? 0, album.collectionName);
      const group = await findOrCreateReleaseGroup(ctx, {
        primaryArtistId,
        artistDisplay:    album.artistName,
        title:            album.collectionName,
        appReleaseType:   rtype,
        firstReleaseDate: album.releaseDate?.slice(0, 10) ?? null,
        coverUrl:         artworkUrl(album.artworkUrl100 ?? '') || null,
        genre:            mapGenre(album.primaryGenreName ?? '') || null,
      });
      const tracks: TrackInput[] = WITH_TRACKS ? await fetchTracks(album.collectionId) : [];
      const result = await ingestEdition(ctx, { album, primaryArtistId, group, tracks });
      console.log(result);
      stats[result]++;
    } catch (err: any) {
      console.log(`error: ${err.message}`);
      if (err.message.includes('retries')) return 'fatal';
    }
  }
  return 'ok';
}

// ── Modes ─────────────────────────────────────────────────────────────────────

async function runSeed(ctx: IngestContext, state: ItunesState): Promise<Stats> {
  const todo = SEED_ARTISTS.filter(a => !state.processedArtists.includes(a));
  console.log(`   Seed list: ${SEED_ARTISTS.length} artists | Remaining: ${todo.length}\n`);

  const stats: Stats = { inserted: 0, skipped: 0 };

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    console.log(`\n[${i + 1}/${todo.length}] ${name}`);
    const result = await processArtist(name, ctx, stats);
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

async function runDiscography(ctx: IngestContext, state: ItunesState): Promise<Stats> {
  const { data: artists } = await ctx.db
    .from('artists')
    .select('name, itunes_artist_id')
    .order('name');
  const list = (artists ?? []) as { name: string; itunes_artist_id: number | null }[];
  const todo = list.filter(a => !state.processedArtists.includes(a.name));
  console.log(`   DB artists: ${list.length} | Remaining: ${todo.length}\n`);

  const stats: Stats = { inserted: 0, skipped: 0 };

  for (let i = 0; i < todo.length; i++) {
    const artist = todo[i];
    console.log(`\n[${i + 1}/${todo.length}] ${artist.name}${artist.itunes_artist_id ? ` (iTunes ID: ${artist.itunes_artist_id})` : ''}`);
    // findOrCreateArtist resolves + links the iTunes ID, so no manual back-write needed.
    await processArtist(artist.name, ctx, stats, artist.itunes_artist_id ?? undefined);
    state.processedArtists.push(artist.name);
    if ((i + 1) % 5 === 0) saveState(state);
  }

  saveState(state);
  return stats;
}

async function runArtist(ctx: IngestContext, _state: ItunesState): Promise<Stats> {
  const label = ARTIST_ARG ?? `iTunes ID ${ITUNES_ID_ARG}`;
  console.log(`   Artist: ${label}\n`);
  const stats: Stats = { inserted: 0, skipped: 0 };
  await processArtist(ARTIST_ARG ?? '', ctx, stats, ITUNES_ID_ARG);
  return stats;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku iTunes ingest — mode: ${MODE}`);
  if (DRY_RUN)    console.log('  [DRY RUN — no DB writes]');
  if (WITH_TRACKS) console.log('  [WITH TRACKS — fetching tracklists]');
  console.log('');

  const db    = getDB();
  const ctx   = createIngestContext(db, { dryRun: DRY_RUN, withTracks: WITH_TRACKS, skipSingles: false });
  const state = loadState();

  let stats: Stats;

  if (MODE === 'seed')             stats = await runSeed(ctx, state);
  else if (MODE === 'discography') stats = await runDiscography(ctx, state);
  else                             stats = await runArtist(ctx, state);

  const total = stats.inserted + stats.skipped;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Mode      : ${MODE}
  Processed : ${total} albums
  Inserted  : ${stats.inserted} new editions${DRY_RUN ? ' (dry run)' : ''}
  Skipped   : ${stats.skipped} (already present / dedup)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
