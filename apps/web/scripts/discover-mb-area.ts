/**
 * Catalog expansion — comprehensive area/scene discovery straight from MusicBrainz.
 *
 * Name-based seeding structurally misses artists whose MB primary name is non-Latin (most Korean
 * artists are stored under Hangul). This pulls them by a Lucene query and queues each by the MBID
 * in the result (source='mbid' → MBID-direct ingest), so Hangul-named artists come along for free.
 *
 * MB has ~15,540 `country:KR` artists vs the ~525 we had — this is how you close that gap.
 *
 *   npx tsx --env-file=.env.local scripts/discover-mb-area.ts --country=KR --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-mb-area.ts --country=KR --tag="hip hop"
 *   npx tsx --env-file=.env.local scripts/discover-mb-area.ts --country=KR --limit=5000
 *
 * Discovery itself is fast (100 artists/request); ingestion is the slow part, so it's fine to be
 * generous. Hits MusicBrainz (~1 req/s) — run during a pipeline pause, or accept brief contention.
 */
import { getDB } from './itunes-ingest-core';
import { searchArtistsByQuery } from './mb-client';
import { SPECIAL_MBIDS } from './mb-ingest';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const COUNTRY = arg('--country') ?? 'KR';
const TAG = arg('--tag') ?? null;
const TYPE = arg('--type') ?? null;               // 'group' | 'person' (optional)
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : Infinity;

function buildQuery(): string {
  const parts = [`country:${COUNTRY}`];
  if (TAG) parts.push(`tag:"${TAG}"`);
  if (TYPE) parts.push(`type:${TYPE}`);
  return parts.join(' AND ');
}

async function main() {
  const db = getDB();
  const query = buildQuery();

  // Page MB, collecting (mbid, name). MBID is authoritative — no name resolution.
  const found = new Map<string, string>(); // mbid → name
  const PER = 100;
  let total = 0;
  for (let offset = 0; ; offset += PER) {
    const page = await searchArtistsByQuery(query, PER, offset);
    total = page.count;
    if (!page.artists.length) break;
    for (const a of page.artists) {
      if (!SPECIAL_MBIDS.has(a.id)) found.set(a.id, a.name);
      if (found.size >= LIMIT) break;
    }
    process.stdout.write(`\r  fetched ${Math.min(offset + PER, total)}/${total}  (kept ${found.size})   `);
    if (found.size >= LIMIT || offset + PER >= total) break;
  }
  console.log(`\n[discover-mb-area] query="${query}" → ${found.size} artists`);

  // Skip MBIDs already in the catalog (any ingest state) or already queued as 'mbid'.
  const mbids = [...found.keys()];
  const have = new Set<string>();
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_external_ids')
      .select('external_id').eq('source', 'musicbrainz').in('external_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) have.add((r as any).external_id);
  }
  const { data: q } = await db.from('artist_ingestion_queue').select('source_id').eq('source', 'mbid');
  const queued = new Set((q ?? []).map((r: any) => r.source_id));

  const usedNames = new Set<string>();
  const rows: { name: string; source: string; source_id: string; status: string }[] = [];
  let skipHave = 0, skipQueued = 0;
  for (const [mbid, name] of found) {
    if (have.has(mbid)) { skipHave++; continue; }
    if (queued.has(mbid)) { skipQueued++; continue; }
    let n = name;
    if (usedNames.has(n.toLowerCase())) n = `${name} (${mbid.slice(0, 6)})`;
    usedNames.add(n.toLowerCase());
    rows.push({ name: n, source: 'mbid', source_id: mbid, status: 'pending' });
  }

  console.log(`[discover-mb-area] to queue: ${rows.length}  (skipped ${skipHave} already-in-catalog, ${skipQueued} already-queued)${DRY ? '  [DRY RUN]' : ''}`);
  if (DRY) { console.log('  sample:', rows.slice(0, 12).map(r => r.name).join(', ')); return; }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('artist_ingestion_queue')
      .upsert(rows.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
    if (error) { console.error(`  ! batch ${i}: ${error.message}`); process.exit(1); }
  }
  const { count } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('source', 'mbid').eq('status', 'pending');
  console.log(`[discover-mb-area] queued ${rows.length}. Total source='mbid' pending: ${count}.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
