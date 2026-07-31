/**
 * REPORT-ONLY measurement of the "zero-release artist" residual (2026-07-28).
 *
 * BACKGROUND. The `area` discovery lane (2026-07-17) sweeps MusicBrainz for every `country:KR` /
 * `area:<city>` ARTIST ENTITY and queues them all by MBID. MB entities exist independently of
 * releases — anyone can create one to hang a credit, a URL rel, or a standalone recording on — so
 * our release-group-driven ingest writes nothing for them, yet still marks them `tracks_done`.
 * Result: 8,973 artists (13.3%; 7,662 KR = 61.7% of all KR artists) have zero releases. Migration
 * 20260728000000 hides them from search; this script measures how many are actually RECOVERABLE.
 *
 * WHY IT NEEDS MEASURING. None of the existing fallback lanes can touch this population, because
 * each needs an existing release to establish identity:
 *   • discover-itunes-backfill  → aborts on 'no owned release-groups' (title-overlap identity gate)
 *   • discover-itunes-recency   → needs a seed title to resolve the streaming artist id
 *   • resolve-thin-artists      → needs ≥1 MB feature credit as a corroboration anchor
 * So the open question is not "does their music exist" but "can we identify them CONFIDENTLY
 * enough to attach a discography without risking the wrong one" — the project's standing
 * missing > wrong rule. This script answers that with a number instead of a guess.
 *
 * SIGNALS, strongest first (this is the whole point — a name match alone is NOT enough):
 *   HARD_LINK  MB carries a Spotify/Apple/Deezer artist URL relationship → an unambiguous id.
 *              No name matching involved, so this is safe to auto-ingest.
 *   LIKELY     No hard link, but a Spotify artist search on the artist's own name returns an
 *              EXACT normalized name match that is UNIQUE among the results, AND the name is
 *              distinctive (not a short single-token CJK personal name). Same distinctiveness
 *              guard as resolve-thin-artists.ts — 김형우 is collision-prone, 스카이민혁 is not.
 *   AMBIGUOUS  A candidate exists but corroboration is too weak (generic name, or several equally
 *              good matches). Recoverable only with human review.
 *   NONE       No streaming candidate at all — most likely a credited-only person (session
 *              player, composer, TV personality) with no discography anywhere.
 *
 * WRITES NOTHING. There is no --ingest flag by design: this is the measurement that decides
 * whether a resolver is worth building, not the resolver.
 *
 *   npx tsx --env-file=.env.local scripts/audit-empty-artists.ts --sample=500
 *   npx tsx --env-file=.env.local scripts/audit-empty-artists.ts --all      # full worklist, ~3h
 *   npx tsx --env-file=.env.local scripts/audit-empty-artists.ts --all --resume
 */
import * as fs from 'fs';
import * as path from 'path';
import { searchSpotifyArtists } from '../lib/spotify';

const args = process.argv.slice(2);
const arg = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const SAMPLE = Number(arg('sample') ?? 500);
const ALL = args.includes('--all');
const RESUME = args.includes('--resume');
const COUNTRY = arg('country') ?? null;

const STATE = path.join(__dirname, 'audit-empty-artists-state.json');
const OUT = path.join(__dirname, 'data', 'empty-artists-report.json');

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required'); process.exit(1); }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Candidates come from the Management API, NOT PostgREST: a `.in()` over a page of ids silently
 *  truncates at the 1000-row cap, which misreads well-populated artists as empty. */
async function sql<T = any>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── MusicBrainz: one call per artist for URL relationships (the hard-link signal) ──
const MB_UA = 'sillajuku-empty-audit/1.0 ( p.redee80@gmail.com )';
async function mbUrlRels(mbid: string, attempt = 0): Promise<{ spotify?: string; apple?: string; deezer?: string } | null> {
  await sleep(1100); // MB allows ~1 req/s
  try {
    const r = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, { headers: { 'User-Agent': MB_UA } });
    if (r.status === 503 || r.status === 429) {
      if (attempt >= 4) return null;
      await sleep(2000 * (attempt + 1));
      return mbUrlRels(mbid, attempt + 1);
    }
    if (!r.ok) return null;
    const j: any = await r.json();
    const out: { spotify?: string; apple?: string; deezer?: string } = {};
    for (const rel of j.relations ?? []) {
      const u: string = rel?.url?.resource ?? '';
      const sp = u.match(/open\.spotify\.com\/artist\/([A-Za-z0-9]+)/);
      const ap = u.match(/music\.apple\.com\/[^/]+\/artist\/[^/]*\/?(\d+)/);
      const dz = u.match(/deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/);
      if (sp && !out.spotify) out.spotify = sp[1];
      if (ap && !out.apple) out.apple = ap[1];
      if (dz && !out.deezer) out.deezer = dz[1];
    }
    return out;
  } catch { return null; }
}

