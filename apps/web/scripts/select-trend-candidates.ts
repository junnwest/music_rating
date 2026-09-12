/**
 * Stage 1 of the trend-post pipeline: pick candidate subjects for the
 * Wikipedia pageview-spike format, ranked by real rating engagement.
 * Supports three subject types — --type=artist (default), album, genre.
 * (--type=song is not currently possible: the catalog's `tracks` table
 * exists but is empty and there's no `songs` table, so there's no real
 * song-level engagement data to rank by yet.)
 *
 * Output feeds resolve-wikipedia-subject.ts. Writes
 * scripts/output/trend-candidates.json, each entry tagged with its type.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/select-trend-candidates.ts --type=artist
 *   npx tsx --env-file=.env.local scripts/select-trend-candidates.ts --type=album --limit=30
 *   npx tsx --env-file=.env.local scripts/select-trend-candidates.ts --type=genre
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const TYPE = (process.argv.find((a) => a.startsWith('--type='))?.split('=')[1] ?? 'artist') as 'artist' | 'album' | 'genre';
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 20);
const OUT_PATH = path.resolve('scripts/output/trend-candidates.json');
const EXCLUSIONS_PATH = path.resolve('scripts/data/mainstream-idol-groups.json');

// Brand-fit filter: the catalog has no reliable automatic signal for "mainstream
// idol group" (checked live — the genres column tags Crush/Heize/Dynamic Duo as
// k-pop right alongside BIGBANG/TWICE, and prestige_score, the field the app's
// design intends for exactly this, is unpopulated for every artist). So this is
// a maintained list, not a heuristic — see the file's own comment for scope.
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function loadExclusions(): Set<string> {
  if (!fs.existsSync(EXCLUSIONS_PATH)) return new Set();
  const { groups } = JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, 'utf8'));
  return new Set((groups as string[]).map(norm));
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Add to .env.local.');
  process.exit(1);
}
const db = createClient(url, key);

interface Candidate {
  type: 'artist' | 'album' | 'genre';
  name: string; // artist name, "Album Title — Artist" for albums, or genre tag
  ratingCount: number;
}

async function fetchAllRatingJoins() {
  const pageSize = 1000;
  let from = 0;
  const rows: { release_groups: { artist_display: string | null; title: string | null; genres: string[] | null } | null }[] = [];
  for (;;) {
    const { data, error } = await db
      .from('ratings')
      .select('release_groups(artist_display, title, genres)')
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

async function main() {
  const rows = await fetchAllRatingJoins();
  const counts = new Map<string, number>();
  const excluded = loadExclusions();
  let excludedCount = 0;

  const isExcludedArtist = (artist: string) => excluded.has(norm(artist));

  if (TYPE === 'artist') {
    for (const row of rows) {
      const name = row.release_groups?.artist_display;
      if (!name) continue;
      if (isExcludedArtist(name)) {
        excludedCount++;
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  } else if (TYPE === 'album') {
    for (const row of rows) {
      const title = row.release_groups?.title;
      const artist = row.release_groups?.artist_display;
      if (!title || !artist) continue;
      if (isExcludedArtist(artist)) {
        excludedCount++;
        continue;
      }
      const key = `${title} — ${artist}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  } else if (TYPE === 'genre') {
    // Genre-level posts (e.g. "K-pop" as a category) are a different, legitimate
    // thing from an idol-group artist/album spotlight, so no exclusion here.
    for (const row of rows) {
      const genres = row.release_groups?.genres;
      if (!genres) continue;
      for (const g of genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }

  const candidates: Candidate[] = [...counts.entries()]
    .map(([name, ratingCount]) => ({ type: TYPE, name, ratingCount }))
    .sort((a, b) => b.ratingCount - a.ratingCount)
    .slice(0, LIMIT);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(candidates, null, 2));

  console.log(`Top ${candidates.length} ${TYPE}s by real rating engagement:\n`);
  for (const c of candidates) console.log(`  ${String(c.ratingCount).padStart(5)}  ${c.name}`);
  if (excludedCount > 0) {
    console.log(`\n(${excludedCount} rating(s) on mainstream idol-group ${TYPE === 'album' ? 'albums' : 'artists'} excluded per scripts/data/mainstream-idol-groups.json)`);
  }
  console.log(`\nWrote ${OUT_PATH}`);
}

main();
