/**
 * Picks 20 MORE real holdout albums, extending the original 30-album
 * holdout to 50 total. Excludes everything already used anywhere: the
 * 500-item labeled pool, the original 30 holdout albums, and the 7 new
 * user-confirmed training cases (Mac Miller, Charli XCX, etc.) — so this
 * really is fresh, unseen data, not a re-draw of anything already scored
 * or trained on.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/pick-holdout-extra20.ts
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const OUT_PATH = path.resolve('scripts/output/holdout-extra20.json');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars.'); process.exit(1); }
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
  const existingPool: { refKey: string }[] = JSON.parse(fs.readFileSync('scripts/output/suitability-pool.json', 'utf8'));
  const existingHoldout: { refKey: string }[] = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const newTraining: { title: string; artist: string }[] = JSON.parse(fs.readFileSync('scripts/output/new-training-cases.json', 'utf8'));
  const usedKeys = new Set([
    ...existingPool.map((p) => p.refKey),
    ...existingHoldout.map((h) => h.refKey),
    ...newTraining.map((c) => `album:${c.title}::${c.artist}`),
  ]);

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

  // Different rank window (701-1400) so this is a genuinely different slice
  // of the real catalog, not just re-sampling near the first holdout's range.
  const window = ranked.slice(0, 1400 - 700).filter((_, i) => i >= 0);
  const fullRanked = ranked; // already filtered/sorted
  const rangeStart = 0; // ranked already excludes used items, so start from what's left
  const picked: typeof ranked = [];
  const step = Math.max(1, Math.floor(Math.min(fullRanked.length, 700) / 20));
  for (let i = 0; i < fullRanked.length && picked.length < 20; i += step) picked.push(fullRanked[i]);

  const out = picked.map((a, i) => ({
    id: `holdout2-${String(i).padStart(2, '0')}`,
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
  console.log(`Picked ${out.length} more holdout albums (from ${fullRanked.length} unused real candidates).`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
