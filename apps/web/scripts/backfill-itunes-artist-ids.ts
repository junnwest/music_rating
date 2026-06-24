/**
 * Backfills itunes_artist_id on the artists table for all rows where it is NULL.
 *
 * For each artist, searches iTunes by name and evaluates confidence:
 *   HIGH   — normalized name is an exact match → auto-write in --fix mode
 *   MEDIUM — normalized name overlaps but differs → printed for manual review, skipped
 *   LOW    — no plausible match found → skipped
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-itunes-artist-ids.ts
 *   npx tsx --env-file=.env.local scripts/backfill-itunes-artist-ids.ts --fix
 *   npx tsx --env-file=.env.local scripts/backfill-itunes-artist-ids.ts --fix --limit=100
 *
 * Use npm run backfill:itunes-artist-ids for the dry-run,
 *     npm run backfill:itunes-artist-ids:fix for the live run.
 *
 * After running, use `itunes:discography` to ingest full catalogs for any
 * newly identified artists.
 */

import { createClient } from '@supabase/supabase-js';

const FIX   = process.argv.includes('--fix');
const LIMIT = (() => {
  const raw = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1];
  return raw ? parseInt(raw, 10) : Infinity;
})();

const DELAY_MS = 600;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// Strips everything non-alphanumeric (any script) for comparison
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').trim();
}

async function searchItunesArtist(name: string): Promise<{ artistId: number; artistName: string } | null> {
  await sleep(DELAY_MS);
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=5`;
  let data: any;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-backfill/1.0' } });
    if (res.status === 429) {
      console.log('\n  [429] Rate limited — waiting 30s…');
      await sleep(30_000);
      return searchItunesArtist(name);
    }
    if (!res.ok) return null;
    data = await res.json();
  } catch { return null; }

  const results: any[] = (data.results ?? []).filter((r: any) => r.wrapperType === 'artist');
  if (results.length === 0) return null;

  const normName = norm(name);
  const exact = results.find(r => norm(r.artistName) === normName);
  return exact ?? results[0];
}

type Confidence = 'high' | 'medium' | 'low';

function confidence(ourName: string, itunesName: string): Confidence {
  const a = norm(ourName);
  const b = norm(itunesName);
  if (a === b) return 'high';
  // One contains the other (e.g. "The 1975" vs "1975")
  if (a.includes(b) || b.includes(a)) return 'medium';
  // Levenshtein-lite: allow up to 2 char differences for short names
  if (Math.abs(a.length - b.length) <= 2) {
    let diff = 0;
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    for (let i = 0; i < shorter.length; i++) { if (shorter[i] !== longer[i]) diff++; }
    diff += longer.length - shorter.length;
    if (diff <= 2) return 'medium';
  }
  return 'low';
}

async function main() {
  const db = getDB();

  const artists: { id: string; name: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('artists')
      .select('id, name')
      .is('itunes_artist_id', null)
      .order('name')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    artists.push(...(data as { id: string; name: string }[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  if (artists.length === 0) {
    console.log('All artists already have itunes_artist_id set.');
    return;
  }

  const todo = artists.slice(0, LIMIT === Infinity ? artists.length : LIMIT);

  console.log(`\n  iTunes artist ID backfill${FIX ? ' [WRITE MODE]' : ' [DRY RUN]'}`);
  console.log(`  Artists missing itunes_artist_id: ${artists.length}`);
  console.log(`  Processing: ${todo.length}\n`);

  const stats = { high: 0, medium: 0, low: 0, written: 0, errors: 0 };
  const needsReview: { name: string; found: string; id: number }[] = [];

  for (let i = 0; i < todo.length; i++) {
    const artist = todo[i] as { id: string; name: string };
    process.stdout.write(`  [${i + 1}/${todo.length}] ${artist.name} … `);

    const result = await searchItunesArtist(artist.name);
    if (!result) {
      console.log('not found');
      stats.low++;
      continue;
    }

    const conf = confidence(artist.name, result.artistName);

    if (conf === 'high') {
      console.log(`✓ "${result.artistName}" (${result.artistId})`);
      stats.high++;
      if (FIX) {
        const { error: updateErr } = await db
          .from('artists')
          .update({ itunes_artist_id: result.artistId })
          .eq('id', artist.id);
        if (updateErr) {
          // Conflict: another artist already has this itunes_artist_id (split catalog case)
          console.log(`    ⚠ conflict — ${updateErr.message}`);
          stats.errors++;
        } else {
          stats.written++;
        }
      }
    } else if (conf === 'medium') {
      console.log(`? "${result.artistName}" (${result.artistId}) — needs review`);
      stats.medium++;
      needsReview.push({ name: artist.name, found: result.artistName, id: result.artistId });
    } else {
      console.log(`✗ best match: "${result.artistName}" — too different, skipped`);
      stats.low++;
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  High confidence (exact match) : ${stats.high}
  Medium confidence (needs review): ${stats.medium}
  Low confidence (skipped)       : ${stats.low}
  Written to DB                  : ${stats.written}${FIX ? '' : ' (dry run — use --fix to write)'}
  Conflicts (split catalog cases): ${stats.errors}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (needsReview.length > 0) {
    console.log('\n  MEDIUM CONFIDENCE — review manually:');
    console.log('  (use `itunes:artist:id --itunes-id=NUMBER` to ingest if correct)\n');
    needsReview.forEach(r =>
      console.log(`  DB: "${r.name}"  →  iTunes: "${r.found}" (${r.id})`)
    );
  }

  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
