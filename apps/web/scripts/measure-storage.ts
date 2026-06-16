/**
 * One-off storage estimator. Counts rows + samples row sizes to estimate how
 * much of Supabase's disk the big columns are using. Read-only.
 *
 * npx tsx --env-file=.env.local scripts/measure-storage.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase env not set');
const db = createClient(url, key);

function fmt(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) { console.log(`  ${table}: ERROR ${error.message}`); return 0; }
  return count ?? 0;
}

async function main() {
  console.log('\n  sillajuku storage estimate (row counts + sampled sizes)\n');

  const totalReleases = await count('releases');
  const withEmbedding = await count('releases', q => q.not('embedding', 'is', null));
  const withTracklist = await count('releases', q => q.not('tracklist', 'is', null));
  const nullTracklist = await count('releases', q => q.is('tracklist', null));

  console.log(`  releases (total)        : ${totalReleases.toLocaleString()}`);
  console.log(`  • with embedding        : ${withEmbedding.toLocaleString()}`);
  console.log(`  • with tracklist        : ${withTracklist.toLocaleString()}`);
  console.log(`  • null tracklist        : ${nullTracklist.toLocaleString()}\n`);

  // Sample tracklist JSON sizes (avg bytes) from rows that have one.
  const { data: sample } = await db
    .from('releases')
    .select('tracklist')
    .not('tracklist', 'is', null)
    .limit(500);
  let avgTracklistBytes = 0;
  if (sample && sample.length > 0) {
    const total = sample.reduce((s, r) => s + Buffer.byteLength(JSON.stringify(r.tracklist ?? [])), 0);
    avgTracklistBytes = total / sample.length;
  }

  // Embedding: vector(1024) stored as float4 → 1024 * 4 bytes + small header.
  const embeddingBytesPerRow = 1024 * 4;

  console.log('  ── Estimated column footprints (heap, excl. indexes) ──');
  console.log(`  embeddings              : ~${fmt(withEmbedding * embeddingBytesPerRow)}  (${embeddingBytesPerRow} B/row × ${withEmbedding.toLocaleString()})`);
  console.log(`    + HNSW index (≈1–2×)  : ~${fmt(withEmbedding * embeddingBytesPerRow * 1.5)}`);
  console.log(`  tracklists (current)    : ~${fmt(withTracklist * avgTracklistBytes)}  (~${avgTracklistBytes.toFixed(0)} B/row avg)`);
  console.log(`  tracklists (if all back-filled non-singles): ~${fmt((withTracklist + nullTracklist) * (avgTracklistBytes || 1200))}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
