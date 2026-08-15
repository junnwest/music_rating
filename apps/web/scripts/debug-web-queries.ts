// One-off debug: run the rebuilt web app's client-side queries with the ANON
// key (exactly what the browser uses) to see which fail/return empty.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key =
  process.argv.includes('--service') && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
console.log(`role: ${process.argv.includes('--service') ? 'service' : 'anon'}`);
const supabase = createClient(url, key, { auth: { persistSession: false } });

const FEED_SELECT =
  `id, user_id, score, review_text, created_at, ` +
  `release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), ` +
  `profiles!ratings_user_id_fkey(username, display_name)`;

async function main() {
  const checks: [string, () => PromiseLike<{ data: unknown; error: unknown }>][] = [
    ['ratings bare (order created_at limit 3)', () => supabase.from('ratings').select('id, user_id, score, created_at').order('created_at', { ascending: false }).limit(3)],
    ['ratings count', () => supabase.from('ratings').select('*', { count: 'exact', head: true })],
    ['ratings + rg embed only', () => supabase.from('ratings').select('id, created_at, release_groups(id, title)').order('created_at', { ascending: false }).limit(3)],
    ['ratings + profiles embed only', () => supabase.from('ratings').select('id, created_at, profiles!ratings_user_id_fkey(username)').order('created_at', { ascending: false }).limit(3)],
    ['release_tracks by recording (indexed)', () => supabase.from('release_tracks').select('release_id, position').eq('recording_id', '00000000-0000-0000-0000-000000000000').limit(1)],
    ['feed (ratings FEED_SELECT)', () => supabase.from('ratings').select(FEED_SELECT).order('created_at', { ascending: false }).limit(3)],
    ['release_groups plain', () => supabase.from('release_groups').select('id, title, artist_display, cover_url').limit(2)],
    ['get_charts_trending', () => supabase.rpc('get_charts_trending', { p_limit: 3 })],
    ['get_charts_most_rated', () => supabase.rpc('get_charts_most_rated', { p_limit: 3 })],
    ['get_rankings_unlock_status', () => supabase.rpc('get_rankings_unlock_status')],
    ['get_charts_pulse', () => supabase.rpc('get_charts_pulse')],
    ['get_silla_leaderboard', () => supabase.rpc('get_silla_leaderboard', { p_genre: null, p_country: null, p_limit: 3, p_offset: 0 })],
    ['search_release_groups', () => supabase.rpc('search_release_groups', { q: 'newjeans', lim: 3 })],
    ['search_artists', () => supabase.rpc('search_artists', { q: 'newjeans', lim: 3 })],
    // Search page also does this raw ilike over ~2.3M recordings (search/page.tsx)
    ['recordings ilike (search page songs)', () => supabase.from('recordings').select('id, title, artist_display').ilike('title', '%newjeans%').limit(3)],
  ];

  for (const [name, fn] of checks) {
    try {
      const started = Date.now();
      const { data, error } = await fn();
      const ms = Date.now() - started;
      const rows = Array.isArray(data) ? data.length : data != null ? 1 : 0;
      console.log(
        `${name}: ${error ? `ERROR ${JSON.stringify(error)}` : `ok, ${rows} rows`} (${ms}ms)`,
      );
      if (!error && rows > 0 && name.startsWith('feed')) {
        console.log('  sample:', JSON.stringify((data as unknown[])[0]).slice(0, 400));
      }
      if (!error && rows > 0 && name === 'release_groups plain') {
        console.log('  sample:', JSON.stringify((data as unknown[])[0]).slice(0, 300));
      }
    } catch (e) {
      console.log(`${name}: THREW ${e}`);
    }
  }
}

main();
