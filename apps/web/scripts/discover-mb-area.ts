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
 * --area catches the residual `country`-UNSET artists: MB tags many underground acts only with a
 * CITY area (e.g. 민수 → area:Seoul, country blank), which `country:KR` misses entirely. Pass one or
 * more (comma-separated, OR'd) area names to sweep them (dedup vs already-queued is automatic):
 *   npx tsx --env-file=.env.local scripts/discover-mb-area.ts --area="Seoul,Busan,Incheon" --dry-run
 *
 * Discovery itself is fast (100 artists/request); ingestion is the slow part, so it's fine to be
 * generous. Hits MusicBrainz (~1 req/s) — run during a pipeline pause, or accept brief contention.
 */
import { getDB, type DB } from './itunes-ingest-core';
import { searchArtistsByQuery } from './mb-client';
import { SPECIAL_MBIDS } from './mb-ingest';

export interface AreaDiscoverOpts {
  country?: string | null;   // e.g. 'KR' (ignored when `area` is set)
  area?: string | null;      // comma-separated city/area names, OR'd — catches country-null artists
  tag?: string | null;
  type?: string | null;      // 'group' | 'person'
  limit?: number;
  dryRun?: boolean;
  log?: (m: string) => void; // route output (console for CLI, lane logger for the pipeline)
}
export interface AreaDiscoverResult { query: string; found: number; queued: number; skipHave: number; skipQueued: number }

function buildQuery(o: AreaDiscoverOpts): string {
  // area overrides country: catches artists MB tagged by city with no country (the residual gap).
  const scope = o.area
    ? `(${o.area.split(',').map(a => `area:"${a.trim()}"`).join(' OR ')})`
    : `country:${o.country ?? 'KR'}`;
  const parts = [scope];
  if (o.tag) parts.push(`tag:"${o.tag}"`);
  if (o.type) parts.push(`type:${o.type}`);
  return parts.join(' AND ');
}

/**
 * Sweep MB for artists in a country/area and QUEUE (source='mbid') any we don't already have or
 * haven't queued. ONE implementation shared by the CLI and the pipeline `area` lane. Idempotent
 * (dedup vs catalog + queue), so a re-run queues only what's genuinely new. Throws on a real DB
 * error (never process.exit) so the lane supervisor can react.
 */
export async function discoverArea(db: DB, o: AreaDiscoverOpts): Promise<AreaDiscoverResult> {
  const log = o.log ?? (() => {});
  const limit = o.limit ?? Infinity;
  const query = buildQuery(o);

  // Page MB, collecting (mbid, name). MBID is authoritative — no name resolution.
  const found = new Map<string, string>(); // mbid → name
  const PER = 100;
  for (let offset = 0; ; offset += PER) {
    const page = await searchArtistsByQuery(query, PER, offset);
    const total = page.count;
    if (!page.artists.length) break;
    for (const a of page.artists) {
      if (!SPECIAL_MBIDS.has(a.id)) found.set(a.id, a.name);
      if (found.size >= limit) break;
    }
    if (offset % 2000 === 0 || found.size >= limit || offset + PER >= total)
      log(`fetched ${Math.min(offset + PER, total)}/${total} (kept ${found.size})`);
    if (found.size >= limit || offset + PER >= total) break;
  }
  log(`query="${query}" → ${found.size} artists`);

  // Skip MBIDs already in the catalog (any ingest state) or already queued as 'mbid'.
  const mbids = [...found.keys()];
  const have = new Set<string>();
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_external_ids')
      .select('external_id').eq('source', 'musicbrainz').in('external_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) have.add((r as any).external_id);
  }
  const queued = new Set<string>(); // batched .in() — a plain select caps at PostgREST's 1000-row default
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_ingestion_queue').select('source_id').eq('source', 'mbid').in('source_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) queued.add((r as any).source_id);
  }

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

  log(`to queue: ${rows.length} (skipped ${skipHave} already-in-catalog, ${skipQueued} already-queued)${o.dryRun ? ' [DRY RUN]' : ''}`);
  if (o.dryRun) {
    log('sample: ' + rows.slice(0, 12).map(r => r.name).join(', '));
    return { query, found: found.size, queued: 0, skipHave, skipQueued };
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('artist_ingestion_queue')
      .upsert(rows.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
    if (error) throw new Error(`queue upsert batch ${i}: ${error.message}`);
  }
  return { query, found: found.size, queued: rows.length, skipHave, skipQueued };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const db = getDB();
  const r = await discoverArea(db, {
    country: arg('--country') ?? 'KR',
    area: arg('--area') ?? null,
    tag: arg('--tag') ?? null,
    type: arg('--type') ?? null,
    limit: arg('--limit') ? parseInt(arg('--limit')!, 10) : undefined,
    dryRun: args.includes('--dry-run'),
    log: (m) => console.log('[discover-mb-area] ' + m),
  });
  if (!args.includes('--dry-run')) {
    const { count } = await db.from('artist_ingestion_queue')
      .select('id', { count: 'exact', head: true }).eq('source', 'mbid').eq('status', 'pending');
    console.log(`[discover-mb-area] queued ${r.queued}. Total source='mbid' pending: ${count}.`);
  }
}

// Only run the CLI when invoked directly (not when the pipeline lane imports discoverArea).
if (process.argv[1]?.endsWith('discover-mb-area.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
