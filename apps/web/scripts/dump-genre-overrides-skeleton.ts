/**
 * Builds scripts/genre-overrides.json — a skeleton list of every high-value
 * release that is missing genres, ready to be hand-filled.
 *
 * High-value definition: prestige in (1, 2) OR in curated_releases OR has any
 * rating in the ratings table.
 *
 * Also prints a sample of the existing genre vocabulary so the hand-filled
 * values match what's already in the DB.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/dump-genre-overrides-skeleton.ts
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
const OUT_PATH = join(__dirname, 'genre-overrides.json');

async function inChunks<T>(table: string, col: string, ids: string[], selectCols: string): Promise<T[]> {
  const out: T[] = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await db.from(table).select(selectCols).in(col, ids.slice(i, i + CHUNK));
    if (data) out.push(...(data as T[]));
  }
  return out;
}

async function fetchAllMissing(): Promise<Array<{ id: string; title: string; artist: string; artist_id: string | null; release_date: string | null; release_type: string | null; prestige: number | null }>> {
  const PAGE = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist, artist_id, release_date, release_type, prestige')
      .or('genres.is.null,genres.eq.')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function main() {
  console.log('\n🎵  Building genre-overrides skeleton\n');

  // ── Sample the existing genre vocabulary ──────────────────────────────────
  console.log('Sampling existing genre vocabulary from populated rows…\n');
  const vocabBuckets = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; from < 6000; from += PAGE) {
    const { data, error } = await db
      .from('releases')
      .select('genres')
      .not('genres', 'is', null)
      .neq('genres', '')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      for (const g of (r.genres ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)) {
        vocabBuckets.set(g, (vocabBuckets.get(g) ?? 0) + 1);
      }
    }
    if (data.length < PAGE) break;
  }
  const topVocab = [...vocabBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  console.log('Top 50 genre tags currently in the DB:');
  for (const [tag, n] of topVocab) {
    console.log(`  ${String(n).padStart(5)}  ${tag}`);
  }
  console.log('');

  // ── Pull all genre-less rows ──────────────────────────────────────────────
  console.log('Fetching all genre-less rows…');
  const missing = await fetchAllMissing();
  console.log(`  ${missing.length} rows fetched\n`);

  // ── Classify which are "high-value" ───────────────────────────────────────
  const missingIds = missing.map(r => r.id);

  type CuratedRow = { release_id: string; category: string };
  const curatedHits = await inChunks<CuratedRow>('curated_releases', 'release_id', missingIds, 'release_id, category');
  const curatedMap = new Map<string, string[]>();
  for (const h of curatedHits) {
    const list = curatedMap.get(h.release_id) ?? [];
    list.push(h.category);
    curatedMap.set(h.release_id, list);
  }

  type RatedRow = { release_id: string };
  const ratedHits = await inChunks<RatedRow>('ratings', 'release_id', missingIds, 'release_id');
  const ratedSet = new Set(ratedHits.map(r => r.release_id));

  const highValue = missing.filter(r =>
    r.prestige === 1 || r.prestige === 2 ||
    curatedMap.has(r.id) ||
    ratedSet.has(r.id)
  );

  console.log(`High-value candidates: ${highValue.length}`);
  console.log(`  tier 1:           ${highValue.filter(r => r.prestige === 1).length}`);
  console.log(`  tier 2:           ${highValue.filter(r => r.prestige === 2).length}`);
  console.log(`  in curated:       ${highValue.filter(r => curatedMap.has(r.id)).length}`);
  console.log(`  has user rating:  ${highValue.filter(r => ratedSet.has(r.id)).length}\n`);

  // ── Merge with existing file if present (preserves hand-filled genres) ───
  let existing: Array<{ id: string; genres: string }> = [];
  if (existsSync(OUT_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
      if (Array.isArray(parsed?.releases)) existing = parsed.releases;
      console.log(`Found existing ${OUT_PATH} — preserving ${existing.filter(e => e.genres?.trim()).length} hand-filled entries\n`);
    } catch {
      console.log(`Existing ${OUT_PATH} unparseable — overwriting.\n`);
    }
  }
  const existingMap = new Map(existing.map(e => [e.id, e.genres ?? '']));

  // ── Build output ─────────────────────────────────────────────────────────
  const sources = (r: typeof highValue[number]) => {
    const tags: string[] = [];
    if (r.prestige === 1) tags.push('tier1');
    else if (r.prestige === 2) tags.push('tier2');
    if (curatedMap.has(r.id)) tags.push(`curated(${curatedMap.get(r.id)!.join('|')})`);
    if (ratedSet.has(r.id)) tags.push('rated');
    return tags;
  };

  // Sort: tier1 first, then tier2, then curated, then rated; within each by artist
  const rank = (r: typeof highValue[number]) =>
    r.prestige === 1 ? 0
    : r.prestige === 2 ? 1
    : curatedMap.has(r.id) ? 2
    : 3;
  highValue.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.artist ?? '').localeCompare(b.artist ?? '');
  });

  const releases = highValue.map(r => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    release_date: r.release_date,
    release_type: r.release_type,
    sources: sources(r),
    genres: existingMap.get(r.id) ?? '',
  }));

  const out = {
    _comment: 'Hand-curated genre overrides for high-value releases missing genres. Edit the "genres" field as comma-separated tags (use existing DB vocabulary printed by this script). Then run: npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts',
    generated_at: new Date().toISOString(),
    count: releases.length,
    releases,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✅ Wrote ${OUT_PATH}`);
  console.log(`   ${releases.length} releases, ${releases.filter(r => !r.genres.trim()).length} still need genres\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
