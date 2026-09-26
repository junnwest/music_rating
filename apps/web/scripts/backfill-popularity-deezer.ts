/**
 * Give `artists.popularity` a real value, from Deezer fan counts.
 *
 * WHY. The column exists and is used in two places that matter -- the search ranking adds
 * `coalesce(a.popularity, 0)` to every candidate's score, and the ingest queue has no notion of
 * importance at all -- but it is populated on 0 of 72,179 rows. It is a dead Spotify column, left
 * behind when Spotify was retired from data collection. Every consumer of it has therefore been
 * adding exactly zero since it was written.
 *
 * The consequences are the ones reported from the app: searching "kid" returned artists nobody has
 * heard of because the only tiebreaker was insertion order, and CATALOG_GAP_REPORT.md cause 5
 * (charting artists sitting as empty stubs) cannot be fixed without knowing which stubs matter --
 * there are 38,804 of them and no way to rank them.
 *
 * WHY DEEZER. `nbFan` comes back on the artist search this repo already makes for covers and
 * avatars, and was being discarded. No new dependency, no auth, and it is a real audience number
 * rather than an editorial guess.
 *
 * SCALE. Fan counts span 0 to roughly 20 million, so storing them raw would swamp every other term
 * in the search score (an exact-name hit is 10,000). Stored instead as 0-100 on a log scale, which
 * is both the conventional "popularity" range this column was designed for and the shape that
 * matches how people actually rank artists -- the gap between 1k and 10k fans matters more than the
 * gap between 10M and 11M.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-popularity-deezer.ts --limit=200
 *   npx tsx --env-file=.env.local scripts/backfill-popularity-deezer.ts --apply
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchArtists as dzSearchArtists } from './deezer-client';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('--limit') ?? Infinity);
const STATE = 'scripts/data/popularity-state.json';

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');

/** Deezer fans -> 0-100. log10(20M) ~= 7.3, so 20M maps to 100 and 1k to about 41. */
const scale = (fans: number) =>
  Math.max(0, Math.min(100, Math.round((Math.log10(Math.max(0, fans) + 1) / 7.3) * 100)));

const loadState = (): Set<string> => { try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8')).done as string[]); } catch { return new Set(); } };
const saveState = (s: Set<string>) => fs.writeFileSync(STATE, JSON.stringify({ done: [...s] }));

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

async function main() {
  const db = getDB();
  const done = loadState();

  // Artists a user can actually land on come first: anything with its own releases, then stubs that
  // are credited on someone else's release. A stub credited on nothing is invisible either way.
  const rows = await sql<{ id: string; name: string; name_native: string | null; own: number; credits: number }>(`
    select a.id::text, a.name, a.name_native,
           (select count(*) from release_groups rg where rg.primary_artist_id = a.id) own,
           (select count(*) from release_group_artists rga where rga.artist_id = a.id) credits
      from artists a
     where a.popularity is null
     order by own desc, credits desc
     limit ${Number.isFinite(LIMIT) ? LIMIT : 200000}`);

  const todo = rows.filter(r => !done.has(r.id));
  console.log(`[popularity] ${todo.length} artist(s) without a value${APPLY ? '  *** APPLY ***' : '  (report only)'}`);

  let matched = 0, miss = 0, processed = 0;
  for (const r of todo) {
    const names = [r.name, r.name_native].filter(Boolean) as string[];
    let fans: number | null = null, via = '';
    for (const n of names) {
      let hits: { name: string; nbFan: number }[] = [];
      try { hits = await dzSearchArtists(n, 5) as any; } catch { hits = []; }
      const want = norm(n);
      // Among exact-name matches take the BIGGEST, not the first. Deezer carries duplicate and
      // tribute entities under identical names, and the first hit is not always the real artist:
      // "Nat King Cole" resolved to a 354-fan entity rather than the real one, which would have
      // recorded him as less popular than an obscure noise act.
      const hit = hits.filter(h => norm(h.name) === want)
                      .sort((x, y) => (y.nbFan ?? 0) - (x.nbFan ?? 0))[0];
      if (hit) { fans = hit.nbFan; via = hit.name; break; }
    }
    processed++;
    if (fans != null) {
      matched++;
      const p = scale(fans);
      if (APPLY) {
        const { error } = await db.from('artists').update({ popularity: p }).eq('id', r.id);
        if (error) console.warn(`  ! ${r.name}: ${error.message}`);
      } else if (matched <= 15) {
        console.log(`  ${String(p).padStart(3)}  ${fans.toLocaleString().padStart(11)} fans  ${r.name}  (${via})`);
      }
    } else miss++;
    done.add(r.id);
    if (processed % 200 === 0) {
      if (APPLY) saveState(done);
      console.log(`  ${processed}/${todo.length}  matched ${matched} (${(100 * matched / processed).toFixed(0)}%)`);
    }
  }
  if (APPLY) saveState(done);
  console.log(`\n  processed ${processed}, matched ${matched}, no Deezer match ${miss}`);
  if (!APPLY) console.log('  report only — re-run with --apply');
}

if (process.argv[1] && process.argv[1].endsWith('backfill-popularity-deezer.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
