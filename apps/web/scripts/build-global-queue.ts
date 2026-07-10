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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DRY_RUN  = process.argv.includes('--dry-run');
const REGION_ARG = process.argv.find(a => a.startsWith('--region='))?.split('=')[1] ?? null;
const DELAY_MS = 300;

// Region groups. `nativeLang` is the Wikipedia langlink we request for native
// names (only meaningful for non-Latin scripts; Latin-script langs stay null).
// Categories are best-effort — a non-existent category just returns 0 members.
// Western is intentionally small + canonical (Hall-of-Fame / label rosters) to
// add historical depth, NOT blanket "American rock groups" which would flood.
interface RegionGroup { region: string; nativeLang: string | null; categories: string[]; wiki?: 'en' | 'ko' }

export const REGIONS: RegionGroup[] = [
  {
    // The core region. English Wikipedia caps at ~765 Korean artists, so we pull from
    // KOREAN Wikipedia (ko.wikipedia.org — CC BY-SA, far deeper coverage). Titles come back
    // in Hangul, which is the artist's native name AND resolves cleanly via MB's Hangul
    // names/aliases. The curated `seed` (romanized) adds the spine on top.
    region: 'korea',
    nativeLang: 'ko',
    wiki: 'ko',
    categories: [
      '대한민국의_가수', '대한민국의_여자_가수', '대한민국의_남자_가수',
      '대한민국의_아이돌', '대한민국의_음악_그룹', '대한민국의_보이_밴드', '대한민국의_걸_그룹',
      '대한민국의_래퍼', '대한민국의_힙합_음악가',
      '대한민국의_록_밴드', '대한민국의_인디_음악가', '대한민국의_싱어송라이터',
      '대한민국의_발라드_가수', '트로트_가수', '대한민국의_리듬_앤드_블루스_가수',
    ],
  },
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
    // Deliberately CANON, not blanket pop ("American rock groups" would flood). Awards/
    // Hall-of-Fame lists + classic label rosters give historical depth AND genre breadth
    // (soul, jazz, hip-hop, country, blues, indie) — the genre-saturation lever for the West.
    region: 'western_canon',
    nativeLang: null,
    categories: [
      // cross-genre canon (awards / halls of fame)
      'Rock_and_Roll_Hall_of_Fame_inductees',
      'Grammy_Lifetime_Achievement_Award_winners',
      'Songwriters_Hall_of_Fame_inductees',
      'Country_Music_Hall_of_Fame_inductees',
      'Blues_Hall_of_Fame_inductees',
      // soul / jazz
      'Motown_artists', 'Stax_Records_artists', 'Blue_Note_Records_artists', 'Verve_Records_artists',
      'Atlantic_Records_artists', 'Chess_Records_artists',
      // hip-hop canon
      'Def_Jam_Recordings_artists', 'Death_Row_Records_artists', 'Bad_Boy_Records_artists',
      // indie / alternative canon
      'Sub_Pop_artists', 'Matador_Records_artists', '4AD_artists', 'XL_Recordings_artists',
    ],
  },
  {
    region: 'latin',
    nativeLang: null, // Spanish/Portuguese are Latin-script
    categories: [
      'Latin_Grammy_Award_winners',
      'Latin_pop_singers',
      'Reggaeton_musicians',
      'Mexican_singers',
      'Colombian_singers',
      'Puerto_Rican_singers',
      'Argentine_singers',
      'Spanish_pop_singers',
      'Salsa_musicians',
      'Brazilian_singers',
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
      'Amapiano_musicians',
      'Nigerian_musicians',
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
      'Italian_pop_singers',
      'Swedish_pop_singers',
      'Brazilian_singer-songwriters',
    ],
  },
];

// Target composition shares (CATALOG_EXPANSION_PLAN §2). `--target=N` caps each region at
// round(SHARE × N) so the queue lands on these proportions instead of whatever the categories
// happen to yield. Korea stays the deepest single region; the curated `seed` adds on top.
export const SHARE: Record<string, number> = {
  korea: 0.28, western_canon: 0.30, japan: 0.15, greater_china: 0.07,
  sea: 0.05, south_asia: 0.04, latin: 0.05, africa: 0.03, europe_world: 0.03,
};

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

