/**
 * Inserts missing artists directly into artist_ingestion_queue as pending.
 * Used to recover artists whose releases were accidentally deleted and who
 * have no existing queue entries (original Spotify-sourced artists).
 */

import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const MISSING = [
  { name: 'KozyPop' },
  { name: 'Lee Seung Hwan' },
  { name: 'Moon Hee Jun' },
];

async function main() {
  for (const artist of MISSING) {
    const { error } = await db.from('artist_ingestion_queue').insert({
      name:   artist.name,
      source: 'manual_recovery',
      status: 'pending',
    });
    if (error) console.log(`  ✗ ${artist.name}: ${error.message}`);
    else console.log(`  ✓ inserted: ${artist.name}`);
  }
  console.log('\nRun: npm run queue:ingest\n');
}

main().catch(err => { console.error(err); process.exit(1); });
