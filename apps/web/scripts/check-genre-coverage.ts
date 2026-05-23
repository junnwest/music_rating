/**
 * Characterizes the releases rows that are missing genres.
 *
 * Goal: decide whether the genre-less rows are high-value (curated / RS500 /
 * rated / prestige) or low-value Phase 2 deep cuts. Also reports how many
 * have a local artists.genres row we could JOIN-backfill from without
 * calling Spotify.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/check-genre-coverage.ts
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

function pct(n: number, d: number) {
  return d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`;
}

async function main() {
  console.log('\n🎵  Genre coverage characterization\n');

  // Total + missing
  const { count: total } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true });

  const { count: missing } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .or('genres.is.null,genres.eq.');

  console.log(`Total releases:       ${total}`);
  console.log(`Missing genres:       ${missing}  (${pct(missing ?? 0, total ?? 1)})\n`);

  // ── Pull the full set of genre-less rows so we can slice them locally ───
  // Supabase has an implicit 1000-row cap per request; paginate explicitly.
  const PAGE = 1000;
  const missingRows: Array<{ id: string; artist: string; title: string; artist_id: string | null; prestige: number | null; release_date: string | null; release_type: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('releases')
      .select('id, artist, title, artist_id, prestige, release_date, release_type')
      .or('genres.is.null,genres.eq.')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('Fetch failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    missingRows.push(...data);
    if (data.length < PAGE) break;
  }
  if (missingRows.length === 0) { console.log('Nothing missing.'); return; }
  console.log(`Fetched ${missingRows.length} genre-less rows (paginated)\n`);

  // ── Prestige distribution ────────────────────────────────────────────────
  const prestigeBuckets = new Map<string, number>();
  for (const r of missingRows) {
    const k = r.prestige == null ? 'unscored' : `tier ${r.prestige}`;
    prestigeBuckets.set(k, (prestigeBuckets.get(k) ?? 0) + 1);
  }
  console.log('Prestige distribution (genre-less rows):');
  const order = ['tier 1', 'tier 2', 'tier 3', 'unscored'];
  for (const k of order) {
    const n = prestigeBuckets.get(k) ?? 0;
    const note = k === 'tier 1' ? ' — undisputed classics'
      : k === 'tier 2' ? ' — critically acclaimed'
      : k === 'tier 3' ? ' — notable'
      : '';
    console.log(`  ${k.padEnd(10)} ${String(n).padStart(5)}  (${pct(n, missingRows.length)})${note}`);
  }
  console.log('');

  // ── Release-type distribution ────────────────────────────────────────────
  const typeBuckets = new Map<string, number>();
  for (const r of missingRows) {
    const k = r.release_type ?? '<null>';
    typeBuckets.set(k, (typeBuckets.get(k) ?? 0) + 1);
  }
  console.log('Release type distribution:');
  for (const [k, n] of [...typeBuckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${String(n).padStart(5)}  (${pct(n, missingRows.length)})`);
  }
  console.log('');

  // ── Helper: chunked .in() query (URL length safety) ──────────────────────
  async function inChunks(table: string, col: string, ids: string[], selectCols: string): Promise<any[]> {
    const out: any[] = [];
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data } = await db.from(table).select(selectCols).in(col, ids.slice(i, i + CHUNK));
      if (data) out.push(...data);
    }
    return out;
  }

  const missingIds = missingRows.map(r => r.id);

  // ── Curated_releases overlap ─────────────────────────────────────────────
  const curatedHits = await inChunks('curated_releases', 'release_id', missingIds, 'release_id, category');
  const curatedSet = new Set(curatedHits.map(c => c.release_id));
  console.log(`In curated_releases:     ${curatedSet.size}  (${pct(curatedSet.size, missingRows.length)}) — homepage picks missing genres`);

  // ── Ranking seed entries overlap ─────────────────────────────────────────
  const seedHits = await inChunks('ranking_seed_entries', 'release_id', missingIds, 'release_id, category');
  const seedSet = new Set(seedHits.map(s => s.release_id));
  console.log(`In ranking_seed_entries: ${seedSet.size}  (${pct(seedSet.size, missingRows.length)}) — RS500 / curated rank seeds missing genres`);

  // ── Ratings overlap (any real user rating) ───────────────────────────────
  const ratedHits = await inChunks('ratings', 'release_id', missingIds, 'release_id');
  const ratedSet = new Set(ratedHits.map(r => r.release_id));
  console.log(`Has user ratings:        ${ratedSet.size}  (${pct(ratedSet.size, missingRows.length)}) — already rated by real users\n`);

  // ── Decade distribution ──────────────────────────────────────────────────
  const decadeBuckets = new Map<string, number>();
  for (const r of missingRows) {
    const year = (r.release_date ?? '').slice(0, 4);
    const y = parseInt(year, 10);
    if (!Number.isFinite(y)) { decadeBuckets.set('unknown', (decadeBuckets.get('unknown') ?? 0) + 1); continue; }
    const decade = `${Math.floor(y / 10) * 10}s`;
    decadeBuckets.set(decade, (decadeBuckets.get(decade) ?? 0) + 1);
  }
  console.log('Release decade distribution:');
  for (const [k, n] of [...decadeBuckets.entries()].sort()) {
    console.log(`  ${k.padEnd(10)} ${String(n).padStart(5)}  (${pct(n, missingRows.length)})`);
  }
  console.log('');

  // ── Free backfill path: how many can be filled from local artists table? ─
  const artistIds = [...new Set(missingRows.map(r => r.artist_id).filter(Boolean))] as string[];
  console.log(`Distinct artist_ids in missing rows: ${artistIds.length}`);

  if (artistIds.length > 0) {
    // Fetch in chunks of 100 to avoid URL length issues
    const artistGenres = new Map<string, string | null>();
    for (let i = 0; i < artistIds.length; i += 100) {
      const chunk = artistIds.slice(i, i + 100);
      const { data } = await db
        .from('artists')
        .select('id, genres')
        .in('id', chunk);
      for (const a of data ?? []) artistGenres.set(a.id, a.genres);
    }

    const inArtists = artistIds.filter(id => artistGenres.has(id));
    const withGenres = artistIds.filter(id => {
      const g = artistGenres.get(id);
      return g != null && g.trim() !== '';
    });

    console.log(`  In artists table:        ${inArtists.length}  (${pct(inArtists.length, artistIds.length)})`);
    console.log(`  With genres populated:   ${withGenres.length}  (${pct(withGenres.length, artistIds.length)}) ← FREE backfill candidates\n`);

    // How many releases would that cover?
    const withGenresSet = new Set(withGenres);
    const coveredReleases = missingRows.filter(r => r.artist_id && withGenresSet.has(r.artist_id));
    console.log(`  → Could backfill ${coveredReleases.length} of ${missingRows.length} missing releases from local artists.genres (${pct(coveredReleases.length, missingRows.length)})`);
    console.log(`     with ZERO Spotify calls.\n`);
  }

  // ── Sample of important genre-less rows ──────────────────────────────────
  const important = missingRows
    .filter(r => r.prestige === 1 || r.prestige === 2 || curatedSet.has(r.id) || seedSet.has(r.id) || ratedSet.has(r.id))
    .slice(0, 25);

  if (important.length > 0) {
    console.log(`Sample of ${important.length} important genre-less releases:`);
    for (const r of important) {
      const tags: string[] = [];
      if (r.prestige === 1) tags.push('★1');
      else if (r.prestige === 2) tags.push('★2');
      else if (r.prestige === 3) tags.push('★3');
      if (curatedSet.has(r.id)) tags.push('curated');
      if (seedSet.has(r.id)) tags.push('rs-seed');
      if (ratedSet.has(r.id)) tags.push('rated');
      console.log(`  [${tags.join(',').padEnd(28)}] ${r.title} — ${r.artist}`);
    }
  } else {
    console.log('No high-value genre-less releases found.');
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
