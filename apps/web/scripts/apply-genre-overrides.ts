/**
 * Applies hand-curated genres from scripts/genre-overrides.json to the
 * releases table. Skips entries with empty "genres". Verifies that each
 * target row exists and is still genre-less before writing (so re-running
 * is safe and won't clobber any backfilled values).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts
 *   npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/apply-genre-overrides.ts --force   (overwrite even if already has genres)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
const IN_PATH = join(__dirname, 'genre-overrides.json');

interface OverrideRow {
  id: string;
  title: string;
  artist: string;
  release_date: string | null;
  release_type: string | null;
  sources: string[];
  genres: string;
}

async function main() {
  console.log(`\n🎵  Apply genre overrides${DRY_RUN ? ' [DRY RUN]' : ''}${FORCE ? ' [FORCE]' : ''}\n`);

  const raw = readFileSync(IN_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { releases: OverrideRow[] };
  const all = parsed.releases ?? [];

  const filled = all.filter(r => r.genres && r.genres.trim() !== '');
  const blank  = all.filter(r => !r.genres || r.genres.trim() === '');

  console.log(`Total entries in file:  ${all.length}`);
  console.log(`With genres (will apply): ${filled.length}`);
  console.log(`Blank (will skip):       ${blank.length}\n`);

  if (filled.length === 0) {
    console.log('Nothing to apply.\n');
    return;
  }

  // Look up current state so we can skip non-existent rows and (unless --force) rows that already have genres
  const ids = filled.map(r => r.id);
  const currentMap = new Map<string, { id: string; genres: string | null }>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db
      .from('releases')
      .select('id, genres')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) { console.error('Fetch failed:', error.message); process.exit(1); }
    for (const r of data ?? []) currentMap.set(r.id, r);
  }

  let applied = 0;
  let skippedExisting = 0;
  let skippedMissing = 0;
  let failed = 0;

  for (const row of filled) {
    const current = currentMap.get(row.id);
    if (!current) {
      console.log(`  ✗ MISSING in DB:        ${row.title} — ${row.artist}`);
      skippedMissing++;
      continue;
    }
    if (!FORCE && current.genres && current.genres.trim() !== '') {
      console.log(`  ⏭  already has genres:  ${row.title} — ${row.artist}  (current: ${current.genres})`);
      skippedExisting++;
      continue;
    }

    const normalized = row.genres.split(',').map(s => s.trim()).filter(Boolean).join(',');

    if (DRY_RUN) {
      console.log(`  + would set [${normalized}] on ${row.title} — ${row.artist}`);
      applied++;
      continue;
    }

    const { error: updErr } = await db
      .from('releases')
      .update({ genres: normalized })
      .eq('id', row.id);

    if (updErr) {
      console.log(`  ✗ UPDATE FAILED ${row.id}: ${updErr.message}`);
      failed++;
      continue;
    }

    console.log(`  ✓ ${row.title.padEnd(45).slice(0, 45)} — ${row.artist.padEnd(25).slice(0, 25)} [${normalized}]`);
    applied++;
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Applied:                ${applied}${DRY_RUN ? ' (dry run — not written)' : ''}
  Skipped (already had):  ${skippedExisting}
  Skipped (missing row):  ${skippedMissing}
  Failed:                 ${failed}
  Total entries:          ${all.length} (${blank.length} blank, ${filled.length} filled)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
