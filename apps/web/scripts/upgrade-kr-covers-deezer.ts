/**
 * Replace Cover Art Archive covers on Korean release groups with the distributor's digital artwork
 * from Deezer (2026-09-22). OVERWRITES existing covers -- every other cover script here is
 * append-only, so read the guards before running it.
 *
 * WHY. Reported from the app: "오보에 - yanghongwon: still has the wrong album cover". The title was
 * fine; the cover was a watermarked hanteodb.com photograph of the shrink-wrapped CD, glare and all.
 * It is not a pipeline bug -- CAA holds exactly one image for that release and that is it, correctly
 * typed Front and approved. MusicBrainz's Korean coverage leans on community scans of physical
 * media, so a real fraction of the 15,622 Korean release groups sitting on CAA covers show a
 * photographed jewel case where the distributor's digital art exists on Deezer.
 *
 * WHY IT IS A BLANKET PASS AND NOT A DETECTOR. A detector was tried first and measurably does not
 * work. Perceptual hashing (dHash/aHash, 8x8 greyscale) against the known-bad 오보에 pair scores a
 * Hamming distance of 34 between the CAA scan and the correct Deezer art for THE SAME ALBUM, while
 * two entirely unrelated covers score 26. A bad photograph of the right cover is further from the
 * truth than a different album's cover is, so "CAA and Deezer disagree" carries no signal about
 * which one is wrong. Aspect ratio does not separate them either -- the 오보에 scan is a square
 * 500x500, exactly like real art. With no usable signal, the choice is replace-all-or-nothing, and
 * the owner chose to replace.
 *
 * THE GUARDS, given this writes over data that is already there:
 *   1. STRICTER MATCHING than the append-only pass. That one accepts a CJK-aware prefix/suffix
 *      overlap, which is fine when the alternative is no cover at all; here the alternative is the
 *      cover we already have, so only EXACT normalized title equality counts. No fuzzy, no prefix.
 *   2. EXACT artist equality, not the prefix rule -- "Chicago" must not take "Chicago The Musical".
 *   3. Korean artists only (native_language='ko'), which is the population the problem was measured
 *      in. Note this now includes the 779 Latin-styled Korean acts that
 *      fix-native-language-korean-gaps.ts tagged the same day; before that they were invisible.
 *   4. REVERSIBLE. Every replacement appends {id, old, new} to a rollback file BEFORE the write, so
 *      a bad run can be undone row by row. --rollback=<file> restores from it.
 *
 * REPORT-ONLY unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/upgrade-kr-covers-deezer.ts --limit=60
 *   npx tsx --env-file=.env.local scripts/upgrade-kr-covers-deezer.ts --apply
 *   npx tsx --env-file=.env.local scripts/upgrade-kr-covers-deezer.ts --rollback=scripts/data/kr-cover-rollback.ndjson
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchAlbums, type DzAlbumHit } from './deezer-client';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit') ?? Infinity);
const ROLLBACK_IN = arg('--rollback');
const OUT = arg('--out') ?? 'scripts/data/kr-cover-upgrade.json';
const ROLLBACK = arg('--rollback-file') ?? 'scripts/data/kr-cover-rollback.ndjson';
const STATE = 'scripts/data/kr-cover-upgrade-state.json';

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
// Exact equality only -- see guard 1 in the header.
const exactTitle = (a: string, b: string) => !!a && a === b;
const exactArtist = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && x === y; };
const primaryArtist = (s: string) => s.split(/\s*(?:&|feat\.?|ft\.?|,|x|×|vs\.?|with)\s+/i)[0].trim() || s;

const loadState = (): Set<string> => { try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done as string[]); } catch { return new Set(); } };
const saveState = (s: Set<string>) => fs.writeFileSync(STATE, JSON.stringify({ done: [...s] }));

interface Row { id: string; title: string; native_title: string | null; artist_display: string; cover_url: string }
interface Swap { id: string; artist: string; title: string; old: string; new: string; via: string }

async function rollback(file: string) {
  const db = getDB();
  const text = fs.readFileSync(file, 'utf8').trim();
  const swaps: Swap[] = file.endsWith('.ndjson')
    ? text.split('\n').filter(Boolean).map(l => JSON.parse(l))
    : JSON.parse(text);
  console.log(`[rollback] restoring ${swaps.length} cover(s) from ${file}`);
  let n = 0;
  for (const s of swaps) {
    const { error } = await db.from('release_groups').update({ cover_url: s.old }).eq('id', s.id);
    if (error) console.warn(`  ! ${s.id}: ${error.message}`); else n++;
  }
  console.log(`  restored ${n}/${swaps.length}`);
}

async function main() {
  if (ROLLBACK_IN) return rollback(ROLLBACK_IN);
  const db = getDB();
  const done = loadState();

  // Korean release groups currently showing CAA art. Ordered by id so .range() is stable -- the
  // unstable-pagination bug (ordering by a column that does not uniquely determine the sort) has
  // already cost this repo ~47,000 silently unfetched rows once.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('release_groups')
      .select('id, title, native_title, artist_display, cover_url, artists!inner(native_language)')
      .eq('artists.native_language', 'ko')
      .like('cover_url', '%coverartarchive.org%')
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) { console.error('fetch:', error.message); break; }
    if (!data?.length) break;
    rows.push(...(data as any[]));
    if (data.length < 1000) break;
  }

  let todo = rows.filter(r => !done.has(r.id));
  if (Number.isFinite(LIMIT)) todo = todo.slice(0, LIMIT);
  console.log(`[kr-covers] ${todo.length} Korean release group(s) on CAA art${APPLY ? '  *** APPLY (overwrites) ***' : '  (report only)'}`);

  const swaps: Swap[] = [];
  let processed = 0, matched = 0, miss = 0;
  for (const r of todo) {
    const artist = primaryArtist(r.artist_display);
    // Try the native (Korean) title as well -- Deezer often files Korean albums under it, and that
    // is exactly the case this pass exists for.
    const titles = [r.title, r.native_title].filter(Boolean) as string[];
    let hit: DzAlbumHit | undefined;
    for (const t of titles) {
      let hits: DzAlbumHit[] = [];
      try { hits = await searchAlbums(artist, t, 5); } catch { hits = []; }
      const nt = norm(t);
      hit = hits.find(h => h.cover && exactArtist(h.artist, artist) && exactTitle(norm(h.title), nt));
      if (hit) break;
    }
    processed++;
    if (hit?.cover && hit.cover !== r.cover_url) {
      matched++;
      const swap: Swap = { id: r.id, artist: r.artist_display, title: r.title, old: r.cover_url, new: hit.cover, via: `${hit.artist} · ${hit.title}` };
      swaps.push(swap);
      if (APPLY) {
        // Rollback record is written BEFORE the update, so a crash mid-run still leaves every
        // completed write undoable.
        fs.appendFileSync(ROLLBACK, JSON.stringify(swap) + '\n');
        const { error } = await db.from('release_groups').update({ cover_url: hit.cover }).eq('id', r.id);
        if (error) console.warn(`  ! ${r.id}: ${error.message}`);
      } else {
        console.log(`  ↻ ${r.artist_display} — ${r.title}  →  ${swap.via}`);
      }
    } else miss++;
    done.add(r.id);
    if (processed % 100 === 0) {
      if (APPLY) saveState(done);
      console.log(`  ${processed}/${todo.length}  replaced=${matched} keep=${miss} (${(100 * matched / processed).toFixed(0)}%)`);
    }
  }
  if (APPLY) saveState(done);
  fs.writeFileSync(OUT, JSON.stringify(swaps, null, 2));

  console.log(`\n  processed ${processed}, replaced ${matched}, left alone ${miss} (${(100 * matched / Math.max(processed, 1)).toFixed(0)}%)`);
  console.log(`  report → ${OUT}`);
  if (APPLY) console.log(`  rollback → ${ROLLBACK}  (restore with --rollback=${ROLLBACK})`);
  else console.log('  report only — re-run with --apply to overwrite');
}

if (process.argv[1] && process.argv[1].endsWith('upgrade-kr-covers-deezer.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
