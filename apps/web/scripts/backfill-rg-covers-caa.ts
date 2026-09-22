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
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
// --replace-edition: the OTHER half of this problem. mb-ingest.ts used to store the cover of ONE
// PRESSING (coverartarchive.org/release/{releaseMbid}) rather than the release GROUP's designated
// front, so 347,614 rows (77.7% of all cover art) show whichever edition was picked -- a Japanese
// press, a vinyl reissue, a deluxe variant -- instead of the cover people recognise. A 30-album
// sample found 15 resolve to a DIFFERENT image than the group cover, i.e. roughly half are wrong.
// This mode targets those rows instead of null ones and overwrites them; the default append-only
// behaviour (fill nulls, never touch existing art) is unchanged.
const REPLACE_EDITION = args.includes('--replace-edition');
const STATE_FILE = REPLACE_EDITION ? `${__dirname}/backfill-rg-covers-caa-replace-state.json` : `${__dirname}/backfill-rg-covers-caa-state.json`;
// Tunable, because the defaults are too aggressive once CAA has seen a lot of traffic. Passes 1-2
// ran at 97-99% hit; by pass 3 the same settings returned 51% `retry` (429/5xx), while a manual
// probe at 1 req/s answered cleanly -- i.e. the throttling was ours, not an outage. 4 workers at
// 120ms is ~33 req/s. Lower both and the run is slower but actually completes work instead of
// burning rows into the retry bucket.
const CONCURRENCY = (() => { const a = args.find(x => x.startsWith('--concurrency=')); return a ? parseInt(a.split('=')[1], 10) : 4; })();
const SPACING_MS = (() => { const a = args.find(x => x.startsWith('--spacing=')); return a ? parseInt(a.split('=')[1], 10) : 120; })();

function loadState(): { done: string[] } { try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { done: [] }; } catch { return { done: [] }; } }
function saveState(s: { done: string[] }) { writeFileSync(STATE_FILE, JSON.stringify({ done: s.done }, null, 0)); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Returns the stable front-500 release-group URL if CAA has art for this group, else null. */
// 'filled' = art exists (200); 'none' = confirmed no art (404); 'retry' = throttle/5xx/network —
// leave it un-done so a later run tries again (never record a throttle as a permanent miss).
async function caaCover(mbid: string): Promise<{ status: 'filled' | 'none' | 'retry'; url?: string }> {
  const url = `https://coverartarchive.org/release-group/${mbid}/front-500`;
  try {
    // HEAD, not GET: we only need to know whether art EXISTS, and the URL is stored as a hotlink
    // rather than cached. A GET downloads the whole 500px JPEG -- across 347k rows that is tens of
    // GB of pointless transfer, and it is slower per row. Verified HEAD returns the same 200/404
    // through CAA's redirect chain to archive.org.
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.status === 200) return { status: 'filled', url };
    if (res.status === 404) return { status: 'none' };
    return { status: 'retry' }; // 429/503/5xx
  } catch { return { status: 'retry' }; }
}

async function main() {
  const state = loadState();
  const doneSet = new Set(state.done);
  const types = ALL ? ['album', 'ep', 'single'] : ['album', 'ep'];

  // Pull the addressable set (null cover + has mbid), priority types first.
  const PAGE = 1000;
  let rows: { id: string; mb_release_group_id: string; title: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from('release_groups')
      .select('id, mb_release_group_id, title')
      .not('mb_release_group_id', 'is', null)
      .in('release_group_type', types)
      .order('prestige_score', { ascending: false, nullsFirst: false })
      // `id` is a REQUIRED tiebreaker, not a nicety. prestige_score is NULL on all but ~1,589 rows,
      // so ordering by it alone leaves the sort arbitrary and Postgres may return a different row
      // order per page -- the same row lands in two pages while another is never fetched at all.
      // The 2026-09-20 --replace-edition run hit exactly this: it reported 132,020 processed and
      // 129,926 filled, but the state file held only 85,326 DISTINCT ids and ~50,948 album/EP rows
      // were never selected. (Same failure class as the dedup:releases incident in
      // requeue-affected.ts: "pagination without ORDER BY caused self-matches".)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    q = REPLACE_EDITION
      ? q.like('cover_url', '%coverartarchive.org/release/%')  // wrong-endpoint rows
      : q.is('cover_url', null);                               // classic append-only gap fill
    const { data, error } = await q;
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  rows = rows.filter(r => !doneSet.has(r.id));
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);

  console.log(`[caa-covers] candidates: ${rows.length} (${types.join('/')})${DRY ? '  [DRY RUN]' : ''}`);
  let filled = 0, miss = 0, retry = 0, processed = 0;

  // Simple bounded-concurrency worker pool.
  let idx = 0;
  async function worker() {
    while (idx < rows.length) {
      const r = rows[idx++];
      await sleep(SPACING_MS);
      const res = await caaCover(r.mb_release_group_id);
      processed++;
      if (res.status === 'filled') {
        if (!DRY) {
          // Append-only mode keeps the is-null guard so it never races the iTunes GAPFILL lane.
          // Replace mode must overwrite, but is still narrow: it only touches rows whose cover is
          // an edition-endpoint CAA URL, so it can never clobber iTunes/Deezer art or a null.
          const upd = db.from('release_groups').update({ cover_url: res.url }).eq('id', r.id);
          const { error } = await (REPLACE_EDITION
            ? upd.like('cover_url', '%coverartarchive.org/release/%')
            : upd.is('cover_url', null));
          if (error) { console.warn(`  ! ${r.id}: ${error.message}`); }
        }
        filled++; doneSet.add(r.id);
      } else if (res.status === 'none') {
        miss++; doneSet.add(r.id);          // confirmed no CAA art → don't retry via CAA
      } else {
        retry++;                            // throttle/error → leave un-done for a later run
      }
      if (processed % 100 === 0) {
        if (!DRY) saveState({ done: [...doneSet] });
        console.log(`  ${processed}/${rows.length}  filled=${filled} miss=${miss} retry=${retry} (${(100 * filled / processed).toFixed(0)}% hit)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (!DRY) saveState({ done: [...doneSet] });
  console.log(`[caa-covers] DONE — processed ${processed}, filled ${filled}, miss ${miss}, retry-later ${retry} (${(100 * filled / Math.max(processed, 1)).toFixed(0)}% hit)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