async function fetchCategoryMembers(category: string, host = 'en.wikipedia.org'): Promise<WikiPage[]> {
  const members: WikiPage[] = [];
  let continueToken: string | undefined;
  do {
    await sleep(DELAY_MS);
    const url = new URL(`https://${host}/w/api.php`);
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

export interface WikipediaTopUpOpts {
  regions?: string[];        // region names to pull (default: all)
  limit?: number;            // max NEW artists to queue this call (default: Infinity)
  fetchNative?: boolean;     // fetch native-name langlinks per artist — slow (default: true)
  dryRun?: boolean;          // count NEW artists per region, write nothing (preview)
  log?: (msg: string) => void;
}

/**
 * Pull category members from the given Wikipedia regions and queue the NEW ones
 * (source='wikipedia_<region>', source_id=page title) for the INGEST lane to MB-resolve.
 * Inserts incrementally and stops once `limit` NEW artists have been queued, so the
 * self-feeding DISCOVER lane can take a bounded slice. Idempotent: skips names already
 * queued under the same source. Returns the number of new artists queued.
 *
 * Region-curated by design (Japan / Greater China / SEA / South Asia / Africa / a light
 * Western-canon pass) — this is the counterweight that keeps auto-discovery from drifting
 * Western the way the old Last.fm snowball did.
 */
export async function wikipediaTopUp(db: SupabaseClient, opts: WikipediaTopUpOpts = {}): Promise<number> {
  const limit = opts.limit ?? Infinity;
  const dryRun = opts.dryRun ?? false;
  const fetchNative = (opts.fetchNative ?? true) && !dryRun; // never fetch native names in a preview
  const log = opts.log ?? (() => {});
  const groups = opts.regions?.length ? REGIONS.filter(r => opts.regions!.includes(r.region)) : REGIONS;
  if (limit <= 0 || groups.length === 0) return 0;

  // Skip names already queued under any wikipedia_* source (so `limit` counts genuine new).
  // Paginate — a bare PostgREST .select() caps at 1000 rows, and there are already several
  // thousand wikipedia_* rows, so an un-paged fetch would silently re-process names past the
  // first 1000 (same 1000-row-cap class as the listenBrainzTopUp dedup fix).
  // .order('id') is required: pagination without a stable sort skips/double-counts across pages.
  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('artist_ingestion_queue')
      .select('name, source')
      .like('source', 'wikipedia_%')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`wikipedia dedup page@${from}: ${error.message}`);
    if (!data?.length) break;
    for (const r of data as any[]) have.add(`${r.source}::${(r.name as string).toLowerCase()}`);
    if (data.length < 1000) break;
  }

  const seen = new Set<string>();
  let queued = 0;

  for (const group of groups) {
    if (queued >= limit) break;
    const source = `wikipedia_${group.region}`;
    const host = group.wiki === 'ko' ? 'ko.wikipedia.org' : 'en.wikipedia.org';
    log(`  [wiki] ── ${group.region} ──`);
    let regionNew = 0;
    for (const category of group.categories) {
      if (queued >= limit) break;
      const members = await fetchCategoryMembers(category, host);
      const batch: { name: string; source: string; source_id: string; name_native: string | null }[] = [];
      for (const page of members) {
        if (queued + batch.length >= limit) break;
        const name = cleanTitle(page.title);
        const key = name.toLowerCase();
        if (seen.has(key) || have.has(`${source}::${key}`)) continue;
        seen.add(key);
        // ko-wiki titles are already the native (Hangul) name — no langlink fetch needed.
        // en-wiki: fetch the region's native-language langlink (skipped in dry/preview).
        const name_native = group.wiki === 'ko'
          ? (detectLanguage(name) ? name : null)
          : (fetchNative ? (await fetchNativeName(page.title, group.nativeLang).then(n => n && detectLanguage(n) ? n : null)) : null);
        batch.push({ name, source, source_id: page.title, name_native });
      }
      if (batch.length && !dryRun) {
        const { error } = await db
          .from('artist_ingestion_queue')
          .upsert(batch.map(b => ({ ...b, status: 'pending' })), { onConflict: 'name,source', ignoreDuplicates: true });
        if (error) { log(`  [wiki] ! ${category}: ${error.message}`); continue; }
      }
      queued += batch.length; regionNew += batch.length;
      log(`  [wiki] ${category.padEnd(38)} ${String(members.length).padStart(4)} pages → +${batch.length} new`);
    }
    log(`  [wiki] ── ${group.region} subtotal: ${regionNew} new ──`);
  }
  return queued;
}

async function main() {
  console.log(`\n  sillajuku GLOBAL artist queue builder${DRY_RUN ? ' [DRY RUN]' : ''}` +
    `${REGION_ARG ? ` [region=${REGION_ARG}]` : ''}\n`);

  if (REGION_ARG && !REGIONS.some(r => r.region === REGION_ARG)) {
    console.error(`  Unknown region '${REGION_ARG}'. Valid: ${REGIONS.map(r => r.region).join(', ')}`);
    process.exit(1);
  }
  const db = getDB();
  const TARGET = (() => { const a = process.argv.find(x => x.startsWith('--target=')); return a ? parseInt(a.split('=')[1], 10) : null; })();
  const LIMIT  = (() => { const a = process.argv.find(x => x.startsWith('--limit='));  return a ? parseInt(a.split('=')[1], 10) : undefined; })();

  // Proportional mode: cap each region at its SHARE of the total target → lands on the
  // planned composition instead of whatever the categories happen to yield.
  if (TARGET) {
    const regions = REGION_ARG ? [REGION_ARG] : REGIONS.map(r => r.region);
    let total = 0;
    for (const region of regions) {
      const cap = Math.round((SHARE[region] ?? 0) * TARGET);
      if (cap <= 0) { console.log(`\n  == ${region}: share 0 — skipped ==`); continue; }
      console.log(`\n  == ${region}: target ${cap} (${Math.round((SHARE[region] ?? 0) * 100)}%) ==`);
      // Skip native-name langlinks — the MB ingest derives native names itself, so they'd be
      // wasted work that slows the bulk queue build ~3×.
      total += await wikipediaTopUp(db, { regions: [region], limit: cap, dryRun: DRY_RUN, fetchNative: false, log: m => console.log(m) });
    }
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  ${DRY_RUN ? '[DRY RUN] would queue' : 'queued'} ${total} NEW artists toward target ${TARGET}`);
    console.log(`  (Korea also has the curated seed on top; then \`npm run pipeline\` ingests.)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return;
  }

  const queued = await wikipediaTopUp(db, {
    regions: REGION_ARG ? [REGION_ARG] : undefined,
    limit: LIMIT,
    dryRun: DRY_RUN,
    log: m => console.log(m),
  });

  if (DRY_RUN) {
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [DRY RUN] would queue ${queued} NEW artists (no writes)
  Re-run without --dry-run to queue them.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    return;
  }

  const { count } = await db
    .from('artist_ingestion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  New artists queued : ${queued}
  Queue rows pending : ${count ?? '?'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Next: npm run pipeline   (INGEST will MB-resolve these)
`);
}

if (process.argv[1] && process.argv[1].endsWith('build-global-queue.ts')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
