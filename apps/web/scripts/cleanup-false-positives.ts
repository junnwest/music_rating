/**
 * One-time cleanup for false positives ingested in the 2026-05-07 session
 * via the appears_on bug (missing include_groups param).
 *
 * Targets albums where the listed artist is clearly not the target artist.
 * Prints what it will delete before deleting — pass --dry-run to preview only.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/cleanup-false-positives.ts
 *   npx tsx --env-file=.env.local scripts/cleanup-false-positives.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Artists that definitely don't belong — pulled in via appears_on
// substring patterns (safe — no overlap with Korean artist names)
const FALSE_POSITIVE_INCLUDES = [
  'Defected Radio',
  'Café del Mar',
  'Andy Daniell',
  'Gorgon City',
  'Kerri Chandler',
  'Future Disco',
  'Jimpster',
  'The Martinez Brothers',
  'Antropoceno',
];

// Exact matches only — these substrings appear in legitimate artist names
const FALSE_POSITIVE_EXACT = [
  'ANNA',   // DJ — but "JANNABI" contains "anna" so must exact-match
  'Endor',  // DJ — could be a substring of other names
];

async function main() {
  const db = getDB();

  console.log('\n🧹  Cleanup — false positives from 2026-05-07 session\n');
  if (DRY_RUN) console.log('   [DRY RUN — no deletes]\n');

  // Fetch all releases matching false-positive artist patterns
  const { data: all, error } = await db
    .from('releases')
    .select('id, title, artist');

  if (error) { console.error(error); process.exit(1); }

  const toDelete = (all ?? []).filter(r => {
    const a = r.artist ?? '';
    const aLower = a.toLowerCase();
    const includesMatch = FALSE_POSITIVE_INCLUDES.some(pat => aLower.includes(pat.toLowerCase()));
    const exactMatch = FALSE_POSITIVE_EXACT.some(pat => a === pat || a === pat.toUpperCase());
    return includesMatch || exactMatch;
  });

  if (toDelete.length === 0) {
    console.log('   Nothing to delete — no false positives found.');
    return;
  }

  console.log(`   Found ${toDelete.length} false positive(s):\n`);
  for (const r of toDelete) {
    console.log(`   - "${r.title}" — ${r.artist}`);
  }

  if (DRY_RUN) {
    console.log('\n   (dry run — skipping delete)\n');
    return;
  }

  const ids = toDelete.map(r => r.id);
  const { error: delErr } = await db.from('releases').delete().in('id', ids);

  if (delErr) { console.error('Delete failed:', delErr); process.exit(1); }

  console.log(`\n   ✓ Deleted ${toDelete.length} record(s).\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
