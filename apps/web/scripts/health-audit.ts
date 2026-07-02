/* One-off full data-health audit. Read-only. npx tsx --env-file=.env.local scripts/health-audit.ts */
import { getDB } from './itunes-ingest-core';
const db = getDB();

const cnt = async (t: string, f?: (q: any) => any): Promise<number> => {
  let q = db.from(t).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  return (await q).count ?? 0;
};

// Distinct-value dangling-FK check: scales with distinct FK values, not total rows.
async function dangling(child: string, fk: string, parent: string, pk = 'id', filter?: (q: any) => any) {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    let q = db.from(child).select(fk).not(fk, 'is', null).order(fk).range(from, from + 999);
    if (filter) q = filter(q);
    const { data } = await q;
    if (!data?.length) break;
    for (const r of data) ids.add((r as any)[fk]);
    if (data.length < 1000) break;
  }
  const arr = [...ids];
  const exist = new Set<string>();
  for (let i = 0; i < arr.length; i += 100) {
    const { data } = await db.from(parent).select(pk).in(pk, arr.slice(i, i + 100));
    for (const r of data ?? []) exist.add((r as any)[pk]);
  }
  const bad = arr.filter(id => !exist.has(id));
  return { distinct: arr.length, dangling: bad.length, sample: bad.slice(0, 5) };
}
const line = (label: string, val: string | number, bad = false) => console.log(`  ${bad ? '✗' : '✓'} ${label.padEnd(46)} ${val}`);

