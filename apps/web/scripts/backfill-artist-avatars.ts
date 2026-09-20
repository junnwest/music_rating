/**
 * Work Item E — artist avatars. artists.cover_url is 0/2641 populated. Deezer exposes artist
 * pictures with no auth, so we match each artist by name and store picture_xl.
 *
 * Match guard: Deezer candidate's name must equal the artist's name OR name_native after
 * normalization (lowercase + strip non-alphanumerics, Unicode-aware so Hangul survives). Among
 * matches, the one with the most fans wins. Unmatched artists are left null (no wrong faces).
 * APPEND-ONLY: only writes where cover_url IS NULL.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artist-avatars.ts --dry-run --limit=20
 *   npx tsx --env-file=.env.local scripts/backfill-artist-avatars.ts            # full run
 */
import { getDB } from './itunes-ingest-core';
import { searchArtists as dzSearchArtists } from './deezer-client';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const STATE = `${__dirname}/backfill-artist-avatars-state.json`;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
// Optional pre-ordered id list. The default ordering below sorts by `popularity`, which is
// 0/68,153 populated (a dead Spotify column — Spotify was retired from data collection), so it is
// effectively random and has never actually put famous artists first. An ids file lets the caller
// supply a real priority order; scripts/data/avatar-priority.json is built from critic scores,
// user ratings and discography size, and excludes the 45,319 artists with no releases at all
// (credit stubs, where an exact-name Deezer match is most likely to attach the wrong face).
const IDS_FILE = (() => { const a = args.find(x => x.startsWith('--ids-file=')); return a ? a.split('=').slice(1).join('=') : null; })();

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

async function main() {
  const done = loadState();
  const PAGE = 1000;
  let artists: { id: string; name: string; name_native: string | null }[] = [];
  if (IDS_FILE) {
    // Preserve the file's order exactly — it IS the priority. Fetch in batches of 100 (a few
    // hundred UUIDs overflows the PostgREST request URL and returns nothing), then re-sort back
    // into file order, since the DB returns each batch in arbitrary order.
    const ids: string[] = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
    const pending = ids.filter(id => !done.has(id));
    const rank = new Map(pending.map((id, i) => [id, i]));
    const want = Number.isFinite(LIMIT) ? pending.slice(0, LIMIT) : pending;
    for (let i = 0; i < want.length; i += 100) {
      const { data, error } = await db.from('artists')
        .select('id, name, name_native').is('cover_url', null).in('id', want.slice(i, i + 100));
      if (error) { console.error(`fetch error: ${error.message}`); break; }
      artists.push(...(data as any[] ?? []));
    }
    artists.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from('artists')
        .select('id, name, name_native')
        .is('cover_url', null)
        .order('popularity', { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error) { console.error('fetch error:', error.message); break; }
      if (!data?.length) break;
      artists.push(...(data as any[]));
      if (data.length < PAGE) break;
    }
  }
  artists = artists.filter(a => !done.has(a.id));
  if (artists.length > LIMIT) artists = artists.slice(0, LIMIT);
  console.log(`[avatars] ${artists.length} artists missing a cover${DRY ? '  [DRY RUN]' : ''}`);

  let matched = 0, miss = 0, processed = 0;
  for (const a of artists) {
    await sleep(150);
    const targets = [norm(a.name), norm(a.name_native)].filter(Boolean);
    let pic: string | null = null, picName = '';
    try {
      const cands = await dzSearchArtists(a.name, 5);
      const hits = cands.filter(c => c.picture && targets.includes(norm(c.name)))
                        .sort((x, y) => y.nbFan - x.nbFan);
      if (hits[0]) { pic = hits[0].picture; picName = hits[0].name; }
    } catch { /* network blip → treat as miss, retry next run */ }
    processed++;
    if (pic) {
      matched++;
      if (DRY) console.log(`  ✓ ${a.name.padEnd(24)} → Deezer "${picName}"`);
      else {
        const { error } = await db.from('artists').update({ cover_url: pic }).eq('id', a.id).is('cover_url', null);
        if (error) console.warn(`  ! ${a.name}: ${error.message}`);
      }
    } else { miss++; if (DRY) console.log(`  ✗ ${a.name}`); }
    done.add(a.id);
    if (processed % 100 === 0) { if (!DRY) saveState(done); console.log(`  ${processed}/${artists.length}  matched=${matched} miss=${miss} (${(100*matched/processed).toFixed(0)}%)`); }
  }
  if (!DRY) saveState(done);
  console.log(`[avatars] DONE — processed ${processed}, matched ${matched}, miss ${miss} (${(100*matched/Math.max(processed,1)).toFixed(0)}%)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