// ── Name confidence (mirrors resolve-thin-artists.ts's guards) ──
const norm = (s: string) => (s ?? '').toLowerCase().replace(/[''`"]/g, '')
  .replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ').replace(/\s+/g, ' ').trim();
/** A short single-token CJK personal name (김형우, 민수) collides constantly — never auto-confirm it. */
const isGenericName = (n: string) => {
  const s = (n ?? '').trim();
  const cjk = (s.match(/[가-힣぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
  return s.split(/\s+/).length === 1 && cjk > 0 && cjk <= 3;
};

type Verdict = 'HARD_LINK' | 'LIKELY' | 'AMBIGUOUS' | 'NONE';
interface Row {
  id: string; name: string; native: string | null; country: string | null; mbid: string;
  verdict: Verdict; spotifyId: string | null; spotifyName: string | null;
  hardLink: string | null; note: string;
}

async function classify(a: { id: string; name: string; name_native: string | null; country: string | null; mbid: string }): Promise<Row> {
  const native = a.name_native ?? (/[가-힣]/.test(a.name) ? a.name : null);
  const base: Row = {
    id: a.id, name: a.name, native, country: a.country, mbid: a.mbid,
    verdict: 'NONE', spotifyId: null, spotifyName: null, hardLink: null, note: '',
  };

  // 1. HARD LINK — an explicit streaming id in MB. No name guessing needed.
  const rels = await mbUrlRels(a.mbid);
  if (rels?.spotify || rels?.apple || rels?.deezer) {
    const which = rels.spotify ? `spotify:${rels.spotify}` : rels.apple ? `apple:${rels.apple}` : `deezer:${rels.deezer}`;
    return { ...base, verdict: 'HARD_LINK', spotifyId: rels.spotify ?? null, hardLink: which, note: 'MB url-rel' };
  }

  // 2. Spotify name search. Try the native name first (KR acts are listed natively), then Latin.
  const terms = [native, a.name].filter(Boolean) as string[];
  for (const term of terms) {
    let hits: { id: string; name: string; popularity: number }[] = [];
    try { hits = await searchSpotifyArtists(term, 10); } catch { /* circuit open / transient */ }
    if (!hits.length) continue;

    const want = norm(term);
    const exact = hits.filter(h => norm(h.name) === want);
    if (exact.length === 0) { base.note = `${hits.length} spotify hits, no exact name match`; continue; }

    const top = exact[0];
    base.spotifyId = top.id;
    base.spotifyName = top.name;
    // UNIQUE exact match + a distinctive name = confident. Anything else needs a human.
    if (exact.length === 1 && !isGenericName(term)) {
      return { ...base, verdict: 'LIKELY', note: `unique exact spotify match on "${term}"` };
    }
    return {
      ...base, verdict: 'AMBIGUOUS',
      note: exact.length > 1 ? `${exact.length} artists share this exact name` : `generic name "${term}"`,
    };
  }
  return base;
}

async function main() {
  const limit = ALL ? 100000 : SAMPLE;
  console.log(`REPORT-ONLY — ${ALL ? 'FULL SWEEP' : `sample of ${SAMPLE}`}${COUNTRY ? ` (country=${COUNTRY})` : ''}. Writes nothing.\n`);

  const rows = await sql<{ id: string; name: string; name_native: string | null; country: string | null; mbid: string }>(`
    select a.id, a.name, a.name_native, a.country, e.external_id as mbid
    from artists a
    join artist_external_ids e on e.artist_id = a.id and e.source = 'musicbrainz'
    where not exists (select 1 from release_group_artists rga where rga.artist_id = a.id)
      and not exists (select 1 from release_groups rg where rg.primary_artist_id = a.id)
      ${COUNTRY ? `and a.country = '${COUNTRY}'` : ''}
    order by md5(a.id::text)
    limit ${limit}
  `);

  let done: Row[] = [];
  if (RESUME && fs.existsSync(STATE)) {
    done = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    console.log(`Resuming — ${done.length} already classified.\n`);
  }
  const seen = new Set(done.map(r => r.id));
  const todo = rows.filter(r => !seen.has(r.id));
  console.log(`${rows.length} zero-release artists with an MBID · ${todo.length} to classify\n`);

  let n = 0;
  for (const a of todo) {
    const r = await classify(a);
    done.push(r);
    n++;
    if (r.verdict !== 'NONE') console.log(`  ${r.verdict.padEnd(10)} ${r.name}${r.native && r.native !== r.name ? ` (${r.native})` : ''} — ${r.note}`);
    if (n % 25 === 0) {
      fs.writeFileSync(STATE, JSON.stringify(done));
      const pct = ((n / todo.length) * 100).toFixed(1);
      console.log(`  … ${n}/${todo.length} (${pct}%)`);
    }
  }
  fs.writeFileSync(STATE, JSON.stringify(done));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(done, null, 2));

  const by: Record<Verdict, Row[]> = { HARD_LINK: [], LIKELY: [], AMBIGUOUS: [], NONE: [] };
  for (const r of done) by[r.verdict].push(r);
  const total = done.length || 1;

  console.log(`\n════ RESULT (${done.length} artists classified) ════`);
  for (const k of ['HARD_LINK', 'LIKELY', 'AMBIGUOUS', 'NONE'] as Verdict[]) {
    const v = by[k];
    console.log(`${k.padEnd(10)} ${String(v.length).padStart(5)}  ${((v.length / total) * 100).toFixed(1)}%`);
    if (v.length) console.log(`   e.g. ${v.slice(0, 5).map(r => r.name).join(' · ')}`);
  }
  const recoverable = by.HARD_LINK.length + by.LIKELY.length;
  console.log(`\nSafely recoverable (HARD_LINK + LIKELY): ${recoverable}/${total} = ${((recoverable / total) * 100).toFixed(1)}%`);
  if (!ALL) console.log(`Extrapolated over all 8,973: ~${Math.round((recoverable / total) * 8973)} artists.`);
  console.log(`\nFull rows → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
