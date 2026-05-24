/**
 * Build the artist ingestion queue from Wikipedia category pages.
 *
 * Queries the Wikipedia API for members of Korean music genre categories,
 * then upserts artist names into artist_ingestion_queue (status = 'pending').
 * No scraping — uses the Wikipedia MediaWiki API (fully open, no auth).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/build-artist-queue.ts
 *   npx tsx --env-file=.env.local scripts/build-artist-queue.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 300;

// Wikipedia categories covering the Korean music landscape.
// cmtype=page filters out subcategories and files.
const CATEGORIES = [
  // K-pop
  'South_Korean_pop_music_groups',
  'K-pop_groups',
  'South_Korean_boy_bands',
  'South_Korean_girl_groups',

  // Solo artists
  'South_Korean_male_singers',
  'South_Korean_female_singers',
  'South_Korean_singers',

  // Hip-hop & R&B
  'Korean_hip_hop_musicians',
  'South_Korean_rappers',

  // Indie & rock
  'South_Korean_rock_music_groups',
  'South_Korean_indie_pop_groups',

  // Jazz
  'Korean_jazz_musicians',
  'South_Korean_jazz_musicians',

  // Traditional & trot
  'Trot_singers',
  'South_Korean_trot_singers',

  // Electronic
  'South_Korean_electronic_musicians',

  // Ballad & misc
  'South_Korean_ballad_singers',
  'Korean_pop_singers',
];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface WikiPage { pageid: number; title: string }

async function fetchCategoryMembers(category: string): Promise<WikiPage[]> {
  const members: WikiPage[] = [];
  let continueToken: string | undefined;

  do {
    await sleep(DELAY_MS);
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', `Category:${category}`);
    url.searchParams.set('cmlimit', '500');
    url.searchParams.set('cmtype', 'page');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    if (continueToken) url.searchParams.set('cmcontinue', continueToken);

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' },
    });

    if (!res.ok) {
      console.warn(`  [wiki] ${category}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    members.push(...(data.query?.categorymembers ?? []));
    continueToken = data.continue?.cmcontinue;
  } while (continueToken);

  return members;
}

function cleanTitle(title: string): string {
  // Strip disambiguation suffixes: "IU (singer)" → "IU", "g.o.d (group)" → "g.o.d"
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Fetch Korean Wikipedia title for an English Wikipedia article.
// The Korean article title is the artist's Korean name.
async function fetchKoreanName(pageTitle: string): Promise<string | null> {
  await sleep(DELAY_MS);
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', pageTitle);
  url.searchParams.set('prop', 'langlinks');
  url.searchParams.set('lllang', 'ko');
  url.searchParams.set('lllimit', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'sillajuku-catalog-builder/1.0 (admin@sillajuku.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = Object.values(data.query?.pages ?? {}) as any[];
    return pages[0]?.langlinks?.[0]?.['*'] ?? null;
  } catch {
    return null;
  }
}

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

async function main() {
  console.log(`\n  sillajuku artist queue builder — Wikipedia${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db = getDB();
  const seen = new Set<string>();
  const toInsert: { name: string; source: string; source_id: string; name_native: string | null }[] = [];

  for (const category of CATEGORIES) {
    process.stdout.write(`  Fetching: ${category} … `);
    const members = await fetchCategoryMembers(category);
    let added = 0;

    for (const page of members) {
      const name = cleanTitle(page.title);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      // Fetch Korean name from Wikipedia langlinks (uses page.title before disambiguation strip)
      const name_native = await fetchKoreanName(page.title);
      toInsert.push({ name, source: 'wikipedia', source_id: page.title, name_native });
      added++;
    }

    console.log(`${members.length} pages → ${added} new artists`);
  }

  console.log(`\n  Total unique artists to queue: ${toInsert.length}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] — no DB writes');
    console.log('\n  Sample (first 20):');
    toInsert.slice(0, 20).forEach(a => console.log(`    ${a.name}${a.name_native ? ` (${a.name_native})` : ''}`));
    return;
  }

  // Upsert in batches of 100 — on conflict update name_native so re-runs backfill Korean names
  const BATCH = 100;
  let inserted = 0;

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await db
      .from('artist_ingestion_queue')
      .upsert(batch, { onConflict: 'name,source', ignoreDuplicates: false });

    if (error) {
      console.error(`  ! Batch ${i / BATCH + 1} error:`, error.message);
    } else {
      inserted += batch.length;
    }
  }

  // Count actual pending rows
  const { count } = await db
    .from('artist_ingestion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Artists discovered : ${toInsert.length}
  Queue rows pending : ${count ?? '?'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Next: npm run queue:ingest
`);
}

main().catch(err => { console.error(err); process.exit(1); });