async function main() {
  console.log('\n════ COUNTS ════');
  for (const t of ['artists', 'release_groups', 'releases', 'recordings', 'release_tracks', 'release_group_artists', 'artist_aliases', 'artist_external_ids', 'external_scores', 'ratings', 'artist_ingestion_queue'])
    console.log(`  ${t.padEnd(24)} ${await cnt(t)}`);

  console.log('\n════ NULL-FK (nulls allowed but flag volume) ════');
  line('release_groups.primary_artist_id NULL', await cnt('release_groups', q => q.is('primary_artist_id', null)));
  line('releases.release_group_id NULL (orphan)', await cnt('releases', q => q.is('release_group_id', null)));
  line('release_tracks.recording_id NULL', await cnt('release_tracks', q => q.is('recording_id', null)));
  line('release_tracks.release_id NULL', await cnt('release_tracks', q => q.is('release_id', null)));
  line('recordings.primary_artist_id NULL', await cnt('recordings', q => q.is('primary_artist_id', null)));
  line('ratings.release_group_id NULL', await cnt('ratings', q => q.is('release_group_id', null)));

  console.log('\n════ DANGLING-FK (points to non-existent parent — should be 0) ════');
  const d1 = await dangling('release_groups', 'primary_artist_id', 'artists'); line('release_groups.primary_artist_id → artists', `${d1.dangling}/${d1.distinct}${d1.dangling ? ' ' + JSON.stringify(d1.sample) : ''}`, d1.dangling > 0);
  const d2 = await dangling('release_group_artists', 'artist_id', 'artists'); line('release_group_artists.artist_id → artists', `${d2.dangling}/${d2.distinct}`, d2.dangling > 0);
  const d3 = await dangling('release_group_artists', 'release_group_id', 'release_groups'); line('release_group_artists.release_group_id → RG', `${d3.dangling}/${d3.distinct}`, d3.dangling > 0);
  const d4 = await dangling('ratings', 'release_group_id', 'release_groups'); line('ratings.release_group_id → RG', `${d4.dangling}/${d4.distinct}`, d4.dangling > 0);
  const d5 = await dangling('artist_external_ids', 'artist_id', 'artists'); line('artist_external_ids.artist_id → artists', `${d5.dangling}/${d5.distinct}`, d5.dangling > 0);
  const d6 = await dangling('artist_aliases', 'artist_id', 'artists'); line('artist_aliases.artist_id → artists', `${d6.dangling}/${d6.distinct}`, d6.dangling > 0);

  console.log('\n════ SOURCE PURITY ════');
  for (const t of ['release_groups', 'releases', 'recordings']) {
    const total = await cnt(t), mb = await cnt(t, q => q.eq('source', 'musicbrainz')), nul = await cnt(t, q => q.is('source', null)), dz = await cnt(t, q => q.eq('source', 'deezer')), it = await cnt(t, q => q.eq('source', 'itunes'));
    line(`${t} source`, `mb=${mb} deezer=${dz} itunes=${it} null=${nul} other=${total - mb - dz - it - nul}`, (total - mb - dz - it - nul) > 0);
  }

  console.log('\n════ SPECIAL-MBID LEAKS (Various Artists etc. — should be 0) ════');
  const specials = ['89ad4ac3-39f7-470e-963a-56509c546377', '125ec42a-7229-4250-afc5-e057484327fe', 'f731ccc4-e22a-43af-a747-64213329e088', 'eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61', '33cf029c-63b0-41a0-9855-be2a3665fb3b', '9be7f096-97ec-4615-8957-8d40b5dcbc41'];
  const leak = await cnt('artist_external_ids', q => q.in('external_id', specials));
  line('special MBIDs in artist_external_ids', leak, leak > 0);

  console.log('\n════ release_group_artists JOIN health ════');
  const rgaTotal = await cnt('release_group_artists');
  const rgaPrimary = await cnt('release_group_artists', q => q.eq('position', 0));
  const rgaEmptyName = await cnt('release_group_artists', q => q.eq('credited_as', ''));
  line('total credit rows', rgaTotal);
  line('position=0 (primary) rows', rgaPrimary);
  line('empty credited_as (should be 0)', rgaEmptyName, rgaEmptyName > 0);

  console.log('\n════ external_scores ════');
  const esTotal = await cnt('external_scores'), esNull = await cnt('external_scores', q => q.is('mb_release_group_id', null));
  line('total', esTotal); line('NULL mb_release_group_id', esNull);
  const esLinked = await dangling('external_scores', 'mb_release_group_id', 'release_groups', 'mb_release_group_id');
  line('MBID present but RG not ingested yet', `${esLinked.dangling}/${esLinked.distinct} (expected — artists not ingested)`);

  console.log('\n════ PRESTIGE ════');
  line('release_groups with prestige_score', await cnt('release_groups', q => q.not('prestige_score', 'is', null)));
  const badLo = await cnt('release_groups', q => q.lt('prestige_score', 0)), badHi = await cnt('release_groups', q => q.gt('prestige_score', 1));
  line('prestige_score out of [0,1]', badLo + badHi, (badLo + badHi) > 0);

  console.log('\n════ COVERAGE ════');
  const rgT = await cnt('release_groups');
  line('cover_url NULL', `${await cnt('release_groups', q => q.is('cover_url', null))}/${rgT}`);
  line('embedding NULL', `${await cnt('release_groups', q => q.is('embedding', null))}/${rgT}`);
  line('recordings ISRC NULL', `${await cnt('recordings', q => q.is('isrc', null))}/${await cnt('recordings')}`);

  console.log('\n════ QUEUE ════');
  for (const s of ['pending', 'processing', 'done', 'skipped', 'failed'])
    console.log(`  ${s.padEnd(12)} ${await cnt('artist_ingestion_queue', q => q.eq('status', s))}`);
  const stuck = await cnt('artist_ingestion_queue', q => q.eq('status', 'processing').lt('claimed_at', new Date(Date.now() - 30 * 60000).toISOString()));
  line('processing stuck >30min (should be ~0)', stuck, stuck > 2);

  console.log('\n════ ARTISTS ════');
  for (const s of ['pending_resolve', 'resolved', 'tracks_done', 'needs_review', 'failed'])
    console.log(`  ingest_state=${s.padEnd(16)} ${await cnt('artists', q => q.eq('ingest_state', s))}`);
  const aTot = await cnt('artists');
  line('artists.name NULL/empty', await cnt('artists', q => q.or('name.is.null,name.eq.')), false);
  line('artist avatar (cover_url) present', `${await cnt('artists', q => q.not('cover_url', 'is', null))}/${aTot}`);

  console.log('\n════ CANONICAL / EDITIONS (page releases) ════');
  const canonCount = new Map<string, number>(); const editionCount = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('releases').select('release_group_id, is_canonical').not('release_group_id', 'is', null).order('release_group_id').range(from, from + 999);
    if (!data?.length) break;
    for (const r of data as any[]) {
      editionCount.set(r.release_group_id, (editionCount.get(r.release_group_id) ?? 0) + 1);
      if (r.is_canonical) canonCount.set(r.release_group_id, (canonCount.get(r.release_group_id) ?? 0) + 1);
    }
    if (data.length < 1000) break;
  }
  const multiCanon = [...canonCount.values()].filter(n => n > 1).length;
  const zeroCanon = [...editionCount.keys()].filter(rg => !canonCount.has(rg)).length;
  line('release_groups with >1 canonical (must be 0)', multiCanon, multiCanon > 0);
  line('release_groups with editions but 0 canonical', zeroCanon, zeroCanon > 1);
  line('release_groups with ≥1 edition', editionCount.size);

  console.log('\n════ release_group_artists POSITION integrity (page) ════');
  const perGroup = new Map<string, number[]>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('release_group_artists').select('release_group_id, position').order('release_group_id').range(from, from + 999);
    if (!data?.length) break;
    for (const r of data as any[]) { const a = perGroup.get(r.release_group_id) ?? []; a.push(r.position); perGroup.set(r.release_group_id, a); }
    if (data.length < 1000) break;
  }
  let dupPos = 0, noPrimary = 0;
  for (const positions of perGroup.values()) {
    if (new Set(positions).size !== positions.length) dupPos++;
    if (!positions.includes(0)) noPrimary++;
  }
  line('groups with duplicate positions (must be 0)', dupPos, dupPos > 0);
  line('groups missing position 0 / primary', noPrimary, noPrimary > 0);

  console.log('\n════ external_scores field validity ════');
  line('normalized_score out of [0,1]', await cnt('external_scores', q => q.or('normalized_score.lt.0,normalized_score.gt.1')), true);
  line('source_tier not in {1,2,3}', await cnt('external_scores', q => q.not('source_tier', 'in', '(1,2,3)')), true);
  const scoped = await cnt('external_scores', q => q.not('scope_country', 'is', null));
  line('scope_country set (country-scoped)', `${scoped} (global: ${3319 - scoped})`);

  console.log('\n════ RATINGS validity ════');
  line('score out of [0,5]', await cnt('ratings', q => q.or('score.lt.0,score.gt.5')), true);

  console.log('\n════ RELEASE-GROUP TYPE distribution ════');
  for (const t of ['album', 'ep', 'single', 'broadcast', 'other'])
    console.log(`  ${t.padEnd(12)} ${await cnt('release_groups', q => q.eq('release_group_type', t))}`);
  const knownTypes = await cnt('release_groups', q => q.in('release_group_type', ['album', 'ep', 'single', 'broadcast', 'other']));
  line('unexpected release_group_type', (await cnt('release_groups')) - knownTypes, ((await cnt('release_groups')) - knownTypes) > 0);

  console.log('\n════ DONE ════');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
