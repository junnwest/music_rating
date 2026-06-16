/**
 * Build the artist ingestion queue from Wikipedia categories — GLOBAL expansion.
 *
 * Sibling to build-artist-queue.ts (which is Korea-only). This script seeds the
 * under-represented cultures surfaced by analyze-coverage: Japan, Greater China,
 * SE Asia, South Asia, plus a *deliberately light* Western-canon pass to fix the
 * pre-2000 historical gap without re-flooding the catalog with Western pop.
 *
 * Each artist is queued with source = `wikipedia_<region>` so downstream steps
 * (discover-global, composition analysis) can scope by region.
 *
 * No scraping — uses the open MediaWiki API. No auth.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/build-global-queue.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/build-global-queue.ts
 *   npx tsx --env-file=.env.local scripts/build-global-queue.ts --region=japan
 *
 * Idempotent: re-runs skip artists already queued (upsert on name,source).
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN  = process.argv.includes('--dry-run');
const REGION_ARG = process.argv.find(a => a.startsWith('--region='))?.split('=')[1] ?? null;
const DELAY_MS = 300;

// Region groups. `nativeLang` is the Wikipedia langlink we request for native
// names (only meaningful for non-Latin scripts; Latin-script langs stay null).
// Categories are best-effort — a non-existent category just returns 0 members.
// Western is intentionally small + canonical (Hall-of-Fame / label rosters) to
// add historical depth, NOT blanket "American rock groups" which would flood.
interface RegionGroup { region: string; nativeLang: string | null; categories: string[] }

const REGIONS: RegionGroup[] = [
  {
    region: 'japan',
    nativeLang: 'ja',
    categories: [
      'Japanese_idol_groups',
      'Japanese_girl_groups',
      'Japanese_boy_bands',
      'Japanese_pop_music_groups',
      'Japanese_rock_music_groups',
      'Japanese_hip_hop_groups',
      'Japanese_hip_hop_musicians',
      'Japanese_women_pop_singers',
      'Japanese_male_pop_singers',
      'Japanese_singer-songwriters',
      'City_pop_musicians',
      'Vocaloid_music_groups',
      'Anime_musicians',
    ],
  },
  {
    region: 'greater_china',
    nativeLang: 'zh',
    categories: [
      'Mandopop_singers',
      'Cantopop_singers',
      'Taiwanese_pop_singers',
      'Taiwanese_Mandopop_singers',
      'Hong_Kong_pop_singers',
      'Hong_Kong_male_singers',
      'Hong_Kong_female_singers',
      'Chinese_pop_singers',
      'Chinese_rock_musicians',
      'C-pop_musicians',
    ],
  },
  {
    region: 'sea',
    nativeLang: 'th', // mixed-script region; only Thai is non-Latin among these
    categories: [
      'Thai_pop_singers',
      'Thai_male_singers',
      'Thai_female_singers',
      'Vietnamese_pop_singers',
      'Vietnamese_singers',
      'Indonesian_pop_singers',
      'Indonesian_singers',
      'Filipino_pop_singers',
      'Filipino_singers',
      'Malaysian_pop_singers',
      'Singaporean_pop_singers',
    ],
  },
  {
    region: 'south_asia',
    nativeLang: 'hi',
    categories: [
      'Indian_playback_singers',
      'Bollywood_playback_singers',
      'Indian_pop_singers',
      'Indian_film_score_composers',
      'Punjabi-language_singers',
      'Hindi-language_singers',
      'Pakistani_pop_singers',
    ],
  },
  {
    region: 'western_canon',
    nativeLang: null,
    categories: [
      'Rock_and_Roll_Hall_of_Fame_inductees',
      'Motown_artists',
      'Stax_Records_artists',
      'Blue_Note_Records_artists',
      'Atlantic_Records_artists',
      'Chess_Records_artists',
    ],
  },
  {
    region: 'africa',
    nativeLang: null,
    categories: [
      'Afrobeats_musicians',
      'Nigerian_hip_hop_musicians',
      'Ghanaian_musicians',
      'South_African_musicians',
    ],
  },
  {
    region: 'europe_world',
    nativeLang: null,
    categories: [
      'French_pop_singers',
      'French_male_singers',
      'French_women_singers',
      'German_pop_singers',
      'Brazilian_singer-songwriters',
    ],
  },
];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface WikiPage { pageid: number; title: string }

// ISO 639-1 from script. Covers more scripts than the Korea-only builder so
// native names work for Japanese / Chinese / Thai / Hindi / Arabic artists.
function detectLanguage(s: string): string | null {
  if (/[가-힣ᄀ-ᇿ]/.test(s)) return 'ko';
  if (/[぀-ゟ゠-ヿ]/.test(s)) return 'ja';
  if (/[一-鿿]/.test(s)) return 'zh';
  if (/[ก-๛]/.test(s)) return 'th';
  if (/[ऀ-ॿ]/.test(s)) return 'hi';
  if (/[؀-ۿ]/.test(s)) return 'ar';
  return null;
}

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
    if (!res.ok) { console.warn(`  [wiki] ${category}: HTTP ${res.status}`); break; }
    const data = await res.json();
    members.push(...(data.query?.categorymembers ?? []));
    continueToken = data.continue?.cmcontinue;
  } while (continueToken);
  return members;
}

function cleanTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// Native name from the region's primary-language Wikipedia langlink.
async function fetchNativeName(pageTitle: string, lang: string | null): Promise<string | null> {
  if (!lang) return null;
  await sleep(DELAY_MS);
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', pageTitle);
  url.searchParams.set('prop', 'langlinks');
  url.searchParams.set('lllang', lang);
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
  } catch { return null; }
}

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

async function main() {
  console.log(`\n  sillajuku GLOBAL artist queue builder${DRY_RUN ? ' [DRY RUN]' : ''}` +
    `${REGION_ARG ? ` [region=${REGION_ARG}]` : ''}\n`);

  const db = getDB();
  const groups = REGION_ARG ? REGIONS.filter(r => r.region === REGION_ARG) : REGIONS;
  if (groups.length === 0) {
    console.error(`  Unknown region '${REGION_ARG}'. Valid: ${REGIONS.map(r => r.region).join(', ')}`);
    process.exit(1);
  }

  const seen = new Set<string>();
  const toInsert: { name: string; source: string; source_id: string; name_native: string | null }[] = [];
  const perRegion: Record<string, number> = {};

  for (const group of groups) {
    console.log(`\n  ── ${group.region} ──`);
    for (const category of group.categories) {
      process.stdout.write(`  ${category} … `);
      const members = await fetchCategoryMembers(category);
      let added = 0;
      for (const page of members) {
        const name = cleanTitle(page.title);
        const dedupeKey = name.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const rawNative = await fetchNativeName(page.title, group.nativeLang);
        const name_native = rawNative && detectLanguage(rawNative) ? rawNative : null;
        toInsert.push({ name, source: `wikipedia_${group.region}`, source_id: page.title, name_native });
        added++;
      }
      perRegion[group.region] = (perRegion[group.region] ?? 0) + added;
      console.log(`${members.length} pages → ${added} new`);
    }
  }

  console.log(`\n  Total unique artists to queue: ${toInsert.length}`);
  console.log('  Per region:');
  for (const [r, n] of Object.entries(perRegion).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${r.padEnd(16)} ${n}`);
  }

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] — no DB writes. Sample (first 25):');
    toInsert.slice(0, 25).forEach(a => console.log(`    [${a.source.replace('wikipedia_', '')}] ${a.name}${a.name_native ? ` (${a.name_native})` : ''}`));
    return;
  }

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await db
      .from('artist_ingestion_queue')
      .upsert(batch, { onConflict: 'name,source', ignoreDuplicates: false });
    if (error) console.error(`  ! Batch ${i / BATCH + 1} error:`, error.message);
    else inserted += batch.length;
  }

  const { count } = await db
    .from('artist_ingestion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Artists discovered : ${toInsert.length}
  Upserted           : ${inserted}
  Queue rows pending : ${count ?? '?'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Next: npm run queue:ingest:albums
`);
}

main().catch(err => { console.error(err); process.exit(1); });
