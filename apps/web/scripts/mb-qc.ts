/**
 * QC helpers — DB-only (no MusicBrainz), so they run concurrently with INGEST without
 * contending for the 1-req/s MB budget. Used by the pipeline's QC lane (pipeline.ts).
 *
 *   integrityCheck(db)   → a structured snapshot of the same invariants `mb-audit` prints,
 *                          with an `ok` flag + a list of anomalies (for the heartbeat).
 *   requeueFailures(db)  → reset transiently-failed queue rows back to 'pending' so the
 *                          INGEST lane retries them, capped by attempt_count (self-healing).
 */
import type { DB } from './itunes-ingest-core';

async function cnt(db: DB, table: string, f?: (q: any) => any): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  const { count } = await q;
  return count ?? 0;
}

export interface IntegrityResult {
  ok: boolean;
  anomalies: string[];           // human-readable, '' when clean
  dupArtists: number;
  multiCanon: number;            // release_groups with >1 canonical edition (must be 0)
  noCanon: number;               // groups with editions but 0 canonical (must be 0)
  nonMbSources: number;          // release_groups/releases/recordings not source='musicbrainz'/'itunes'
  emptyArtists: number;          // tracks_done artists with 0 release_groups (false-match leftovers)
  orphanReleases: number;        // releases with null release_group_id (not from the pipeline)
}

/** Read-only invariant check — mirrors the mb-audit integrity section, structured. */
export async function integrityCheck(db: DB): Promise<IntegrityResult> {
  // duplicate artist names (paginated — catalog grows past 1000)
  const names: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('artists').select('name').range(from, from + 999);
    if (!data?.length) break;
    names.push(...data.map((r: any) => r.name.toLowerCase()));
    if (data.length < 1000) break;
  }
  const nameCounts: Record<string, number> = {};
  for (const n of names) nameCounts[n] = (nameCounts[n] ?? 0) + 1;
  const dupArtists = Object.values(nameCounts).filter(n => n > 1).length;

  // canonical integrity (paginated). Orphan releases (null release_group_id — e.g. bare rows
  // from the web search-insert path) are NOT groups, so they're counted separately, not as
  // "0-canonical groups", to keep the canonical signal about genuine pipeline writes.
  const canonPerGroup: Record<string, number> = {};
  const editionsPerGroup: Record<string, number> = {};
  let orphanReleases = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('releases').select('release_group_id, is_canonical').range(from, from + 999);
    if (!data?.length) break;
    for (const r of data as any[]) {
      if (!r.release_group_id) { orphanReleases++; continue; }
      editionsPerGroup[r.release_group_id] = (editionsPerGroup[r.release_group_id] ?? 0) + 1;
      if (r.is_canonical) canonPerGroup[r.release_group_id] = (canonPerGroup[r.release_group_id] ?? 0) + 1;
    }
    if (data.length < 1000) break;
  }
  const multiCanon = Object.values(canonPerGroup).filter(n => n > 1).length;
  const noCanon = Object.keys(editionsPerGroup).length - Object.keys(canonPerGroup).length;

  // source purity — 'musicbrainz' (INGEST) and 'itunes' (GAPFILL) are both legitimate
  // provenance; anything else (or an untagged row) is a real anomaly.
  let nonMbSources = 0;
  for (const t of ['release_groups', 'releases', 'recordings']) {
    nonMbSources += await cnt(db, t, q => q.not('source', 'in', '("musicbrainz","itunes")'));
  }

  // tracks_done artists with 0 release_groups (the old-TXT false-match shape).
  // Build the set of artists-that-have-RGs from a FULL paginated scan — a per-batch
  // `.in()` query truncates at the 1000-row default and falsely reports artists as empty
  // when a batch's groups exceed 1000 (prolific artists). Paginate like the canonical check.
  let emptyArtists = 0;
  {
    const haveRg = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('release_groups').select('primary_artist_id').range(from, from + 999);
      if (!data?.length) break;
      for (const r of data as any[]) if (r.primary_artist_id) haveRg.add(r.primary_artist_id);
      if (data.length < 1000) break;
    }
    let from = 0;
    for (;;) {
      const { data } = await db.from('artists').select('id').eq('ingest_state', 'tracks_done').range(from, from + 999);
      if (!data?.length) break;
      emptyArtists += (data as any[]).filter(a => !haveRg.has(a.id)).length;
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  const anomalies: string[] = [];
  if (dupArtists) anomalies.push(`${dupArtists} duplicate artist name(s)`);
  if (multiCanon) anomalies.push(`${multiCanon} group(s) with >1 canonical`);
  if (noCanon) anomalies.push(`${noCanon} group(s) with 0 canonical`);
  if (nonMbSources) anomalies.push(`${nonMbSources} unexpected-source row(s)`);
  if (emptyArtists) anomalies.push(`${emptyArtists} tracks_done artist(s) with 0 release_groups`);
  if (orphanReleases) anomalies.push(`${orphanReleases} orphan release(s) (null release_group_id — non-pipeline)`);

  return { ok: anomalies.length === 0, anomalies, dupArtists, multiCanon, noCanon, nonMbSources, emptyArtists, orphanReleases };
}

