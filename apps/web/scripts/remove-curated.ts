/**
 * One-off: remove a specific row from curated_releases by release_id.
 *
 * Usage: npx tsx --env-file=.env.local scripts/remove-curated.ts <release_id>
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const releaseId = process.argv[2];
if (!releaseId) { console.error('Usage: remove-curated.ts <release_id>'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: existing } = await db
    .from('curated_releases')
    .select('release_id, category, title, artist')
    .eq('release_id', releaseId);

  if (!existing || existing.length === 0) {
    console.log(`No curated_releases rows found for release_id=${releaseId}`);
    return;
  }

  console.log(`Found ${existing.length} curated row(s):`);
  for (const r of existing) console.log(`  - [${r.category}] ${r.title} — ${r.artist}`);

  const { error } = await db.from('curated_releases').delete().eq('release_id', releaseId);
  if (error) { console.error('Delete failed:', error.message); process.exit(1); }
  console.log(`\nDeleted ${existing.length} row(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
