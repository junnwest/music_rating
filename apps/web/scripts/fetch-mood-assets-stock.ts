/**
 * Pulls candidate stock photos from the Unsplash API for the curated list of
 * "mood" objects used in meme/CTA posters (records, tapes, gear — not tied
 * to a specific release, unlike informational posts which use real catalog
 * cover art). Saves raw candidates + a manifest for a human to review and
 * pick from. Does NOT auto-select or treat anything — that's
 * treat-mood-asset.ts, run by hand on whichever candidate is picked.
 *
 * Unsplash's API terms require triggering the download endpoint for any
 * photo actually used, which this script does for every candidate it saves
 * (registers the photographer's download count — a courtesy, not payment;
 * Unsplash-licensed photos are free for commercial use, no permission needed).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fetch-mood-assets-stock.ts
 *   npx tsx --env-file=.env.local scripts/fetch-mood-assets-stock.ts --term="vinyl record close up"
 *   npx tsx --env-file=.env.local scripts/fetch-mood-assets-stock.ts --dry-run
 *
 * Requires: UNSPLASH_ACCESS_KEY in environment.
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const PER_TERM = Number(process.argv.find((a) => a.startsWith('--per-term='))?.split('=')[1] ?? 3);
const ONLY_TERM = process.argv.find((a) => a.startsWith('--term='))?.slice('--term='.length);

const OUT_DIR = path.resolve('scripts/output/mood-assets/raw');
const MANIFEST_PATH = path.resolve('scripts/output/mood-assets/manifest.json');

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!ACCESS_KEY && !DRY_RUN) {
  console.error('UNSPLASH_ACCESS_KEY is not set. Add it to .env.local.');
  process.exit(1);
}

// Curated "mood" object terms — inanimate music objects only, no people
// (sidesteps model-release concerns), matched to the meme/CTA poster system.
const TERMS = [
  'vinyl record close up',
  'cassette tape close up',
  'turntable tonearm',
  'headphones dark background',
  'reel to reel tape deck',
  'boombox',
  'guitar strings close up',
  'mixing console knobs',
];

interface ManifestEntry {
  term: string;
  source: 'stock';
  unsplashId: string;
  file: string;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
  fetchedAt: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchTerm(term: string) {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', term);
  url.searchParams.set('per_page', String(PER_TERM));
  url.searchParams.set('orientation', 'portrait');
  url.searchParams.set('content_filter', 'high');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
  });
  if (!res.ok) {
    console.error(`  [${res.status}] search failed for "${term}"`);
    return [];
  }
  const data = await res.json();
  return data.results ?? [];
}

async function main() {
  const terms = ONLY_TERM ? [ONLY_TERM] : TERMS;
  const manifest: ManifestEntry[] = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : [];

  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const term of terms) {
    console.log(`\n${term}`);
    if (DRY_RUN) continue;

    const results = await searchTerm(term);
    if (results.length === 0) {
      console.log('  no results');
      continue;
    }

    for (const photo of results) {
      const file = `${term.replace(/\s+/g, '-')}-${photo.id}.jpg`;
      console.log(`  ${photo.id} — by ${photo.user?.name} — ${photo.links.html}`);

      // Register the download per Unsplash API guidelines, then fetch the image.
      await fetch(`${photo.links.download_location}&client_id=${ACCESS_KEY}`);
      const imgRes = await fetch(photo.urls.regular);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(path.join(OUT_DIR, file), buf);

      manifest.push({
        term,
        source: 'stock',
        unsplashId: photo.id,
        file,
        photographer: photo.user?.name ?? 'unknown',
        photographerUrl: photo.user?.links?.html ?? '',
        sourceUrl: photo.links.html,
        fetchedAt: new Date().toISOString(),
      });

      await sleep(400); // Unsplash demo-tier rate limit is 50 req/hour — be gentle
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`\nSaved ${manifest.length} candidates total to ${OUT_DIR}`);
    console.log(`Manifest: ${MANIFEST_PATH}`);
    console.log('\nReview the candidates, pick the best per term, then run treat-mood-asset.ts on each pick.');
  }
}

main();
