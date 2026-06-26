/**
 * Standalone EMBEDDINGS backfill — Jina v3 over release_groups missing an embedding.
 * Jina-only (no MusicBrainz), so safe to run alongside the live pipeline.
 *   npm run mb:embed            # drain all
 *   npm run mb:embed -- --batch=32
 */
import { getDB } from './itunes-ingest-core';
import { embedReleaseGroupsBatch, embeddingsEnabled } from './mb-enrich';

const num = (f: string, d: number) => { const a = process.argv.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const BATCH = num('--batch', 64);
const LIMIT = num('--limit', Infinity);

async function main() {
  if (!embeddingsEnabled()) { console.error('JINA_API_KEY not set in .env.local'); process.exit(1); }
  const db = getDB();
  let total = 0;
  for (;;) {
    const n = await embedReleaseGroupsBatch(db, BATCH);
    if (n === 0) break;
    if (n < 0) { console.log('\n  Jina error — re-run to resume.'); break; }
    total += n;
    process.stdout.write(`\r  embedded ${total} release_groups…`);
    if (total >= LIMIT) break;
  }
  console.log(`\n  done — ${total} embedded\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
