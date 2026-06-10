/**
 * Fixes collaborative releases that are missing artist_id by looking up
 * the primary artist (first name before & or ,) in the artists table
 * and setting artist_id accordingly.
 *
 * Example: "Sik-K & Lil Moshpit" → primary = "Sik-K" → finds Sik-K's artist row
 *
 * Run:
 *   npm run fix:collab-artist-ids              (dry run)
 *   npm run fix:collab-artist-ids -- --fix     (apply)
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = !process.argv.includes('--fix');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function primaryArtist(name: string): string {
  // "Sik-K & Lil Moshpit" → "Sik-K"
  // "Sik-K, Lil Moshpit" → "Sik-K"
  return name.split(/\s*[&,]\s*/)[0].trim();
}

async function main() {
  console.log(`\n  fix collab artist_id${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  // Load all releases with no artist_id — paginate both & and comma variants separately
  // (can't use .or() with comma patterns; Supabase parses the comma as an OR separator)
  const seen = new Set<string>();
  const releases: any[] = [];

  for (const pattern of ['%&%', '%,%']) {
    let from = 0;
    while (true) {
      const { data } = await db
        .from('releases')
        .select('id, title, artist, artist_id')
        .is('artist_id', null)
        .ilike('artist', pattern)
        .not('release_type', 'ilike', 'single')
        .range(from, from + 999);
      if (!data?.length) break;
      for (const r of data) {
        if (!seen.has(r.id)) { seen.add(r.id); releases.push(r); }
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  console.log(`  Found ${releases.length} non-single releases with no artist_id and collaborative artist name\n`);

  // Build a cache of artist name → id lookups
  const artistCache = new Map<string, string | null>();
  async function lookupArtist(name: string): Promise<string | null> {
    const lower = name.toLowerCase();
    if (artistCache.has(lower)) return artistCache.get(lower)!;
    const { data } = await db.from('artists').select('id').ilike('name', name).limit(1);
    const id = data?.[0]?.id ?? null;
    artistCache.set(lower, id);
    return id;
  }

  let fixed = 0, notFound = 0;

  for (const rel of releases) {
    const primary = primaryArtist(rel.artist);
    if (primary === rel.artist) { notFound++; continue; } // not actually collaborative

    const artistId = await lookupArtist(primary);
    if (!artistId) { notFound++; continue; }

    process.stdout.write(`  "${rel.title}" — ${rel.artist} → artist_id of "${primary}"\n`);

    if (!DRY_RUN) {
      await db.from('releases').update({ artist_id: artistId }).eq('id', rel.id);
    }
    fixed++;
  }

  console.log(`\n  Fixed: ${fixed}  |  No primary artist match: ${notFound}\n`);
  if (DRY_RUN) console.log('  Run with --fix to apply.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
