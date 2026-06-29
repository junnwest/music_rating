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

  console.log('Running reconcile_prestige_scores()…');
  const { data, error } = await supabase.rpc('reconcile_prestige_scores');
  if (error) throw new Error(`reconcile failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  console.log(`Done — updated=${row?.updated ?? '?'} pending=${row?.pending ?? '?'}`);
  if ((row?.pending ?? 0) > 0) {
    console.log(`${row.pending} entries still have no MBID (pipeline hasn't ingested those artists yet).`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
