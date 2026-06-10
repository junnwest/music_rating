import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const terms = process.argv.slice(2);
  if (!terms.length) { console.log('Usage: check-release.ts "search term"'); return; }

  for (const term of terms) {
    const { data } = await db
      .from('releases')
      .select('id, title, artist, release_type, release_date, total_tracks, itunes_id, spotify_id')
      .ilike('title', `%${term}%`)
      .order('release_date')
      .limit(10);

    console.log(`\n  Search: "${term}" → ${data?.length ?? 0} result(s)`);
    for (const r of data ?? []) {
      console.log(`    "${r.title}" — ${r.artist}`);
      console.log(`    id=${r.id}  type=${r.release_type}  date=${r.release_date}  tracks=${r.total_tracks}`);
      console.log(`    spotify=${r.spotify_id ?? 'null'}  itunes=${r.itunes_id ?? 'null'}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
