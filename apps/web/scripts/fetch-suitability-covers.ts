/**
 * Downloads real cover art for the suitability-labeling pool and resizes it
 * to small square thumbnails suitable for embedding in the review tool.
 * The Artifact sandbox blocks external image hosts entirely, so pointing an
 * <img> at the catalog's real cover_url (coverartarchive.org, Apple/Deezer
 * CDNs) silently fails — real images only work if the artifact publishes
 * them as its own files. This script does the download/resize half; the
 * publish step happens separately via the Artifact tool's `files` map.
 *
 * Input:  scripts/output/suitability-pool.json (from build-suitability-pool.ts)
 * Output: scripts/output/suitability-covers/<id>.jpg (140x140 JPEG)
 *         scripts/output/suitability-pool.json is rewritten in place, each
 *         item's `cover` field replaced with a local relative path
 *         ("covers/item-003.jpg") on success, or null on failure — never
 *         left pointing at the unreachable original URL.
 *
 * Run:
 *   npx tsx scripts/fetch-suitability-covers.ts
 *
 * Resume: re-run — items that already have a local cover file are skipped.
 */
import fs from 'fs';
import path from 'path';
import { Jimp } from 'jimp';

const POOL_PATH = path.resolve('scripts/output/suitability-pool.json');
const OUT_DIR = path.resolve('scripts/output/suitability-covers');
const SIZE = 140;
const CONCURRENCY = 8;

interface PoolItem {
  id: string;
  cover: string | null;
  [k: string]: unknown;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOne(item: PoolItem): Promise<string | null> {
  const localPath = path.join(OUT_DIR, `${item.id}.jpg`);
  if (fs.existsSync(localPath)) return `covers/${item.id}.jpg`;
  if (!item.cover) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(item.cover, { headers: { 'User-Agent': 'sillajuku-suitability-tool/1.0 (admin@sillajuku.com)' } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const img = await Jimp.read(buf);
      img.cover({ w: SIZE, h: SIZE });
      const outBuf = await img.getBuffer('image/jpeg', { quality: 68 });
      fs.writeFileSync(localPath, outBuf);
      return `covers/${item.id}.jpg`;
    } catch (e) {
      if (attempt === 2) return null;
      await sleep(500);
    }
  }
  return null;
}

async function main() {
  const pool: PoolItem[] = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let done = 0, ok = 0, failed = 0;
  for (let i = 0; i < pool.length; i += CONCURRENCY) {
    const batch = pool.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((item) => fetchOne(item)));
    results.forEach((result, idx) => {
      batch[idx].cover = result;
      done++;
      if (result) ok++; else failed++;
    });
    process.stdout.write(`\r${done}/${pool.length} processed (${ok} ok, ${failed} failed)`);
  }
  console.log();

  fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2));
  console.log(`Wrote ${POOL_PATH}`);
  const totalBytes = fs.readdirSync(OUT_DIR).reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`${fs.readdirSync(OUT_DIR).length} cover files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
}

main();
