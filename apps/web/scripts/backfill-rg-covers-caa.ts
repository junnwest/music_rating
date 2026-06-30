/**
 * Work Item C — cover backfill via Cover Art Archive at the RELEASE-GROUP level.
 *
 * 29.5% of release_groups have no cover. They were ingested with a cover looked up from one
 * specific release MBID (coverartarchive.org/release/{releaseMbid}/front-500); when that release
 * had no front image the group was left null even though a sibling release in the group often does.
 * CAA's release-GROUP endpoint (coverartarchive.org/release-group/{mbid}/front-500) returns the
 * representative front image across the whole group, recovering many of these (verified: NewJeans
 * "Get Up" 404s at release level but 200s at group level).
 *
 * STRICTLY APPEND-ONLY: only writes where cover_url IS NULL (guarded on the UPDATE too), so it never
 * fights the iTunes GAPFILL lane — whoever fills the null first wins, the other skips it.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-caa.ts            # album/ep only (priority)
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-caa.ts --all      # + singles
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-caa.ts --limit=200 --dry-run
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const STATE = `${__dirname}/backfill-rg-covers-caa-state.json`;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const CONCURRENCY = 4;
const SPACING_MS = 120; // polite pacing per request slot

function loadState(): { done: string[] } { try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: [] }; } catch { return { done: [] }; } }
function saveState(s: { done: string[] }) { writeFileSync(STATE, JSON.stringify({ done: s.done }, null, 0)); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Returns the stable front-500 release-group URL if CAA has art for this group, else null. */
async function caaCover(mbid: string): Promise<string | null> {
  const url = `https://coverartarchive.org/release-group/${mbid}/front-500`;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (res.status === 200) return url; // store the canonical redirecting URL, not the volatile CDN node
    return null; // 404 = no art in the group
  } catch { return null; }
}

async function main() {
  const state = loadState();
  const doneSet = new Set(state.done);
  const types = ALL ? ['album', 'ep', 'single'] : ['album', 'ep'];

  // Pull the addressable set (null cover + has mbid), priority types first.
  const PAGE = 1000;
  let rows: { id: string; mb_release_group_id: string; title: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('release_groups')
      .select('id, mb_release_group_id, title')
      .is('cover_url', null)
      .not('mb_release_group_id', 'is', null)
      .in('release_group_type', types)
      .order('prestige_score', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  rows = rows.filter(r => !doneSet.has(r.id));
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`[caa-covers] candidates: ${rows.length} (${types.join('/')})${DRY ? '  [DRY RUN]' : ''}`);
  let filled = 0, miss = 0, processed = 0;

  // Simple bounded-concurrency worker pool.
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      await sleep(SPACING_MS);
      const cover = await caaCover(r.mb_release_group_id);
      processed++;
      if (cover) {
        if (!DRY) {
          const { error } = await db.from('release_groups')
            .update({ cover_url: cover }).eq('id', r.id).is('cover_url', null);
          if (error) { console.warn(`  ! ${r.id}: ${error.message}`); }
          else filled++;
        } else filled++;
      } else miss++;
      doneSet.add(r.id);
      if (processed % 100 === 0) {
        if (!DRY) saveState({ done: [...doneSet] });
        console.log(`  ${processed}/${rows.length}  filled=${filled} miss=${miss} (${(100 * filled / processed).toFixed(0)}% hit)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (!DRY) saveState({ done: [...doneSet] });
  console.log(`[caa-covers] DONE — processed ${processed}, filled ${filled}, miss ${miss} (${(100 * filled / Math.max(processed, 1)).toFixed(0)}% hit)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
