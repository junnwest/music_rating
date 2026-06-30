/**
 * Work Item A — backfill release_group_artists for EXISTING collab release groups.
 *
 * Single-artist groups need no join row (get_artist_release_groups matches them via
 * primary_artist_id), so we only backfill groups whose artist_display carries a collab separator
 * (& / feat / X / × / vs / with / , ). For each, re-read the MB artist-credit and write the
 * ordered credits, creating 'credit_stub' artist rows for collaborators not yet ingested.
 *
 * ⚠️ Uses MusicBrainz (~1 req/s PER IP). PAUSE THE PIPELINE before running, or the shared IP rate
 * doubles and trips MB throttling for both. ~6–8k groups → roughly 2h. Resumable via state file.
 *
 *   # stop the pipeline first, then:
 *   npx tsx --env-file=.env.local scripts/backfill-rg-credits.ts            # full run
 *   npx tsx --env-file=.env.local scripts/backfill-rg-credits.ts --limit=50 # sample
 */
import { getDB, writeReleaseGroupCredits } from './mb-ingest';
import { getReleaseGroupCredits } from './mb-client';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const STATE = `${__dirname}/backfill-rg-credits-state.json`;
const args = process.argv.slice(2);
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

// artist_display patterns that imply more than one credited artist.
const SEPARATORS = ['%&%', '% feat%', '% Feat%', '% ft%', '% X %', '% x %', '%×%', '% vs%', '% with %', '%,%'];

function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

async function main() {
  const done = loadState();

  // Pull collab-pattern groups with an MBID. (artist_display OR matches any separator.)
  const orFilter = SEPARATORS.map(p => `artist_display.ilike.${p}`).join(',');
  const PAGE = 1000;
  let groups: { id: string; mb_release_group_id: string; primary_artist_id: string; artist_display: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('release_groups')
      .select('id, mb_release_group_id, primary_artist_id, artist_display')
      .not('mb_release_group_id', 'is', null)
      .or(orFilter)
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    groups.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  groups = groups.filter(g => !done.has(g.id));
  if (groups.length > LIMIT) groups = groups.slice(0, LIMIT);
  console.log(`[rg-credits] ${groups.length} collab groups to backfill`);

  let processed = 0, wrote = 0, single = 0, failed = 0;
  for (const g of groups) {
    try {
      const credits = await getReleaseGroupCredits(g.mb_release_group_id);
      if (credits.length > 1) {
        await writeReleaseGroupCredits(db, g.id, credits, '', g.primary_artist_id);
        wrote++;
      } else single++; // artist_display had a separator (e.g. comma in a solo act's name) but one credit
    } catch (e) {
      failed++; console.warn(`  ! ${g.artist_display}: ${(e as Error).message.slice(0, 120)}`);
    }
    done.add(g.id); processed++;
    if (processed % 50 === 0) { saveState(done); console.log(`  ${processed}/${groups.length}  wrote=${wrote} single=${single} failed=${failed}`); }
  }
  saveState(done);
  console.log(`[rg-credits] DONE — processed ${processed}, wrote ${wrote}, single-credit ${single}, failed ${failed}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
