/**
 * How much of the proxied cover load could move off our bandwidth, and which lookup strategy gets
 * the most of it? REPORT ONLY — writes nothing, and has no --apply by design.
 *
 * WHY IT MATTERS. Cover.tsx routes Cover Art Archive URLs through /api/img, because CAA
 * 307-redirects to archive.org and takes 1.5-2.5s cold; the proxy follows that once server-side and
 * the Vercel edge caches the bytes. iTunes and Deezer are fast CDNs and go straight to the client.
 * So CAA covers cost us bandwidth and Deezer covers cost us nothing, and 370,850 release groups
 * (75.5% of the catalogue) sit on the proxied path.
 *
 * TWO STRATEGIES, MEASURED SIDE BY SIDE ON THE SAME ROWS:
 *
 *   search — one Deezer album search per release group, `artist:"X" album:"Y"`, top 5 hits, then
 *            exact normalized title AND artist equality. This is what upgrade-kr-covers-deezer.ts
 *            does today. It measured 40.8% (n=400).
 *
 *   artist — resolve the Deezer ARTIST once by exact name, pull their whole discography, and match
 *            our titles against it with titleVariants/titlesMatch. Three reasons to expect more:
 *            the top-5 cap disappears (a prolific artist's older album never surfaces in a 5-row
 *            search), the shared matcher understands ordinal tails, leading artist names, dash-
 *            fenced edition groups and repackages where plain string equality does not, and looser
 *            title matching is SAFE here in a way it is not for search, because identity is already
 *            pinned by an exact artist match rather than being inferred from the same string.
 *            It is also far cheaper: ~2 requests per ARTIST instead of 1-2 per release group.
 *
 * Reported per release-group type, because the rate is not uniform -- an obscure classical
 * recording and a K-pop single are very different propositions on Deezer.
 *
 *   npx tsx --env-file=.env.local scripts/audit-deezer-cover-coverage.ts --artists=120
 */
import * as fs from 'node:fs';
import { searchAlbums, searchArtists, artistAlbums, type DzAlbumHit } from './deezer-client';
import { titleVariants, titlesMatch } from './resolve-stub-itunes';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const ARTISTS = Number(arg('--artists') ?? 120);
const PER_ARTIST = Number(arg('--per-artist') ?? 4);
const OUT = arg('--out') ?? 'scripts/data/deezer-cover-coverage.json';

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const exactTitle = (a: string, b: string) => !!a && a === b;
const exactArtist = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && x === y; };
const primaryArtist = (s: string) => s.split(/\s*(?:&|feat\.?|ft\.?|,|x|×|vs\.?|with)\s+/i)[0].trim() || s;

interface Row {
  id: string; title: string; native_title: string | null; artist_display: string;
  release_group_type: string; artist_id: string; artist_name: string; artist_native: string | null;
}

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

const pct = (h: number, n: number) => (n ? (100 * h / n).toFixed(0) : '--') + '%';

