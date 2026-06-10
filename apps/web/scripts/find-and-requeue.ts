import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const search = ['KozyPop', 'Lee Seung Hwan', 'Moon Hee Jun'];

  for (const name of search) {
    const { data } = await db
      .from('artist_ingestion_queue')
      .select('id, name, status')
      .ilike('name', `%${name}%`)
      .limit(5);

    if (data?.length) {
      for (const r of data) {
        console.log(`  [${r.status}] ${r.name}`);
        await db.from('artist_ingestion_queue')
          .update({ status: 'pending', processed_at: null, error: null })
          .eq('id', r.id);
        console.log(`    → reset to pending`);
      }
    } else {
      console.log(`  not found in queue: ${name}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
