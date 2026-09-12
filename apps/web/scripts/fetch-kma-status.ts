/**
 * Adds a real "critic-panel prestige" signal for Korean artists: whether
 * they've won or been nominated for the Korean Music Awards (한국대중음악상),
 * a critic/journalist-panel award explicitly distinct from fan-vote/sales
 * awards like MAMA, Melon Music Awards, Golden Disc, Seoul Music Awards, and
 * Circle Chart — which idol groups dominate by design. Verified live: 5/10
 * user-confirmed "suitable" Korean artists (Jay Park, Zion.T, IU, The
 * Quiett, Verbal Jint) carry the KMA Wikipedia category, vs 0/9 idol-group
 * "not suitable" acts checked (SHINee, IVE, TXT, 2PM, DAY6, CHUU, PENTAGON,
 * BEAST) — a much cleaner separation than genre tags or creative-involvement
 * gave.
 *
 * Resolves each Korean artist's Wikipedia page (native name from
 * artists.name_native, falling back to the raw name), fetches its
 * categories, and tests for 한국대중음악상 수상/후보 (winner/nominee).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fetch-kma-status.ts
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars.'); process.exit(1); }
const db = createClient(url, key);

const UA = 'sillajuku-kma-status/1.0 (admin@sillajuku.com)';
const KO_API = 'https://ko.wikipedia.org/w/api.php';
const KO_ARTIST_GUARD = /가수|래퍼|음악가|그룹|밴드|듀오|아이돌|작곡가|작사가|프로듀서|싱어송라이터|보컬/;
const KMA_WIN_RE = /한국대중음악상 수상/;
const KMA_NOMINEE_RE = /한국대중음악상.*(후보|후보에)/;
const HANGUL_RE = /[가-힣]/;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function apiGet(api: string, params: Record<string, string>, attempt = 0): Promise<any> {
  await sleep(280);
  const u = new URL(api);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return apiGet(api, params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function resolveKoArtist(query: string) {
  const search = await apiGet(KO_API, { action: 'query', list: 'search', srsearch: query, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h: any) => h.title).join('|');
  const data = await apiGet(KO_API, { action: 'query', titles, prop: 'description|extracts|categories', exintro: '1', explaintext: '1', exchars: '300', cllimit: '300' });
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const expectedNorm = norm(query);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    const text = (page?.description ?? '') + ' ' + (page?.extract ?? '');
    if (!KO_ARTIST_GUARD.test(text)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedNorm) continue;
    const cats: string[] = (page.categories ?? []).map((c: any) => c.title as string);
    return { title: page.title as string, categories: cats };
  }
  return null;
}

async function main() {
  const final: any[] = JSON.parse(fs.readFileSync('scripts/output/final-decisions.json', 'utf8'));
  const newCases: any[] = fs.existsSync('scripts/output/new-training-cases.json') ? JSON.parse(fs.readFileSync('scripts/output/new-training-cases.json', 'utf8')) : [];
  const holdout30: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const holdout20: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-extra20.json', 'utf8'));

  const trainingKoreanArtists = final.filter((m) => m.country === 'KR').map((m) => (m.type === 'artist' ? m.name : m.artist));
  const newCaseKoreanArtists = newCases.filter((c) => c.country === 'KR').map((c) => c.artist);
  const holdoutArtists = [...new Set([...holdout30.map((h) => h.artist), ...holdout20.map((h) => h.artist)])];

  const allArtists = [...new Set([...trainingKoreanArtists, ...newCaseKoreanArtists, ...holdoutArtists])];
  console.log(`Checking KMA status for ${allArtists.length} unique artists (Korean training/new-case names + all holdout names, holdout ones filtered by DB country below)...`);

  const artistByName = new Map<string, { name_native: string | null; native_language: string | null; country: string | null }>();
  for (let i = 0; i < allArtists.length; i += 50) {
    const chunk = allArtists.slice(i, i + 50);
    const { data, error } = await db.from('artists').select('name, name_native, native_language, country').in('name', chunk);
    if (error) { console.error(error.message); continue; }
    for (const r of data ?? []) {
      const existing = artistByName.get(r.name);
      if (!existing || r.country === 'KR') artistByName.set(r.name, { name_native: r.name_native, native_language: r.native_language, country: r.country });
    }
  }

  const out: Record<string, { wikiTitleKo: string | null; kmaWin: boolean; kmaNominee: boolean }> = {};
  for (const artist of allArtists) {
    const info = artistByName.get(artist);
    const isKorean = trainingKoreanArtists.includes(artist) || newCaseKoreanArtists.includes(artist) || info?.native_language === 'ko' || info?.country === 'KR' || HANGUL_RE.test(artist);
    if (!isKorean) { out[artist] = { wikiTitleKo: null, kmaWin: false, kmaNominee: false }; continue; }

    const candidates = [info?.name_native, HANGUL_RE.test(artist) ? artist : null, artist].filter(
      (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
    );
    let resolved: { title: string; categories: string[] } | null = null;
    for (const q of candidates) {
      resolved = await resolveKoArtist(q);
      if (resolved) break;
    }
    if (!resolved) {
      console.log(`${artist} -> not resolved on ko.wikipedia`);
      out[artist] = { wikiTitleKo: null, kmaWin: false, kmaNominee: false };
      continue;
    }
    const catText = resolved.categories.join(' | ');
    const kmaWin = KMA_WIN_RE.test(catText);
    const kmaNominee = !kmaWin && KMA_NOMINEE_RE.test(catText);
    console.log(`${artist} -> ${resolved.title} | KMA win: ${kmaWin} | KMA nominee: ${kmaNominee}`);
    out[artist] = { wikiTitleKo: resolved.title, kmaWin, kmaNominee };
  }

  fs.writeFileSync('scripts/output/kma-status.json', JSON.stringify(out, null, 2));
  const wins = Object.values(out).filter((x) => x.kmaWin).length;
  const noms = Object.values(out).filter((x) => x.kmaNominee).length;
  console.log(`\n${wins} KMA winners, ${noms} KMA nominees (non-winners) out of ${allArtists.length} artists checked.`);
  console.log('Wrote scripts/output/kma-status.json');
}

main();
