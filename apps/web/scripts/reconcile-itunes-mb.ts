/**
 * Reconciliation — the safety net for the iTunes recency lane (discover-itunes-recency.ts).
 *
 * The recency lane ingests recent releases from iTunes with source='itunes' and mb_release_group_id
 * NULL, because MusicBrainz doesn't have them yet. When MB later catalogs the same release, the MB
 * ingest lane's findOrCreateReleaseGroup upserts BY mb_release_group_id — so it would create a
 * SECOND row (it can't see our iTunes row, which has no mbid) → a cross-source duplicate.
 *
 * This pass prevents that WITHOUT any merge or data move: for each source='itunes' group that MB now
 * has, we fill in its mb_release_group_id. Once set, MB's upsert-by-mbid dedups against our existing
 * row instead of creating a new one — the duplicate never forms. We only ever write ONE FK column,
 * only on a CONFIDENT, artist-scoped match (missing > wrong: no confident match → leave it for next
 * run). If MB already created its own separate row (mbid already present in our DB), that's a real
 * pre-existing duplicate we do NOT auto-merge — we report it for a deliberate manual merge.
 *
 * Runs as a scheduled pipeline lane (reconcileLoop in pipeline.ts) and as this CLI:
 *   npx tsx --env-file=.env.local scripts/reconcile-itunes-mb.ts            # dry — report only
 *   npx tsx --env-file=.env.local scripts/reconcile-itunes-mb.ts --apply    # writes mb_release_group_id
 */
import { getDB, releaseGroupKey, type DB } from './itunes-ingest-core';
import { browseReleaseGroups } from './mb-client';

export interface ReconcileResult { linked: number; dupNeedsMerge: number; noMatch: number; noMbArtist: number }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const daysApart = (a: string | null, b: string | null) => {
  if (!a || !b) return Infinity;
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
};

/**
 * Link source='itunes' groups to their MB mbid once MB has the release. Reused by the CLI and the
 * pipeline reconcileLoop. `log` lets the caller route output (console for CLI, lane logger for the
 * pipeline). Gentle on MB (browses each artist's release groups once).
 */
export async function reconcileItunesMb(
  db: DB, opts: { apply: boolean; limit?: number; log?: (m: string) => void },
): Promise<ReconcileResult> {
  const log = opts.log ?? (() => {});
  const res: ReconcileResult = { linked: 0, dupNeedsMerge: 0, noMatch: 0, noMbArtist: 0 };

  let q = db.from('release_groups')
    .select('id, primary_artist_id, title, native_title, release_group_type, first_release_date')
    .eq('source', 'itunes').is('mb_release_group_id', null).order('first_release_date', { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  if (!rows?.length) return res;

  const byArtist = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.primary_artist_id as string;
    (byArtist.get(k) ?? byArtist.set(k, []).get(k)!).push(r);
  }

  for (const [artistId, groups] of byArtist) {
    const { data: ext } = await db.from('artist_external_ids')
      .select('external_id').eq('artist_id', artistId).eq('source', 'musicbrainz').maybeSingle();
    if (!ext?.external_id) { res.noMbArtist += groups.length; continue; }

    const mbRgs = await browseReleaseGroups(ext.external_id as string);
    const mbByKey = new Map<string, { mbid: string; date: string | null; type: string }>();
    for (const rg of mbRgs as any[]) {
      const title = rg.title ?? '';
      const mbid = rg.id ?? rg.gid;
      if (!title || !mbid) continue;
      mbByKey.set(releaseGroupKey(title), {
        mbid,
        date: rg['first-release-date'] ?? rg.firstReleaseDate ?? null,
        type: (rg['primary-type'] ?? rg.primaryType ?? '').toLowerCase(),
      });
    }

    for (const g of groups) {
      const cand = mbByKey.get(releaseGroupKey(g.title as string))
        ?? (g.native_title ? mbByKey.get(releaseGroupKey(g.native_title as string)) : undefined);
      if (!cand) { res.noMatch++; continue; }
      const typeOk = cand.type === (g.release_group_type as string) || cand.type === '';
      const dateOk = daysApart(cand.date, g.first_release_date as string | null) <= 7;
      if (!typeOk && !dateOk) { res.noMatch++; continue; }

      const { data: existing } = await db.from('release_groups')
        .select('id').eq('mb_release_group_id', cand.mbid).maybeSingle();
      if (existing) {
        res.dupNeedsMerge++;
        log(`⚠ MERGE NEEDED: "${g.title}" — MB row ${cand.mbid.slice(0, 8)} already exists (${(existing.id as string).slice(0, 8)}) alongside iTunes row ${(g.id as string).slice(0, 8)}`);
        continue;
      }

      log(`${opts.apply ? '✓ linked' : '→ would link'}: "${g.title}" → mbid ${cand.mbid.slice(0, 8)}`);
      if (opts.apply) {
        const { error: upErr } = await db.from('release_groups')
          .update({ mb_release_group_id: cand.mbid }).eq('id', g.id).is('mb_release_group_id', null);
        if (upErr) { log(`  ! ${upErr.message}`); continue; }
      }
      res.linked++;
    }
    await sleep(300);
  }
  return res;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const LIMIT = args.find(a => a.startsWith('--limit='))?.split('=')[1];
  const db = getDB();
  console.log(`${APPLY ? 'APPLY' : 'DRY'} — reconciling iTunes-sourced groups against MusicBrainz…\n`);
  const r = await reconcileItunesMb(db, { apply: APPLY, limit: LIMIT ? parseInt(LIMIT, 10) : undefined, log: (m) => console.log('  ' + m) });
  console.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY'}) ===`);
  console.log(`Linked to MB (dup prevented): ${r.linked}`);
  console.log(`Already-duplicated, manual merge needed: ${r.dupNeedsMerge}`);
  console.log(`No MB match yet (MB hasn't caught up): ${r.noMatch}`);
  console.log(`Artist has no MB id (can't reconcile): ${r.noMbArtist}`);
  if (!APPLY && r.linked) console.log(`\nRe-run with --apply to write the mb_release_group_id links.`);
}

if (process.argv[1]?.endsWith('reconcile-itunes-mb.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
