/**
 * Link unlinked external_scores critic-list entries to catalog release_groups (2026-07-05).
 *
 * Many critic-list entries (esp. Korean webzines) have mb_release_group_id = NULL, so their critical
 * signal never reaches the catalog — the root cause of the thin Korean/Japanese critical coverage.
 * This matches each unlinked entry to a release_group by (title × artist × year) using the normalized
 * search RPC, and — only on a CONFIDENT match — sets mb_release_group_id. Improves real critic charts
 * and the critic-affiliation view; no scraping, no new data.
 *
 * Confidence (precision over recall — a wrong link pollutes the critic signal):
 *   • normalized title equals the entry's album_title on EITHER title or native_title, AND
 *   • release year within ±1, AND
 *   • artist matches (normalized artist_display/native contains the entry artist) OR the title+year
 *     match is unique among candidates.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-external-score-links.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-external-score-links.ts --apply
 */
import { getDB } from './itunes-ingest-core';
import { CRITICAL_SOURCES } from './data/external-score-sources';
const db = getDB();
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const yearOf = (d: string | null) => d ? parseInt(String(d).slice(0, 4), 10) : NaN;

async function pageAll(build: (f: number) => any) {
  const o: any[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await build(f).range(f, f + 999); if (!data?.length) break; o.push(...data); if (data.length < 1000) break; }
  return o;
}

async function main() {
  console.log(`\n  external_scores link backfill${APPLY ? '' : '  [DRY RUN]'}\n`);
  const unlinked = await pageAll(f => db.from('external_scores')
    .select('id, source, artist, album_title, year')
    .in('source', CRITICAL_SOURCES as any).is('mb_release_group_id', null));
  console.log(`  ${unlinked.length} unlinked critical entries to match${LIMIT < Infinity ? ` (limiting to ${LIMIT})` : ''}\n`);

  let matched = 0, ambiguous = 0, none = 0, processed = 0;
  for (const e of unlinked as any[]) {
    if (processed++ >= LIMIT) break;
    const q = (e.album_title ?? '').trim();
    if (!q) { none++; continue; }
    const { data: cands } = await db.rpc('search_release_groups', { q, lim: 12 });
    const nt = norm(e.album_title), na = norm(e.artist);
    const titleHits = (cands ?? []).filter((c: any) =>
      (norm(c.title) === nt || norm(c.native_title) === nt) &&
      (isNaN(e.year) || isNaN(yearOf(c.first_release_date)) || Math.abs(yearOf(c.first_release_date) - e.year) <= 1));
    // prefer an artist match; else accept a unique title+year hit ONLY for a distinctive CJK title
    // (English titles like "Dirt"/"Love" collide across artists — require an artist match for those).
    const artistHits = titleHits.filter((c: any) => na && (norm(c.artist_display).includes(na) || na.includes(norm(c.artist_display))));
    const cjkTitle = /[가-힣぀-ヿ㐀-鿿]/u.test(e.album_title ?? '');
    const pick = artistHits.length === 1 ? artistHits[0]
               : (titleHits.length === 1 && cjkTitle) ? titleHits[0]
               : null;
    if (!pick) { if (titleHits.length > 1) ambiguous++; else none++; continue; }

    // need the RG's MBID to link via mb_release_group_id
    const { data: rg } = await db.from('release_groups').select('mb_release_group_id').eq('id', pick.id).maybeSingle();
    if (!rg?.mb_release_group_id) { none++; continue; }
    console.log(`  ✓ [${e.source}] ${e.artist} — ${e.album_title}  →  ${pick.artist_display} — ${pick.title}`);
    if (APPLY) { const { error } = await db.from('external_scores').update({ mb_release_group_id: rg.mb_release_group_id }).eq('id', e.id); if (error) console.warn(`    ! ${error.message}`); }
    matched++;
  }
  console.log(`\n  ${APPLY ? 'LINKED' : 'WOULD LINK'} ${matched} | ambiguous ${ambiguous} | no-match ${none}\n`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
