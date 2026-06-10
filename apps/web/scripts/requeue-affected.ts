/**
 * Re-queues artists whose releases were accidentally deleted by the buggy
 * dedup:releases:fix run on 2026-06-03 (pagination without ORDER BY caused
 * self-matches; mergeAndDelete deleted the actual release).
 *
 * 93 releases deleted across groups 1-93. All had user=0 score.
 * Affected artists re-queued here so queue:ingest re-inserts them.
 *
 * Run: npx tsx --env-file=.env.local scripts/requeue-affected.ts
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }
const db = createClient(url, key);

const AFFECTED = [
  'KozyPop', 'SECHSKIES', 'SF9', 'Saturday', 'SHINHWA',
  'Lee Seung Hwan', 'Na Hoon-A', 'Eminem', 'Moon Hee Jun',
  'Sobangcha', 'SE SO NEON', 'Kingcrow', 'Lay Bankz',
  'SHOWNU X HYUNGWON (MONSTA X)', 'José Capmany', 'El Parque',
];

async function main() {
  let reset = 0;
  for (const name of AFFECTED) {
    const { data } = await db
      .from('artist_ingestion_queue')
      .select('id, name, status')
      .ilike('name', name)
      .limit(5);

    for (const row of data ?? []) {
      await db.from('artist_ingestion_queue')
        .update({ status: 'pending', processed_at: null, error: null })
        .eq('id', row.id);
      console.log(`  re-queued [${row.status}→pending] ${row.name}`);
      reset++;
    }
  }

  console.log(`\nTotal re-queued: ${reset}`);
  console.log('Now run: npm run queue:ingest\n');
}

main().catch(err => { console.error(err); process.exit(1); });
