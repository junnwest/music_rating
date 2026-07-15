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
 *   npx tsx --env-file=.env.local scripts/reconcile-itunes-mb.ts            # dry — report only
 *   npx tsx --env-file=.env.local scripts/reconcile-itunes-mb.ts --apply    # writes mb_release_group_id
 */
import { getDB, releaseGroupKey } from './itunes-ingest-core';
import { browseReleaseGroups } from './mb-client';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// MB "album"/"single"/"ep" primary-type → our release_group_type vocabulary.
const mbType = (t: string | null) => (t ?? '').toLowerCase();
const daysApart = (a: string | null, b: string | null) => {
  if (!a || !b) return Infinity;
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
};

async function main() {
  const db = getDB();

  // iTunes-sourced groups still missing an MB linkage.
  let q = db.from('release_groups')
    .select('id, primary_artist_id, title, native_title, release_group_type, first_release_date')
    .eq('source', 'itunes').is('mb_release_group_id', null).order('first_release_date', { ascending: false });
  if (LIMIT) q = q.limit(parseInt(LIMIT, 10));
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  if (!rows?.length) { console.log('No unreconciled iTunes-sourced groups. Nothing to do.'); return; }

  // Group by artist so we browse each artist's MB catalog once.
  const byArtist = new Map<string, typeof rows>();
  for (const r of rows) (byArtist.get(r.primary_artist_id as string) ?? byArtist.set(r.primary_artist_id as string, []).get(r.primary_artist_id as string)!).push(r);

  console.log(`${APPLY ? 'APPLY' : 'DRY'} — ${rows.length} iTunes-sourced group(s) across ${byArtist.size} artist(s)\n`);

  let linked = 0, dupNeedsMerge = 0, noMatch = 0, noMbArtist = 0;

  for (const [artistId, groups] of byArtist) {
    // The artist's MB id (needed to browse their MB release groups).
    const { data: ext } = await db.from('artist_external_ids')
      .select('external_id').eq('artist_id', artistId).eq('source', 'musicbrainz').maybeSingle();
    if (!ext?.external_id) { noMbArtist += groups.length; continue; }

    const mbRgs = await browseReleaseGroups(ext.external_id as string);
    // Index MB groups by title-key → {mbid, date, type}.
    const mbByKey = new Map<string, { mbid: string; date: string | null; type: string }>();
    for (const rg of mbRgs as any[]) {
      const title = rg.title ?? '';
      const mbid = rg.id ?? rg.gid;
      if (!title || !mbid) continue;
      mbByKey.set(releaseGroupKey(title), {
        mbid,
        date: rg['first-release-date'] ?? rg.firstReleaseDate ?? null,
        type: mbType(rg['primary-type'] ?? rg.primaryType ?? null),
      });
    }

    for (const g of groups) {
      // Match on our title OR native_title key.
      const cand = mbByKey.get(releaseGroupKey(g.title as string))
        ?? (g.native_title ? mbByKey.get(releaseGroupKey(g.native_title as string)) : undefined);
      if (!cand) { noMatch++; continue; }
      // Confidence: title-key already matches; require type agreement OR release dates within a week
      // (guards against a same-titled but different release).
      const typeOk = cand.type === (g.release_group_type as string) || cand.type === '';
      const dateOk = daysApart(cand.date, g.first_release_date as string | null) <= 7;
      if (!typeOk && !dateOk) { noMatch++; continue; }

      // Is that mbid already on another row in our catalog? Then a real dup already exists → merge.
      const { data: existing } = await db.from('release_groups')
        .select('id').eq('mb_release_group_id', cand.mbid).maybeSingle();
      if (existing) {
        dupNeedsMerge++;
        console.log(`  ⚠ MERGE NEEDED: "${g.title}" — MB row ${cand.mbid.slice(0, 8)} already exists (${existing.id.slice(0, 8)}) alongside our iTunes row ${(g.id as string).slice(0, 8)}`);
        continue;
      }

      console.log(`  ${APPLY ? '✓ linked' : '→ would link'}: "${g.title}" → mbid ${cand.mbid.slice(0, 8)}`);
      if (APPLY) {
        const { error: upErr } = await db.from('release_groups')
          .update({ mb_release_group_id: cand.mbid }).eq('id', g.id).is('mb_release_group_id', null);
        if (upErr) { console.error(`     ! ${upErr.message}`); continue; }
      }
      linked++;
    }
    await sleep(300); // gentle on MB
  }

  console.log(`\n=== SUMMARY (${APPLY ? 'APPLIED' : 'DRY'}) ===`);
  console.log(`Linked to MB (dup prevented): ${linked}`);
  console.log(`Already-duplicated, manual merge needed: ${dupNeedsMerge}`);
  console.log(`No MB match yet (MB hasn't caught up): ${noMatch}`);
  console.log(`Artist has no MB id (can't reconcile): ${noMbArtist}`);
  if (!APPLY && linked) console.log(`\nRe-run with --apply to write the mb_release_group_id links.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
