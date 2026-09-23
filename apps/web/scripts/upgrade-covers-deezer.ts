/**
 * Move release-group covers off Cover Art Archive and onto Deezer, catalogue-wide.
 * OVERWRITES existing covers — every other cover script here is append-only, so read the guards.
 *
 * WHY, IN TWO PARTS.
 *
 * COST. Cover.tsx routes CAA URLs through /api/img, because CAA 307-redirects to archive.org and
 * takes 1.5-2.5s cold; the proxy follows that once server-side and the Vercel edge caches the bytes
 * for a year. iTunes and Deezer are fast CDNs and go straight to the client. So a CAA cover costs
 * us bandwidth on every view and a Deezer cover costs us nothing — and 370,850 release groups
 * (75.5% of the catalogue) are on the proxied path.
 *
 * QUALITY. MusicBrainz's Korean coverage in particular leans on community scans of physical media.
 * Reported from the app: 오보에 showed a watermarked hanteodb.com photograph of a shrink-wrapped CD,
 * glare and all — CAA's only image for that release, correctly typed Front and approved. Deezer had
 * the distributor's digital art. This pass fixes that class as a side effect of the cost work.
 *
 * TWO STRATEGIES, BECAUSE THEY FAIL DIFFERENTLY. Measured side by side on 503 rows / 150 artists:
 *
 *   artist  45.1% (CI 40.8-49.5)  279 requests — resolve the Deezer ARTIST once by exact name,
 *           pull their discography, match titles with titleVariants/titlesMatch.
 *   search  42.3% (CI 38.0-46.7)  542 requests — one album search per row, exact title equality.
 *   BOTH    53.3% (CI 48.9-57.6)
 *
 * Neither dominates (the intervals overlap), but together they clear both by ~8-11 points, because
 * search misses a TITLE whose wording differs — a format or edition suffix, a leading artist name,
 * an accent, "Dalliance" vs "Dalliance - EP" — while artist misses an ARTIST whose name Deezer
 * spells differently, and when it does it loses every row for them at once. So: artist first, which
 * is also half the request cost since one lookup serves the whole catalogue, then search only for
 * what it missed.
 *
 * COMPILATIONS ARE EXCLUDED. 16%/14% — Deezer simply does not carry them. ~64,000 rows that stay on
 * the proxy, and attempting them would spend a third of the run's requests for almost nothing.
 *
 * THE GUARDS, given this writes over data that is already there:
 *   1. Artist identity is pinned by EXACT normalized name equality (against name or name_native)
 *      before any title is compared. Looser title matching is safe only because of this: we are
 *      choosing among albums already known to be the right artist's, not inferring identity from
 *      the title itself.
 *   2. The SEARCH fallback has no such pin, so it keeps the strict rule — exact normalized title
 *      AND exact artist equality, no fuzzy, no prefix.
 *   3. Only rows whose cover is currently a CAA/archive.org URL are touched, and the UPDATE repeats
 *      that condition, so it can never clobber iTunes/Deezer art or a null.
 *   4. REVERSIBLE, AND HONEST ABOUT WHAT LANDED. Every change that SUCCEEDS appends {id, old, new}
 *      to a rollback journal, so a run that goes wrong can be undone row by row; --rollback=<file>
 *      restores. The journal was originally written before the update, which was wrong in both
 *      directions: a failed write still recorded a swap that never happened, and the row was never
 *      retried because its artist is marked done immediately after. Writes now retry with backoff,
 *      and a row that still fails is recorded in --failed-file rather than lost. Statement timeouts
 *      are real here — they appeared as soon as this pass and backfill-rg-covers-caa were both
 *      updating cover_url on overlapping rows, which is why the two should not run together.
 *
 * REPORT-ONLY unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/upgrade-covers-deezer.ts --limit-artists=40
 *   npx tsx --env-file=.env.local scripts/upgrade-covers-deezer.ts --apply
 *   npx tsx --env-file=.env.local scripts/upgrade-covers-deezer.ts --rollback=scripts/data/cover-upgrade-rollback.ndjson
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchAlbums, searchArtists, artistAlbums, type DzAlbumHit } from './deezer-client';
import { titleVariants, titlesMatch } from './resolve-stub-itunes';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const NO_SEARCH = process.argv.includes('--no-search-fallback');
const LIMIT_ARTISTS = Number(arg('--limit-artists') ?? Infinity);
const ROLLBACK_IN = arg('--rollback');
const TYPES = (arg('--types') ?? 'album,ep,single,soundtrack').split(',').map(s => s.trim()).filter(Boolean);
// Artist order. Default n desc does the biggest catalogues first, which is the WORST sample to
// judge the run by: the 37 artists holding 200+ proxied rows are 3.0% of the rows and are mostly
// obscure reissues and compilations Deezer never carried (a dry run over the top 25 matched 20.5%,
// against 53.3% measured on randomly sampled artists). 59.7% of the rows belong to artists holding
// 10-49. --order=random makes a dry run representative of the catalogue rather than of its tail.
const ORDER = arg('--order') ?? 'n';
const ROLLBACK = arg('--rollback-file') ?? 'scripts/data/cover-upgrade-rollback.ndjson';
const STATE = 'scripts/data/cover-upgrade-state.json';
// Rows whose write failed after retries — recorded rather than silently dropped, so they can be
// re-run instead of staying on the proxy forever.
const FAILED = arg('--failed-file') ?? 'scripts/data/cover-upgrade-failed.ndjson';

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const exactArtist = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && x === y; };
const primaryArtist = (s: string) => s.split(/\s*(?:&|feat\.?|ft\.?|,|x|×|vs\.?|with)\s+/i)[0].trim() || s;

const loadState = (): Set<string> => { try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done as string[]); } catch { return new Set(); } };
const saveState = (s: Set<string>) => fs.writeFileSync(STATE, JSON.stringify({ done: [...s] }));

interface Row { id: string; title: string; native_title: string | null; artist_display: string; cover_url: string; release_group_type: string }
interface Swap { id: string; artist: string; title: string; old: string; new: string; via: string; how: 'artist' | 'search' }

async function sql<T>(query: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function rollback(file: string) {
  const db = getDB();
  const swaps: Swap[] = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
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

  const typeList = TYPES.map(t => `'${t}'`).join(',');
  const artists = await sql<{ id: string; name: string; name_native: string | null; n: number }>(`
    select a.id::text, a.name, a.name_native, count(*) as n
      from artists a
      join release_groups rg on rg.primary_artist_id = a.id
     where (rg.cover_url like '%coverartarchive.org%' or rg.cover_url like '%archive.org%')
       and rg.release_group_type in (${typeList})
     group by 1,2,3
     order by ${ORDER === 'random' ? 'random()' : 'n desc'}`);

  let targets = artists.filter(a => !done.has(a.id));
  if (Number.isFinite(LIMIT_ARTISTS)) targets = targets.slice(0, LIMIT_ARTISTS);
  const rowTotal = targets.reduce((s, a) => s + Number(a.n), 0);
  console.log(`[covers] ${targets.length} artist(s), ${rowTotal} proxied row(s) in ${TYPES.join('/')}` +
              `${APPLY ? '  *** APPLY (overwrites) ***' : '  (report only)'}`);

  let processed = 0, viaArtist = 0, viaSearch = 0, kept = 0, artistsDone = 0;

  for (const a of targets) {
    const names = [a.name, a.name_native].filter(Boolean) as string[];

    // Our proxied rows for this artist.
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('release_groups')
        .select('id, title, native_title, artist_display, cover_url, release_group_type')
        .eq('primary_artist_id', a.id).in('release_group_type', TYPES)
        .or('cover_url.like.%coverartarchive.org%,cover_url.like.%archive.org%')
        .order('id', { ascending: true }).range(from, from + 999);
      if (error) { console.warn(`  ! ${a.name}: ${error.message}`); break; }
      if (!data?.length) break;
      rows.push(...(data as any[]));
      if (data.length < 1000) break;
    }
    if (!rows.length) { done.add(a.id); continue; }

    // ── strategy 1: pin the artist, then match within their own catalogue ──
    // artistAlbums is capped at 100. That is deliberate rather than paged: past 100 the search
    // fallback below handles the remainder, and paging every prolific artist would cost far more
    // requests than the handful of extra rows is worth.
    let discVars: { title: string; cover: string | null; v: Set<string> }[] = [];
    try {
      const cands = await searchArtists(names[0], 5);
      const exact = cands.find(c => names.some(n => exactArtist(c.name, n)));
      if (exact) {
        discVars = (await artistAlbums(exact.id, 100))
          .filter(d => d.cover)
          .map(d => ({ title: d.title, cover: d.cover, v: titleVariants(d.title, names) }));
      }
    } catch { /* leave empty — a miss, never a wrong cover */ }

    for (const r of rows) {
      let cover: string | null = null, via = '', how: 'artist' | 'search' = 'artist';

      const av = titleVariants(r.title, names);
      const nv = r.native_title ? titleVariants(r.native_title, names) : null;
      const aHit = discVars.find(d => titlesMatch(av, d.v) || (nv ? titlesMatch(nv, d.v) : false));
      if (aHit) { cover = aHit.cover; via = aHit.title; how = 'artist'; }

      // ── strategy 2: per-row search, strict, only for what strategy 1 missed ──
      if (!cover && !NO_SEARCH) {
        const artist = primaryArtist(r.artist_display ?? '');
        for (const t of [r.title, r.native_title].filter(Boolean) as string[]) {
          let hits: DzAlbumHit[] = [];
          try { hits = await searchAlbums(artist, t, 5); } catch { hits = []; }
          const nt = norm(t);
          const h = hits.find(x => x.cover && exactArtist(x.artist, artist) && norm(x.title) === nt);
          if (h) { cover = h.cover; via = `${h.artist} · ${h.title}`; how = 'search'; break; }
        }
      }

      processed++;
      if (cover && cover !== r.cover_url) {
        if (how === 'artist') viaArtist++; else viaSearch++;
        const swap: Swap = { id: r.id, artist: r.artist_display, title: r.title, old: r.cover_url, new: cover, via, how };
        if (APPLY) {
          // RETRY, AND JOURNAL ONLY WHAT ACTUALLY LANDED. This used to append the rollback entry
          // first and treat any error as a warning, which was wrong twice over: a failed write left
          // a journal line claiming a swap that never happened (so a later --rollback would set the
          // row to a value it already had), and the row was never retried because its artist is
          // marked done straight after. Statement timeouts are not hypothetical here -- they showed
          // up as soon as this pass and backfill-rg-covers-caa were both updating cover_url on
          // overlapping rows. Rows that still fail after retries go to a file instead of being lost.
          let wrote = false;
          for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
            if (attempt) await new Promise(res => setTimeout(res, 500 * 2 ** attempt));
            const { error } = await db.from('release_groups').update({ cover_url: cover }).eq('id', r.id)
              .or('cover_url.like.%coverartarchive.org%,cover_url.like.%archive.org%');
            if (!error) wrote = true;
            else if (attempt === 2) {
              console.warn(`  ! ${r.id}: ${error.message}`);
              fs.appendFileSync(FAILED, JSON.stringify({ id: r.id, title: r.title, reason: error.message }) + '\n');
            }
          }
          if (wrote) fs.appendFileSync(ROLLBACK, JSON.stringify(swap) + '\n');
          else if (how === 'artist') viaArtist--; else viaSearch--;
        } else if (viaArtist + viaSearch <= 20) {
          console.log(`  ↻ [${how}] ${r.artist_display} — ${r.title}  →  ${via}`);
        }
      } else kept++;
    }

    done.add(a.id);
    if (++artistsDone % 50 === 0) {
      if (APPLY) saveState(done);
      const moved = viaArtist + viaSearch;
      console.log(`  ${artistsDone}/${targets.length} artists · ${processed} rows · moved ${moved} (${(100 * moved / Math.max(processed, 1)).toFixed(0)}%)` +
                  `  [artist ${viaArtist} / search ${viaSearch}]`);
    }
  }
  if (APPLY) saveState(done);

  const moved = viaArtist + viaSearch;
  console.log(`\n  rows processed   ${processed}`);
  console.log(`  moved to Deezer  ${moved} (${(100 * moved / Math.max(processed, 1)).toFixed(1)}%)  — artist ${viaArtist}, search ${viaSearch}`);
  console.log(`  left on CAA      ${kept}`);
  if (APPLY) console.log(`  rollback → ${ROLLBACK}  (restore with --rollback=${ROLLBACK})`);
  else console.log('  report only — re-run with --apply to overwrite');
}

if (process.argv[1] && process.argv[1].endsWith('upgrade-covers-deezer.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
