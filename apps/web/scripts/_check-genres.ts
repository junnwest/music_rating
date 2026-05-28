import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { count: total } = await db.from('releases').select('*', { count: 'exact', head: true });
  const { count: withGenre } = await db.from('releases').select('*', { count: 'exact', head: true }).not('genres', 'is', null).neq('genres', '');
  const { count: noGenre } = await db.from('releases').select('*', { count: 'exact', head: true }).or('genres.is.null,genres.eq.');
  const { count: itunesCount } = await db.from('releases').select('*', { count: 'exact', head: true }).eq('canonical_source', 'itunes');
  const { count: itunesGenre } = await db.from('releases').select('*', { count: 'exact', head: true }).eq('canonical_source', 'itunes').not('genres', 'is', null).neq('genres', '');
  const { count: spotifyCount } = await db.from('releases').select('*', { count: 'exact', head: true }).is('canonical_source', null);
  const { count: spotifyGenre } = await db.from('releases').select('*', { count: 'exact', head: true }).is('canonical_source', null).not('genres', 'is', null).neq('genres', '');

  console.log('─── Release counts ───────────────────────────');
  console.log(`Total:              ${total}`);
  console.log(`With genre:         ${withGenre} (${Math.round((withGenre??0)/(total??1)*100)}%)`);
  console.log(`Without genre:      ${noGenre} (${Math.round((noGenre??0)/(total??1)*100)}%)`);
  console.log('');
  console.log('─── By source ────────────────────────────────');
  console.log(`Spotify-sourced:    ${spotifyCount} total, ${spotifyGenre} with genre (${Math.round((spotifyGenre??0)/(spotifyCount??1)*100)}%)`);
  console.log(`iTunes-sourced:     ${itunesCount} total, ${itunesGenre} with genre (${Math.round((itunesGenre??0)/(itunesCount??1)*100)}%)`);
}

main().catch(console.error);
