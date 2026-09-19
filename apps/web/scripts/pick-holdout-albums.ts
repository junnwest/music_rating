/**
 * Picks 30 real albums from the Sillajuku catalog that were NOT part of the
 * original 500-item suitability-labeling pool, for a visual holdout test of
 * the trained model. Spread across rank 201-700 by real rating engagement
 * (skips the top 200 already used, avoids the very long tail with near-zero
 * signal) — same real ratings-join query as build-suitability-pool.ts, no
 * idol-group pre-filter, since testing whether the model itself excludes
 * unsuitable candidates is the point.
 *
 * Output: scripts/output/holdout-albums.json
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/pick-holdout-albums.ts
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const OUT_PATH = path.resolve('scripts/output/holdout-albums.json');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const db = createClient(url, key);

async function fetchAllRatingJoins() {
  const pageSize = 1000;
  let from = 0;
  const rows: any[] = [];
  for (;;) {
    const { data, error } = await db
      .from('ratings')
      .select('release_groups(title, artist_display, genres, first_release_date, cover_url)')
      .range(from, from + pageSize - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  const poolPath = path.resolve('scripts/output/suitability-pool.json');
  const existingPool: { refKey: string }[] = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
  const usedKeys = new Set(existingPool.map((p) => p.refKey));

  const rows = await fetchAllRatingJoins();
  const albumCounts = new Map<string, { title: string; artist: string; genres: Set<string>; count: number; year: string | null; cover: string | null }>();
  for (const row of rows) {
    const rg = row.release_groups;
    if (!rg?.artist_display || !rg?.title) continue;
    const key = `album:${rg.title}::${rg.artist_display}`;
    let al = albumCounts.get(key);
    if (!al) {
      al = { title: rg.title, artist: rg.artist_display, genres: new Set(rg.genres ?? []), count: 0, year: rg.first_release_date?.slice(0, 4) ?? null, cover: rg.cover_url ?? null };
      albumCounts.set(key, al);
    }
    al.count++;
  }

  const ranked = [...albumCounts.entries()]
    .map(([refKey, al]) => ({ refKey, ...al, genres: [...al.genres] }))
    .sort((a, b) => b.count - a.count)
    .filter((a) => !usedKeys.has(a.refKey));

  // Spread across rank 201-700 of the full (unused) ranking, evenly sampled.
  const window = ranked.slice(0, 700);
  const step = Math.max(1, Math.floor(window.length / 30));
  const picked: typeof window = [];
  for (let i = 0; i < window.length && picked.length < 30; i += step) picked.push(window[i]);

  const out = picked.map((a, i) => ({
    id: `holdout-${String(i).padStart(2, '0')}`,
    refKey: a.refKey,
    type: 'album' as const,
    name: `${a.title} — ${a.artist}`,
    title: a.title,
    artist: a.artist,
    genres: a.genres.slice(0, 6),
    ratingCount: a.count,
    releaseYear: a.year,
    coverUrl: a.cover,
    country: null as string | null,
  }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Picked ${out.length} holdout albums (from ${window.length} unused candidates in rank window).`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
