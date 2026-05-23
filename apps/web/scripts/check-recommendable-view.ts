/**
 * Verifies that the recommendable_releases view exists in Supabase and is
 * returning rows. Run after the migration has (or should have) been applied.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log('\nChecking recommendable_releases view…\n');

  const { data, error, count } = await db
    .from('recommendable_releases')
    .select('id, title, artist, release_type, genres, cover_url', { count: 'exact' })
    .limit(5);

  if (error) {
    console.error(`❌ View query failed:\n   ${error.message}\n`);
    if (error.message.includes('does not exist') || error.code === '42P01') {
      console.error('   → The migration 20260522000000_recommendable_releases_view.sql has NOT been applied.');
      console.error('   → Run from apps/web: supabase db push\n');
    }
    process.exit(1);
  }

  console.log(`✅ View exists and returned ${count ?? '?'} total rows`);

  if (!data || data.length === 0) {
    console.log('   ⚠  View has zero rows — releases table may be empty or all rows are filtered out.');
  } else {
    console.log(`\n   Sample of first ${data.length}:\n`);
    for (const r of data) {
      const hasGenres = r.genres && r.genres.length > 0;
      console.log(`     • ${r.title} — ${r.artist} [${r.release_type}] ${hasGenres ? `genres: ${r.genres}` : '⚠ no genres'}`);
    }
  }

  // ── Diagnostics on the underlying releases table ──────────────────────────
  console.log('\n--- diagnostics on releases table ---\n');

  // Total releases
  const { count: totalReleases } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true });
  console.log(`   Total releases:        ${totalReleases}`);

  // Releases with cover_url
  const { count: withCover } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .not('cover_url', 'is', null);
  console.log(`   With cover_url:        ${withCover}`);

  // Releases with release_type = 'Album' (capitalized, common in this codebase)
  const { count: capitalAlbum } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .eq('release_type', 'Album');
  console.log(`   release_type='Album':  ${capitalAlbum}`);

  // Releases with release_type = 'album' (lowercase, what the OLD view would match)
  const { count: lowerAlbum } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .eq('release_type', 'album');
  console.log(`   release_type='album':  ${lowerAlbum}`);

  // Releases with release_type ILIKE 'album' (case-insensitive)
  const { count: anyAlbum } = await db
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .ilike('release_type', 'album');
  console.log(`   release_type ILIKE 'album': ${anyAlbum}`);

  // Distinct release_type values
  const { data: distinctTypes } = await db
    .from('releases')
    .select('release_type')
    .limit(1000);
  if (distinctTypes) {
    const counts = new Map<string, number>();
    for (const r of distinctTypes) {
      const key = r.release_type ?? '<null>';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    console.log('\n   Distinct release_type values (from first 1000 rows):');
    for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${k.padEnd(15)} ${v}`);
    }
  }

  // ── Genre coverage in the view ────────────────────────────────────────────
  const { count: viewRowsTotal } = await db
    .from('recommendable_releases')
    .select('id', { count: 'exact', head: true });
  const { count: viewRowsNoGenres } = await db
    .from('recommendable_releases')
    .select('id', { count: 'exact', head: true })
    .or('genres.is.null,genres.eq.');

  if (viewRowsTotal != null && viewRowsNoGenres != null) {
    const withGenres = viewRowsTotal - viewRowsNoGenres;
    const pctCovered = viewRowsTotal > 0 ? Math.round((withGenres / viewRowsTotal) * 100) : 0;
    console.log('\n--- genre coverage in view ---\n');
    console.log(`   Rows in view:          ${viewRowsTotal}`);
    console.log(`   With genres:           ${withGenres} (${pctCovered}%)`);
    console.log(`   Missing genres:        ${viewRowsNoGenres} (${100 - pctCovered}%)`);
  }

  // ── Interpretation ────────────────────────────────────────────────────────
  console.log('\n--- interpretation ---\n');
  if ((count ?? 0) === 0 && (capitalAlbum ?? 0) > 0) {
    console.log('   ⚠  Releases exist but view returns 0 — migration with LOWER() not applied.');
    console.log('   → Run from apps/web: supabase db push\n');
  } else if ((count ?? 0) > 0 && (viewRowsNoGenres ?? 0) > (viewRowsTotal ?? 1) * 0.5) {
    console.log('   ⚠  View is populated but most rows are missing genres.');
    console.log('   → Run from apps/web: npm run backfill:genres\n');
  } else {
    console.log('   ✅  View is populated and genres look healthy.\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
