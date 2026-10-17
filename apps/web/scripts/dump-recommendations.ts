/**
 * Read-only: run the Add page's personal rows (lib/taste/recommendations.ts) for
 * one user and print each liked world's pool/fits/slots plus the rows it ships.
 *
 *   npx tsx --env-file=.env.local scripts/dump-recommendations.ts --user=<username> [--vary]
 */
import { createClient } from '@supabase/supabase-js';
import { computeRecommendations } from '../lib/taste/recommendations';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const username = process.argv.find((a) => a.startsWith('--user='))?.split('=')[1];
if (!username) {
  console.error('--user=<username> is required');
  process.exit(1);
}

async function main() {
  const { data: p, error } = await db.from('profiles').select('id').eq('username', username).single();
  if (error || !p) throw error ?? new Error(`no user ${username}`);
  const started = Date.now();
  const { payload, debug } = await computeRecommendations(db, p.id, { vary: process.argv.includes('--vary') });
  console.log(`computed in ${Date.now() - started}ms`);
  console.log('\nLiked worlds:');
  for (const w of debug.worlds) {
    console.log(`  ${w.label.padEnd(24)} ${w.key.padEnd(18)} mass=${String(w.mass).padStart(5)} avg=${w.avg} weight=${w.weight} pool=${w.pool} fits=${w.fits} slots=${w.slots}`);
  }
  console.log(`\nFor You (${payload.forYou.length}):`);
  for (const r of payload.forYou) console.log(`  ${r.artist_display} — ${r.native_title ?? r.title}`);
  for (const w of payload.worlds) {
    console.log(`\nBecause you love ${w.label} (${w.albums.length}): ${w.albums.map((a) => a.artist_display).join(', ')}`);
  }
  console.log(`\nFrom Your Taste (${payload.fromYourTaste.length}): ${payload.fromYourTaste.slice(0, 12).map((a) => a.artist_display).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