export interface RequeueResult {
  requeued: number;
  capped: number;            // failed rows left alone (hit maxAttempts)
  needsMigration: boolean;   // attempt_count column not present yet
}

/**
 * Reset failed queue rows → pending so INGEST retries them, capped by attempt_count
 * (rows at the cap are left failed). Needs `artist_ingestion_queue.attempt_count`
 * (migration 20260626000001); degrades to a no-op + needsMigration flag if absent.
 */
export async function requeueFailures(db: DB, maxAttempts = 5): Promise<RequeueResult> {
  const { data, error } = await db
    .from('artist_ingestion_queue')
    .select('id, attempt_count')
    .eq('status', 'failed')
    .limit(500);
  if (error) {
    // most likely: attempt_count column doesn't exist yet
    if (/attempt_count/.test(error.message)) return { requeued: 0, capped: 0, needsMigration: true };
    throw error;
  }
  let requeued = 0, capped = 0;
  for (const row of data ?? []) {
    const attempts = (row as any).attempt_count ?? 0;
    if (attempts >= maxAttempts) { capped++; continue; }
    await db.from('artist_ingestion_queue')
      .update({ status: 'pending', error: null, processed_at: null, attempt_count: attempts + 1 })
      .eq('id', (row as any).id);
    requeued++;
  }
  return { requeued, capped, needsMigration: false };
}

/**
 * Recompute artists.ingest_priority (hot/active/known/dormant) + next_check_at from release
 * recency + engagement, so FRESHNESS re-polls active artists fast and dormant ones rarely.
 * One server-side statement (migration 20260626000004); returns rows reprioritized, or
 * needsMigration if the function isn't installed yet.
 */
export async function recomputePriorities(db: DB): Promise<{ updated: number; needsMigration: boolean }> {
  const { data, error } = await db.rpc('recompute_ingest_priorities');
  if (error) {
    // Only "function not installed" → needsMigration. A real SQL error must surface, not hide.
    if (/could not find the function|function .*does not exist|schema cache/i.test(error.message)) return { updated: 0, needsMigration: true };
    throw error;
  }
  return { updated: (data as number) ?? 0, needsMigration: false };
}

// ── CLI: `npm run mb:qc` (integrity snapshot) / `npm run mb:tiers` (reprioritize) ──
async function main() {
  const { getDB } = await import('./itunes-ingest-core');
  const db = getDB();
  if (process.argv.includes('--tiers')) {
    const t = await recomputePriorities(db);
    console.log(t.needsMigration ? '\n  tiers: migration 20260626000004 not applied\n' : `\n  tiers: ${t.updated} artists reprioritized\n`);
    return;
  }
  const integ = await integrityCheck(db);
  console.log(`\n  integrity: ${integ.ok ? 'OK' : 'ANOMALIES — ' + integ.anomalies.join('; ')}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('mb-qc.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
