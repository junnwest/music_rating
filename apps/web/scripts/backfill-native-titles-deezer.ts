/**
 * Backfill release_groups.native_title for Korean albums/EPs from Deezer — the long-tail supplement
 * to the Wikipedia precision tier (Task 1 of HANDOFF-WINDOWS.md). Deezer's open API (no auth) stores
 * some K-pop albums under their Korean title; this recovers those Wikipedia doesn't cover.
 *
 * The hard part: our title is Latin/romanized and the Korean title we want is a *different string*,
 * so we can't title-match. Instead we pair by RELEASE DATE within a single, exactly-resolved artist.
 *
 * FOUR STACKED GUARDS so a wrong title can never be written (per the "no erroneous data" mandate):
 *   1. EXACT artist resolution — we resolve the Deezer *artist* (not a bare album query, which the
 *      earlier probe showed returns wrong artists) and require an exact normalized name match to our
 *      name_native OR Latin name, then pull only THAT artist's own catalog. No cross-artist leakage.
 *   2. EXACT release-date match — our first_release_date must equal the Deezer album's releaseDate
 *      (full YYYY-MM-DD; year-only/placeholder dates are skipped, not guessed).
 *   3. UNIQUE-on-date — skip if the artist has >1 Deezer album on that date (ambiguous: deluxe vs
 *      standard, two singles same day, etc.).
 *   4. HANGUL guard — only write when the Deezer title is actually Korean script.
 *
 * Scope: Korean-native artists' album/EP release groups still missing native_title. Resumable,
 * append-only. Per-artist cost is ~2 Deezer calls (search + album list), not per-album.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-deezer.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-deezer.ts --dry-run --limit-artists=40
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-deezer.ts
 */
import { getDB } from './itunes-ingest-core';
import { searchArtists, artistAlbums } from './deezer-client';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT_ARTISTS = (() => { const a = args.find(x => x.startsWith('--limit-artists=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const STATE = `${__dirname}/backfill-native-titles-deezer-state.json`;
const hasHangul = (s: string) => /[가-힣]/.test(s);
const normTight = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const fullDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.endsWith('-01-01')) ? d : null; // drop year-only + Jan-1 placeholders

function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

interface Artist { id: string; name: string; name_native: string | null }
interface RG { id: string; title: string; first_release_date: string | null; primary_artist_id: string }

async function main() {
  console.log(`\n  sillajuku Korean native-title backfill (Deezer)${DRY ? ' [DRY RUN]' : ''}\n`);
  const done = loadState();

  // Korean-native artists + their album/EP release groups missing a native title.
  const artists: Artist[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('artists').select('id, name, name_native').eq('native_language', 'ko').order('id').range(from, from + 999);
    if (!data?.length) break;
    artists.push(...(data as any[]));
    if (data.length < 1000) break;
  }
  const byArtist = new Map<string, Artist>(artists.map(a => [a.id, a]));

  const rgs: RG[] = [];
  const ids = artists.map(a => a.id);
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('release_groups')
        .select('id, title, first_release_date, primary_artist_id')
        .in('primary_artist_id', slice).is('native_title', null).in('release_group_type', ['album', 'ep'])
        .order('id').range(from, from + 999);
      if (error) { console.error('fetch error:', error.message); break; }
      if (!data?.length) break;
      rgs.push(...(data as any[]));
      if (data.length < 1000) break;
    }
  }

  // Group pending RGs (with a usable exact date) by artist.
  const pendingByArtist = new Map<string, RG[]>();
  for (const rg of rgs) {
    if (done.has(rg.id) || !fullDate(rg.first_release_date)) continue;
    const b = pendingByArtist.get(rg.primary_artist_id) ?? [];
    b.push(rg); pendingByArtist.set(rg.primary_artist_id, b);
  }
  let artistList = [...pendingByArtist.keys()];
  if (artistList.length > LIMIT_ARTISTS) artistList = artistList.slice(0, LIMIT_ARTISTS);
  console.log(`  ${artistList.length} artists with date-bearing pending albums (of ${artists.length} ko artists)\n`);

  let filled = 0, miss = 0, artistsDone = 0, noDzArtist = 0;
  for (const artistId of artistList) {
    const a = byArtist.get(artistId)!;
    const pending = pendingByArtist.get(artistId)!;

    // Guard 1: resolve the exact Deezer artist (try native name first, then Latin).
    let dzId: number | null = null;
    for (const q of [a.name_native, a.name].filter(Boolean) as string[]) {
      const cands = await searchArtists(q, 5);
      const exact = cands.find(c => normTight(c.name) === normTight(a.name_native) || normTight(c.name) === normTight(a.name));
      if (exact) { dzId = exact.id; break; }
    }
    artistsDone++;
    if (!dzId) { noDzArtist++; for (const rg of pending) { done.add(rg.id); miss++; } continue; }

    // Build exact-date → Hangul-titled Deezer albums (guard 4 applied here).
    const albums = await artistAlbums(dzId, 300);
    const byDate = new Map<string, { title: string }[]>();
    for (const al of albums) {
      const d = fullDate(al.releaseDate);
      if (!d || !hasHangul(al.title)) continue;
      const b = byDate.get(d) ?? []; b.push({ title: al.title }); byDate.set(d, b);
    }

    for (const rg of pending) {
      const d = fullDate(rg.first_release_date)!;
      const hits = byDate.get(d) ?? [];
      // Guards 2 + 3: exact date AND exactly one Hangul album on that date.
      if (hits.length === 1) {
        const ko = hits[0].title;
        console.log(`  ✓ ${a.name} — ${rg.title}  →  ${ko}   [${d}]`);
        if (!DRY) {
          const { error } = await db.from('release_groups').update({ native_title: ko }).eq('id', rg.id).is('native_title', null);
          if (error) console.warn(`    ! ${rg.id}: ${error.message}`);
        }
        filled++;
      } else miss++;
      done.add(rg.id);
    }
    if (artistsDone % 20 === 0) { if (!DRY) saveState(done); console.log(`  … ${artistsDone}/${artistList.length} artists  filled=${filled}`); }
  }
  if (!DRY) saveState(done);
  console.log(`\n  DONE — ${artistsDone} artists (${noDzArtist} unresolved on Deezer), filled ${filled}, no-match ${miss}\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
