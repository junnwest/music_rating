/**
 * Recompute release_groups.prestige_score from external_scores.
 *
 * Run after:
 *   • seeding a new prestige source (seeder calls this automatically)
 *   • pipeline ingests a batch of artists that may now resolve pending entries
 *
 * npm run prestige:reconcile
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }

  // reconcile is batched (each call updates ≤batch_limit changed rows) so it stays under the API
  // gateway timeout regardless of how big the delta is. Loop until a call updates nothing.
  console.log('Running reconcile_prestige_scores() in batches…');
  let total = 0, pending = 0, batch = 0, calls = 0;
  do {
    const { data, error } = await supabase.rpc('reconcile_prestige_scores', { batch_limit: 300 });
    if (error) throw new Error(`reconcile failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    batch = row?.updated ?? 0;
    pending = row?.pending ?? 0;
    total += batch;
    calls++;
    if (batch) process.stdout.write(`\r  updated ${total} (batch ${batch}, ${calls} calls)   `);
  } while (batch > 0);

  console.log(`\nDone — updated ${total} release_groups in ${calls} call(s), ${pending} external entries still un-MBID'd.`);
  if (pending > 0) console.log(`  (${pending} scored albums have no MBID / their artists aren't ingested yet.)`);
}

main().catch(err => { console.error(err); process.exit(1); });
