/**
 * One-time normalization pass over the releases table.
 *
 * Fixes two historical inconsistencies introduced by the Spotify ingest:
 *
 *   1. release_date partial dates — Spotify returns "2024" or "2024-01" for
 *      albums with low date precision. Normalize to full "YYYY-MM-DD" by
 *      padding: "2024" → "2024-01-01", "2024-01" → "2024-01-01".
 *      iTunes-sourced dates are already "YYYY-MM-DD" and are skipped.
 *
 *   2. genres mixed case — CSV fallback in ingest-music.ts stored genres like
 *      "K-Pop", "Hip-Hop". All other sources store lowercase. Normalize to
 *      lowercase and trim whitespace around commas.
 *
 *   3. release_type casing — any rows with lowercase "album", "ep", etc.
 *      (from the vote API before normalization was added) get corrected.
 *
 * Safe to re-run — skips rows that are already correct.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/normalize-releases.ts
 *   npx tsx --env-file=.env.local scripts/normalize-releases.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN   = process.argv.includes('--dry-run');
const BATCH     = 1000;

const RELEASE_TYPE_MAP: Record<string, string> = {
  album: 'Album', single: 'Single', ep: 'EP',
  compilation: 'Compilation', live: 'Live',
};

function normalizeDate(d: string | null): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;           // already full
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;          // "2024-01" → "2024-01-01"
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;             // "2024" → "2024-01-01"
  return d;
}

function normalizeGenres(g: string | null): string | null {
  if (!g) return null;
  return g.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).join(',');
}

function normalizeReleaseType(rt: string | null): string | null {
  if (!rt) return 'Album';
  const mapped = RELEASE_TYPE_MAP[rt.toLowerCase()];
  // Already correct (first char uppercase and matches known values)
  if (!mapped) return rt;
  if (rt === mapped) return null; // no change needed
  return mapped;
}

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

async function main() {
  console.log(`\n  sillajuku releases normalization${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
  console.log('  Fixing: release_date partial dates · genres casing · release_type casing\n');

  const db = getDB();

  let from   = 0;
  let fixedDate = 0, fixedGenres = 0, fixedType = 0, checked = 0;

  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, release_date, genres, release_type')
      .range(from, from + BATCH - 1);

    if (error) { console.error('DB fetch error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    for (const row of data) {
      checked++;
      const updates: Record<string, string | null> = {};

      // 1. release_date
      const fixedD = normalizeDate(row.release_date);
      if (fixedD !== row.release_date) {
        updates.release_date = fixedD;
        fixedDate++;
      }

      // 2. genres
      const fixedG = normalizeGenres(row.genres);
      if (fixedG !== row.genres) {
        updates.genres = fixedG;
        fixedGenres++;
      }

      // 3. release_type
      const fixedT = normalizeReleaseType(row.release_type);
      if (fixedT !== null && fixedT !== row.release_type) {
        updates.release_type = fixedT;
        fixedType++;
      }

      if (Object.keys(updates).length > 0 && !DRY_RUN) {
        const { error: upErr } = await db.from('releases').update(updates).eq('id', row.id);
        if (upErr) console.error(`  ! ${row.id}: ${upErr.message}`);
      }
    }

    if (from % 5000 === 0) {
      console.log(`  Checked ${checked} rows… (date:${fixedDate} genres:${fixedGenres} type:${fixedType} fixed so far)`);
    }

    if (data.length < BATCH) break;
    from += BATCH;
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total rows checked       : ${checked}
  release_date normalized  : ${fixedDate}
  genres lowercased        : ${fixedGenres}
  release_type corrected   : ${fixedType}
  ${DRY_RUN ? '(DRY RUN — no changes written)' : 'All changes written to DB.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
