/**
 * Diagnostic: for each homepage category, counts how many recommendable
 * releases match the genre filters, broken down by:
 *   - rows that match by genre (queryable today)
 *   - rows whose artist appears in matching rows but lack their own genre
 *     (would match after backfill:genres)
 *
 * Use this to understand whether a sparse category is a backfill problem
 * or a "DB doesn't have these albums" problem.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

const CATEGORIES = [
  { key: 'k-pop',         filters: ['k-pop', 'korean pop'] },
  { key: 'korean-indie',  filters: ['k-indie', 'korean indie', 'korean folk', 'korean ballad'] },
  { key: 'korean-rb',     filters: ['k-r&b', 'korean r&b'] },
  { key: 'indie-global',  filters: ['indie rock', 'indie pop', 'dream pop', 'shoegaze', 'bedroom pop'] },
  { key: 'hip-hop',       filters: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'k-rap'] },
];

async function main() {
  console.log('\n--- category coverage in recommendable_releases ---\n');

  for (const cat of CATEGORIES) {
    const orClause = cat.filters.map(f => `genres.ilike.%${f}%`).join(',');
    const { count } = await db
      .from('recommendable_releases')
      .select('id', { count: 'exact', head: true })
      .or(orClause);

    const status = (count ?? 0) >= 6 ? '✅' : '⚠ ';
    console.log(`  ${status} ${cat.key.padEnd(15)} ${count ?? 0} matching rows  (filters: ${cat.filters.join(', ')})`);
  }

  console.log('\n--- searching releases.artist for hip-hop / rap names ---\n');

  // For categories with low matches, check if the albums are in the DB at all,
  // just not tagged. We do a coarse search for well-known hip-hop artist names.
  const HIPHOP_TEST_ARTISTS = ['Kendrick Lamar', 'Nas', 'Kanye West', 'J. Cole', 'Eminem', 'Drake', 'Outkast', 'Wu-Tang Clan'];

  for (const artist of HIPHOP_TEST_ARTISTS) {
    const { count } = await db
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .ilike('artist', `%${artist}%`);

    const status = (count ?? 0) > 0 ? '✅' : '❌';
    console.log(`  ${status} ${artist.padEnd(25)} ${count ?? 0} releases in DB`);
  }

  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
