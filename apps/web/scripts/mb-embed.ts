/**
 * Standalone EMBEDDINGS backfill — Jina v3 over release_groups missing an embedding.
 * Jina-only (no MusicBrainz), so safe to run alongside the live pipeline.
 *   npm run mb:embed                             # drain all types
 *   npm run mb:embed -- --types=album,ep         # the storage-aware default (see mb-enrich)
 *   npm run mb:embed -- --batch=32
 *
 * --types exists because embedding everything does not fit the plan: the HNSW index is already
 * 1,893 MB for 237,545 rows and the database sits at 6,923 MB of 12 GB. Album/EP only adds ~1.3 GB;
 * including singles adds ~3.1 GB and lands near 10 GB with the ingest backlog still to land.
 */
import { getDB } from './itunes-ingest-core';
import { embedReleaseGroupsBatch, embeddingsEnabled } from './mb-enrich';

const num = (f: string, d: number) => { const a = process.argv.find(x => x.startsWith(`${f}=`)); return a ? parseInt(a.split('=')[1], 10) : d; };
const BATCH = num('--batch', 64);
const LIMIT = num('--limit', Infinity);
const TYPES = process.argv.find(a => a.startsWith('--types='))?.split('=')[1]
  ?.split(',').map(t => t.trim()).filter(Boolean);

async function main() {
  if (!embeddingsEnabled()) { console.error('JINA_API_KEY not set in .env.local'); process.exit(1); }
  const db = getDB();
  // Keyset cursor: without it each batch scans past every row already embedded, and the query
  // eventually exceeds the statement timeout (which is how the first album/EP run died at 11,647
  // of 107,090).
  const cursor: { after?: string } = {};
  let total = 0;
  for (;;) {
    const n = await embedReleaseGroupsBatch(db, BATCH, TYPES, cursor);
    if (n === 0) break;
    if (n < 0) { console.log('\n  Jina error — re-run to resume.'); break; }
    total += n;
    process.stdout.write(`\r  embedded ${total} release_groups…`);
    if (total >= LIMIT) break;
  }
  console.log(`\n  done — ${total} embedded\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
