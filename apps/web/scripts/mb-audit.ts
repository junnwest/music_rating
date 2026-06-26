/**
 * Read-only data-quality audit of the MB-ingested catalog. No writes.
 *   npx tsx --env-file=.env.local scripts/mb-audit.ts
 */
import { getDB } from './itunes-ingest-core';

type DB = ReturnType<typeof getDB>;
async function cnt(db: DB, table: string, f?: (q: any) => any): Promise<number> {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  const { count } = await q;
  return count ?? 0;
}

async function main() {
  const db = getDB();

  // ── counts ──
  const tables = ['artists', 'release_groups', 'releases', 'recordings', 'release_tracks', 'artist_aliases', 'artist_external_ids'];
  console.log('\n  ── counts ──');
  for (const t of tables) console.log(`    ${t.padEnd(20)} ${await cnt(db, t)}`);

  // ── source purity (everything should be musicbrainz; no iTunes leftovers) ──
  console.log('\n  ── source purity ──');
  for (const t of ['release_groups', 'releases', 'recordings']) {
    const mb = await cnt(db, t, q => q.eq('source', 'musicbrainz'));
    const nullSrc = await cnt(db, t, q => q.is('source', null));
    const total = await cnt(db, t);
    console.log(`    ${t.padEnd(16)} musicbrainz=${mb}  null=${nullSrc}  other=${total - mb - nullSrc}`);
  }

  // ── ISRC density ──
  const recTotal = await cnt(db, 'recordings');
  const recIsrc = await cnt(db, 'recordings', q => q.not('isrc', 'is', null));
  console.log(`\n  ── ISRC ──\n    ${recIsrc}/${recTotal} recordings have ISRC (${Math.round(100 * recIsrc / Math.max(recTotal, 1))}%)`);

  // ── artists: ingest_state, source_status, dup names, sample ──
  const { data: artists } = await db.from('artists').select('id, name, ingest_state, source_status, disambiguation, country, created_at').order('created_at');
  const A = artists ?? [];
  const byState: Record<string, number> = {};
  for (const a of A) byState[a.ingest_state] = (byState[a.ingest_state] ?? 0) + 1;
  console.log('\n  ── artists ingest_state ──');
  for (const [s, n] of Object.entries(byState)) console.log(`    ${s.padEnd(18)} ${n}`);

  const nameCounts: Record<string, number> = {};
  for (const a of A) nameCounts[a.name.toLowerCase()] = (nameCounts[a.name.toLowerCase()] ?? 0) + 1;
  const dups = Object.entries(nameCounts).filter(([, n]) => n > 1);
  console.log(`\n  ── duplicate artist names ──\n    ${dups.length ? dups.map(([n, c]) => `${n}×${c}`).join(', ') : 'none'}`);

  console.log('\n  ── sample artists (eyeball for false matches) ──');
  for (const a of A.slice(-20)) console.log(`    ${a.name.padEnd(22)} ${(a.disambiguation ?? '').padEnd(40)} ${a.country ?? ''}`);

  // ── canonical integrity: each release_group must have exactly 1 canonical edition ──
  let from = 0; const rels: { release_group_id: string; is_canonical: boolean }[] = [];
  for (;;) {
    const { data } = await db.from('releases').select('release_group_id, is_canonical').range(from, from + 999);
    if (!data || data.length === 0) break;
    rels.push(...data as any);
    from += data.length;
    if (data.length < 1000) break;
  }
  const canonPerGroup: Record<string, number> = {};
  const editionsPerGroup: Record<string, number> = {};
  for (const r of rels) {
    editionsPerGroup[r.release_group_id] = (editionsPerGroup[r.release_group_id] ?? 0) + 1;
    if (r.is_canonical) canonPerGroup[r.release_group_id] = (canonPerGroup[r.release_group_id] ?? 0) + 1;
  }
  const totalGroups = await cnt(db, 'release_groups');
  const groupsWithEditions = Object.keys(editionsPerGroup).length;
  const multiCanon = Object.values(canonPerGroup).filter(n => n > 1).length;
  const groupsNoCanon = groupsWithEditions - Object.keys(canonPerGroup).length;
  const groupsNoEditions = totalGroups - groupsWithEditions;
  console.log('\n  ── canonical / editions integrity ──');
  console.log(`    release_groups:            ${totalGroups}`);
  console.log(`    groups with ≥1 edition:    ${groupsWithEditions}`);
  console.log(`    groups with NO edition:    ${groupsNoEditions}  (MB RG had no releases — no tracklist/cover)`);
  console.log(`    groups with >1 canonical:  ${multiCanon}   (must be 0)`);
  console.log(`    groups with 0 canonical:   ${groupsNoCanon}   (must be 0 among groups with editions)`);

  // ── queue: skipped / failed reasons ──
  const { data: skipped } = await db.from('artist_ingestion_queue').select('name, status, error').in('status', ['skipped', 'failed']).limit(50);
  console.log(`\n  ── skipped/failed (${skipped?.length ?? 0}) ──`);
  for (const s of skipped ?? []) console.log(`    ${String(s.status).padEnd(8)} ${String(s.name).padEnd(24)} ${s.error ?? ''}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
