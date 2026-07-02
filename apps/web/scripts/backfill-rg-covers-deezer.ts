/**
 * Cover backfill via Deezer — the fallback for release-groups Cover Art Archive can't cover.
 * Deezer has album art with no auth (same source as the artist-avatar backfill). For each null-cover
 * release-group it searches Deezer by (artist, title) and, on a CONFIDENT match, stores cover_xl.
 *
 * Confidence guard (avoid wrong covers): normalized title match (exact, or a CJK-aware prefix/suffix)
 * AND an artist-name overlap. APPEND-ONLY (only writes where cover_url IS NULL). Deezer host, so it's
 * fine alongside the pipeline and the CAA pass. Run CAA first; this mops up the remainder.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-deezer.ts --dry-run --limit=40
 *   npx tsx --env-file=.env.local scripts/backfill-rg-covers-deezer.ts
 */
import { getDB } from './itunes-ingest-core';
import { searchAlbums, type DzAlbumHit } from './deezer-client';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const db = getDB();
const STATE = `${__dirname}/backfill-rg-covers-deezer-state.json`;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const hasCJK = (s: string) => /[぀-ヿ㐀-鿿가-힯]/.test(s);
function titleMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const minOk = hasCJK(short) ? short.length >= 2 : short.length >= 6;
  return minOk && (long.startsWith(short) || long.endsWith(short));
}
// Artist match must be tight (prefix either way, not substring-anywhere) so "Chicago" doesn't match
// "New Broadway Cast of Chicago The Musical". Handles "Earth, Wind & Fire" == "Earth Wind & Fire".
const artistMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };
// First credited artist (drop " & X", " feat. Y", etc.) — Deezer matches the lead artist best.
const primaryArtist = (s: string) => s.split(/\s*(?:&|feat\.?|ft\.?|,|x|×|vs\.?|with)\s+/i)[0].trim() || s;

function loadState(): Set<string> { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } }
function saveState(s: Set<string>) { writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0)); }

async function main() {
  const done = loadState();
  const PAGE = 1000;
  let rows: { id: string; title: string; native_title: string | null; artist_display: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('release_groups')
      .select('id, title, native_title, artist_display')
      .is('cover_url', null)
      .order('prestige_score', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    rows.push(...(data as any[]));
    if (data.length < PAGE) break;
  }
  rows = rows.filter(r => !done.has(r.id));
  if (rows.length > LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`[deezer-covers] ${rows.length} null-cover release groups to try${DRY ? '  [DRY RUN]' : ''}`);

  let filled = 0, miss = 0, processed = 0;
  for (const r of rows) {
    const artist = primaryArtist(r.artist_display);
    // try the display title, then the native title (K/J albums are often stored native on Deezer)
    const titles = [r.title, r.native_title].filter(Boolean) as string[];
    let cover: string | null = null, via = '';
    for (const t of titles) {
      let hits: DzAlbumHit[] = [];
      try { hits = await searchAlbums(artist, t, 5); } catch { hits = []; }
      const nt = norm(t);
      const cands = hits.filter(h => h.cover && artistMatch(h.artist, artist));
      // exact title first (so self-titled "Chicago" prefers exact over "Chicago V"), then fuzzy
      const hit = cands.find(h => norm(h.title) === nt) ?? cands.find(h => titleMatch(norm(h.title), nt));
      if (hit) { cover = hit.cover; via = `${hit.artist} · ${hit.title}`; break; }
    }
    processed++;
    if (cover) {
      filled++;
      if (DRY) console.log(`  ✓ ${r.artist_display} — ${r.title}  →  ${via}`);
      else {
        const { error } = await db.from('release_groups').update({ cover_url: cover }).eq('id', r.id).is('cover_url', null);
        if (error) console.warn(`  ! ${r.id}: ${error.message}`);
      }
      done.add(r.id);
    } else { miss++; done.add(r.id); }
    if (processed % 100 === 0) { if (!DRY) saveState(done); console.log(`  ${processed}/${rows.length}  filled=${filled} miss=${miss} (${(100 * filled / processed).toFixed(0)}%)`); }
  }
  if (!DRY) saveState(done);
  console.log(`[deezer-covers] DONE — processed ${processed}, filled ${filled}, miss ${miss} (${(100 * filled / Math.max(processed, 1)).toFixed(0)}%)`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
