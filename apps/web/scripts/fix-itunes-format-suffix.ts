/**
 * Remove iTunes' " - Single" / " - EP" format label from release-group titles.
 *
 *   npx tsx --env-file=.env.local scripts/fix-itunes-format-suffix.ts
 *   npx tsx --env-file=.env.local scripts/fix-itunes-format-suffix.ts --apply
 *
 * WHY. iTunes appends the format to collection names, so artist pages read "Fire - Single",
 * "Pump It Up - Single". The format is already in release_group_type; the suffix is noise that
 * reached users. 5,725 rows had it (5,356 from iTunes, 367 from other sources). Fixed at the
 * source in itunes-ingest-core.stripItunesFormatSuffix; this cleans the rows already written.
 *
 * WHY NOT ONE UPDATE STATEMENT. The obvious `update … where not exists (…)` has to evaluate a
 * correlated subquery against 837k release groups per candidate row and blows the Management API's
 * statement timeout. Doing the collision check in memory costs one read and then only the updates
 * that are actually needed.
 *
 * COLLISIONS ARE LEFT ALONE. ~310 rows strip down to a title the SAME ARTIST already has — those
 * are the same release stored twice, once with the suffix. Renaming them would produce two
 * identical titles and hide the duplicate; they are reported instead, for dedup-by-duration to
 * arbitrate on track durations.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SUFFIX = /\s+-\s+(Single|EP)$/i;
const OUT = 'scripts/data/itunes-suffix-collisions.json';

async function main() {
  console.log(`\n  iTunes format suffix${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  // 1. every row carrying the suffix (paged — PostgREST caps at 1,000)
  const rows: { id: string; title: string; primary_artist_id: string | null }[] = [];
  let after = '';
  for (;;) {
    let q = db.from('release_groups').select('id, title, primary_artist_id')
      .ilike('title', '% - Single').order('id').limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as any[]));
    after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  after = '';
  for (;;) {
    let q = db.from('release_groups').select('id, title, primary_artist_id')
      .ilike('title', '% - EP').order('id').limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as any[]));
    after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  const candidates = rows.filter(r => SUFFIX.test(r.title ?? ''));
  console.log(`  ${candidates.length} row(s) carry the suffix`);

  // 2. existing titles per artist, so a collision can be detected without a per-row query
  const artistIds = [...new Set(candidates.map(c => c.primary_artist_id).filter(Boolean))] as string[];
  const existing = new Map<string, Set<string>>();   // artistId -> lowercased titles
  for (let i = 0; i < artistIds.length; i += 100) {
    const chunk = artistIds.slice(i, i + 100);
    let cur = '';
    for (;;) {
      let q = db.from('release_groups').select('id, title, primary_artist_id')
        .in('primary_artist_id', chunk).order('id').limit(1000);
      if (cur) q = q.gt('id', cur);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data as any[]) {
        if (!r.primary_artist_id) continue;
        if (!existing.has(r.primary_artist_id)) existing.set(r.primary_artist_id, new Set());
        existing.get(r.primary_artist_id)!.add(String(r.title ?? '').toLowerCase());
      }
      cur = (data[data.length - 1] as any).id;
      if (data.length < 1000) break;
    }
    if (i && i % 500 === 0) console.log(`    …loaded titles for ${i}/${artistIds.length} artists`);
  }

  const collisions: { id: string; title: string; clean: string }[] = [];
  const safe: { id: string; clean: string }[] = [];
  for (const c of candidates) {
    const clean = c.title.replace(SUFFIX, '').trim();
    if (!clean) continue;
    const taken = c.primary_artist_id ? existing.get(c.primary_artist_id) : null;
    if (taken?.has(clean.toLowerCase())) collisions.push({ id: c.id, title: c.title, clean });
    else safe.push({ id: c.id, clean });
  }
  console.log(`  safe to rename:      ${safe.length}`);
  console.log(`  collide (duplicates): ${collisions.length}  → ${OUT}`);
  try { fs.writeFileSync(OUT, JSON.stringify(collisions, null, 2)); } catch { /* best effort */ }

  if (!APPLY) { console.log('\n  (report only — re-run with --apply to write)'); return; }

  let done = 0, failed = 0;
  for (const s of safe) {
    const { error } = await db.from('release_groups').update({ title: s.clean }).eq('id', s.id);
    if (error) { failed++; if (failed <= 3) console.warn(`    ! ${s.id}: ${error.message}`); }
    else done++;
    if (done % 500 === 0 && done) console.log(`    renamed ${done}/${safe.length}`);
  }
  console.log(`\n  renamed ${done}${failed ? `, ${failed} failed` : ''}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
