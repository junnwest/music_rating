/**
 * Builds the real candidate pool for the Instagram suitability-labeling tool.
 * Pulls real artists AND albums, ranked by real Sillajuku rating engagement —
 * deliberately WITHOUT the mainstream-idol-groups.json exclusion filter, since
 * the whole point of labeling is to train a model that learns that distinction
 * (and its edge cases, e.g. solo idol-adjacent stars the static list misses)
 * instead of hard-coding it.
 *
 * Output: scripts/output/suitability-pool.json — array of real candidates,
 * each with real catalog metadata (name, type, genres derived from their own
 * rated releases, country where known, real SJ rating count, and a real
 * cover_url where the catalog has one — for artist entries this is their
 * most-rated album's cover, not a fabricated "artist photo" the catalog
 * doesn't actually have). Downloading/resizing/publishing those covers as
 * local files is a separate step (fetch-suitability-covers.ts) — this
 * script only records which real URL to fetch, it doesn't fetch it.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/build-suitability-pool.ts
 *   npx tsx --env-file=.env.local scripts/build-suitability-pool.ts --artists=300 --albums=200
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const N_ARTISTS = Number(process.argv.find((a) => a.startsWith('--artists='))?.split('=')[1] ?? 300);
const N_ALBUMS = Number(process.argv.find((a) => a.startsWith('--albums='))?.split('=')[1] ?? 200);
const OUT_PATH = path.resolve('scripts/output/suitability-pool.json');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Add to .env.local.');
  process.exit(1);
}
const db = createClient(url, key);

interface Row {
  release_groups: {
    primary_artist_id: string | null;
    artist_display: string | null;
    title: string | null;
    genres: string[] | null;
    release_group_type: string | null;
    first_release_date: string | null;
    cover_url: string | null;
  } | null;
}

async function fetchAllRatingJoins(): Promise<Row[]> {
  const pageSize = 1000;
  let from = 0;
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await db
      .from('ratings')
      .select('release_groups(primary_artist_id, artist_display, title, genres, release_group_type, first_release_date, cover_url)')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('query error:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as any));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

interface ArtistAgg {
  artistId: string | null;
  name: string;
  ratingCount: number;
  genres: Set<string>;
  topAlbum: { title: string; count: number };
}

interface AlbumCandidate {
  id: string;
  type: 'album';
  name: string; // "Title — Artist"
  title: string;
  artist: string;
  genres: string[];
  ratingCount: number;
  releaseYear: string | null;
}

async function main() {
  const rows = await fetchAllRatingJoins();

  const artistAgg = new Map<string, ArtistAgg>();
  const albumCounts = new Map<string, { title: string; artist: string; genres: Set<string>; count: number; year: string | null; cover: string | null }>();

  for (const row of rows) {
    const rg = row.release_groups;
    if (!rg?.artist_display || !rg?.title) continue;
    const artistKey = rg.primary_artist_id ?? `name:${rg.artist_display}`;

    // Artist aggregation
    let a = artistAgg.get(artistKey);
    if (!a) {
      a = { artistId: rg.primary_artist_id, name: rg.artist_display, ratingCount: 0, genres: new Set(), topAlbum: { title: rg.title, count: 0 } };
      artistAgg.set(artistKey, a);
    }
    a.ratingCount++;
    for (const g of rg.genres ?? []) a.genres.add(g);

    // Album aggregation
    const albumKey = `${rg.title}::${rg.artist_display}`;
    let al = albumCounts.get(albumKey);
    if (!al) {
      al = { title: rg.title, artist: rg.artist_display, genres: new Set(rg.genres ?? []), count: 0, year: rg.first_release_date?.slice(0, 4) ?? null, cover: rg.cover_url ?? null };
      albumCounts.set(albumKey, al);
    }
    al.count++;
  }

  // Track each artist's single most-rated album (used as a per-artist detail
  // and, since the catalog has no real "artist photo" for most artists, as
  // the artist card's real cover image too).
  const perArtistTopAlbum = new Map<string, { title: string; count: number; cover: string | null }>();
  for (const row of rows) {
    const rg = row.release_groups;
    if (!rg?.artist_display || !rg?.title) continue;
    const artistKey = rg.primary_artist_id ?? `name:${rg.artist_display}`;
    const current = perArtistTopAlbum.get(artistKey);
    // recompute from albumCounts since we already have per-album totals
    const albumKey = `${rg.title}::${rg.artist_display}`;
    const agg = albumCounts.get(albumKey)!;
    if (!current || agg.count > current.count) perArtistTopAlbum.set(artistKey, { title: rg.title, count: agg.count, cover: agg.cover });
  }

  const artistIds = [...artistAgg.values()].map((a) => a.artistId).filter((x): x is string => !!x);
  const countryById = new Map<string, string>();
  const CHUNK = 200;
  for (let i = 0; i < artistIds.length; i += CHUNK) {
    const chunk = artistIds.slice(i, i + CHUNK);
    const { data, error } = await db.from('artists').select('id, country').in('id', chunk);
    if (error) {
      console.error('artists query error:', error.message);
      continue;
    }
    for (const r of data ?? []) if (r.country) countryById.set(r.id, r.country);
  }

  const artistCandidates = [...artistAgg.entries()]
    .map(([key, a]) => ({
      refKey: `artist:${key}`,
      type: 'artist' as const,
      name: a.name,
      genres: [...a.genres].slice(0, 6),
      country: a.artistId ? countryById.get(a.artistId) ?? null : null,
      ratingCount: a.ratingCount,
      topAlbum: perArtistTopAlbum.get(key)?.title ?? null,
      cover: perArtistTopAlbum.get(key)?.cover ?? null,
    }))
    .sort((a, b) => b.ratingCount - a.ratingCount)
    .slice(0, N_ARTISTS);

  const albumCandidates = [...albumCounts.entries()]
    .map(([refKey, al]) => ({
      refKey: `album:${refKey}`,
      type: 'album' as const,
      name: `${al.title} — ${al.artist}`,
      title: al.title,
      artist: al.artist,
      genres: [...al.genres].slice(0, 6),
      ratingCount: al.count,
      releaseYear: al.year,
      cover: al.cover,
    }))
    .sort((a, b) => b.ratingCount - a.ratingCount)
    .slice(0, N_ALBUMS);

  const combined = [...artistCandidates, ...albumCandidates];
  // Deterministic shuffle (fixed seed) so re-running this script to pick up
  // new fields (like adding cover art) doesn't scramble item order/ids out
  // from under labels already collected against the previous run.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20260911);
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  // db document ids must match [A-Za-z0-9_.~:@+-]+ — real names/titles have
  // spaces, punctuation, and non-Latin scripts, so use a safe sequential id
  // as the doc key and keep the real identity in the body as `refKey`.
  const pool = combined.map((item, i) => ({ id: `item-${String(i).padStart(3, '0')}`, ...item }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(pool, null, 2));
  console.log(`${artistCandidates.length} artists + ${albumCandidates.length} albums = ${pool.length} real candidates`);
  console.log(`${artistIds.length} artists had a resolvable country lookup; ${countryById.size} had a real country value`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