async function main() {
  // Sample ARTISTS at random, then take up to PER_ARTIST of their proxied rows. Sampling by artist
  // rather than by row is what makes the two strategies comparable: the artist strategy amortises
  // its lookup over an artist's rows, so a row-random sample would understate its cost advantage
  // and misrepresent its hit rate.
  const rows = await sql<Row>(`
    with picked as (
      select a.id, a.name, a.name_native
        from artists a
       where exists (
         select 1 from release_groups rg
          where rg.primary_artist_id = a.id
            and (rg.cover_url like '%coverartarchive.org%' or rg.cover_url like '%archive.org%'))
       order by random()
       limit ${ARTISTS}
    ),
    ranked as (
      select rg.id::text, rg.title, rg.native_title, rg.artist_display, rg.release_group_type,
             p.id::text as artist_id, p.name as artist_name, p.name_native as artist_native,
             row_number() over (partition by p.id order by rg.id) rn
        from picked p
        join release_groups rg on rg.primary_artist_id = p.id
       where rg.cover_url like '%coverartarchive.org%' or rg.cover_url like '%archive.org%'
    )
    select id, title, native_title, artist_display, release_group_type,
           artist_id, artist_name, artist_native
      from ranked where rn <= ${PER_ARTIST}`);

  const byArtist = new Map<string, Row[]>();
  for (const r of rows) {
    const l = byArtist.get(r.artist_id); if (l) l.push(r); else byArtist.set(r.artist_id, [r]);
  }
  console.log(`[deezer-coverage] ${rows.length} rows across ${byArtist.size} artists (report only)\n`);

  // UNION is the number that actually matters for a decision. The two strategies fail differently
  // -- search misses a title whose wording differs (a format/edition suffix, a leading artist name,
  // an accent), artist misses an ARTIST whose name Deezer spells differently, and when it misses it
  // misses every row for them at once. So neither rate is the ceiling; running both is.
  const stat = new Map<string, { n: number; search: number; artist: number; either: number }>();
  const bump = (k: string, s: boolean, a: boolean) => {
    const v = stat.get(k) ?? { n: 0, search: 0, artist: 0, either: 0 };
    v.n++; if (s) v.search++; if (a) v.artist++; if (s || a) v.either++; stat.set(k, v);
  };

  let reqSearch = 0, reqArtist = 0, done = 0;
  const gained: string[] = [];

  for (const [, group] of byArtist) {
    const first = group[0];
    const names = [first.artist_name, first.artist_native].filter(Boolean) as string[];

    // ── artist strategy: resolve once, pull the discography once ──
    let disc: { title: string; cover: string | null }[] = [];
    try {
      const cands = await searchArtists(names[0], 5); reqArtist++;
      const exact = cands.find(c => names.some(n => exactArtist(c.name, n)));
      if (exact) {
        disc = (await artistAlbums(exact.id, 100)).map(a => ({ title: a.title, cover: a.cover }));
        reqArtist++;
      }
    } catch { /* leave disc empty — counts as a miss, never as a wrong cover */ }
    const discVars = disc.map(d => ({ ...d, v: titleVariants(d.title, names) }));

    for (const r of group) {
      // ── search strategy (what we do today) ──
      const artist = primaryArtist(r.artist_display ?? '');
      const titles = [r.title, r.native_title].filter(Boolean) as string[];
      let sHit: DzAlbumHit | undefined;
      for (const t of titles) {
        let hits: DzAlbumHit[] = [];
        try { hits = await searchAlbums(artist, t, 5); reqSearch++; } catch { hits = []; }
        const nt = norm(t);
        sHit = hits.find(h => h.cover && exactArtist(h.artist, artist) && exactTitle(norm(h.title), nt));
        if (sHit) break;
      }

      // ── artist strategy match ──
      const av = titleVariants(r.title, names);
      const nv = r.native_title ? titleVariants(r.native_title, names) : null;
      const aHit = discVars.find(d => d.cover && (titlesMatch(av, d.v) || (nv ? titlesMatch(nv, d.v) : false)));

      bump(r.release_group_type ?? 'unknown', !!sHit, !!aHit);
      bump('ALL', !!sHit, !!aHit);
      if (aHit && !sHit && gained.length < 12) gained.push(`${r.artist_display} — "${r.title}"  ->  "${aHit.title}"`);

      if (++done % 50 === 0) {
        const a = stat.get('ALL')!;
        console.log(`  ${done}/${rows.length}  search ${pct(a.search, a.n)}  artist ${pct(a.artist, a.n)}`);
      }
    }
  }

  const all = stat.get('ALL')!;
  const ci = (h: number) => {
    const p = h / all.n, se = Math.sqrt(p * (1 - p) / all.n);
    return `${(100 * p).toFixed(1)}% (95% CI ${(100 * Math.max(0, p - 1.96 * se)).toFixed(1)}-${(100 * Math.min(1, p + 1.96 * se)).toFixed(1)}%)`;
  };
  const POOL = 370850;

  console.log('\n  type            n     search   artist');
  for (const [k, s] of [...stat].filter(([k]) => k !== 'ALL').sort((a, b) => b[1].n - a[1].n))
    console.log(`    ${k.padEnd(13)} ${String(s.n).padStart(4)}   ${pct(s.search, s.n).padStart(6)}   ${pct(s.artist, s.n).padStart(6)}`);

  console.log(`\n  search strategy  ${ci(all.search)}   ${reqSearch} Deezer requests`);
  console.log(`  artist strategy  ${ci(all.artist)}   ${reqArtist} Deezer requests`);
  console.log(`  BOTH together    ${ci(all.either)}   ${reqSearch + reqArtist} Deezer requests`);
  console.log(`  movable off /api/img — search ~${Math.round(all.search / all.n * POOL).toLocaleString()}` +
              `, artist ~${Math.round(all.artist / all.n * POOL).toLocaleString()}` +
              `, BOTH ~${Math.round(all.either / all.n * POOL).toLocaleString()} of ${POOL.toLocaleString()}`);
  if (gained.length) { console.log('\n  found by artist strategy, missed by search:'); gained.forEach(g => console.log('    ' + g)); }

  fs.writeFileSync(OUT, JSON.stringify({ rows: rows.length, artists: byArtist.size, stat: [...stat] }, null, 2));
  console.log(`\n  report → ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith('audit-deezer-cover-coverage.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
