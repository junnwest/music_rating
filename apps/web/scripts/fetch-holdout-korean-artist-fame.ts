/**
 * Real fix for a bug found via user diagnosis on the 50-item holdout scan:
 * enrich-extra20.mjs tried to resolve Korean Wikipedia pages by matching the
 * catalog's English album title directly (e.g. "IVE EMPATHY"), which almost
 * never matches the actual Korean-language article title ("엠파시"). That
 * silently zeroed out the Korean-fame signal for nearly every Korean act in
 * the holdout, leaving `is_korea=1` as the only real driver of Path A for
 * K-pop idol groups — exactly backwards from the intent (idol fame alone
 * should NOT be enough; real Korean *awareness* matters, but it needs to
 * come from a real measurement, not a title-matching failure).
 *
 * The original training pipeline (resolve-korean-wikipedia.mjs) avoided
 * this by resolving at the ARTIST level using the real native Korean name
 * from `artists.name_native` (native_language = 'ko'). This script applies
 * that same fix to the 50-item holdout: look up each artist's native name,
 * resolve their Korean Wikipedia page directly (not the album), and fetch
 * real monthly pageviews.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fetch-holdout-korean-artist-fame.ts
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('Missing Supabase env vars.'); process.exit(1); }
const db = createClient(url, key);

const UA = 'sillajuku-holdout-ko-artist-fame/1.0 (admin@sillajuku.com)';
const KO_API = 'https://ko.wikipedia.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const KO_ARTIST_GUARD = /가수|래퍼|음악가|그룹|밴드|듀오|아이돌|작곡가|작사가|프로듀서|싱어송라이터|보컬/;

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function medianOf(arr: number[] | null) { if (!arr || !arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
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

async function resolveKoArtist(nativeName: string) {
  const search = await apiGet(KO_API, { action: 'query', list: 'search', srsearch: nativeName, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h: any) => h.title).join('|');
  const data = await apiGet(KO_API, { action: 'query', titles, prop: 'description|extracts', exintro: '1', explaintext: '1', exchars: '300' });
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const expectedNorm = norm(nativeName);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    const text = (page?.description ?? '') + ' ' + (page?.extract ?? '');
    if (!KO_ARTIST_GUARD.test(text)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedNorm) continue;
    return { title: page.title as string };
  }
  return null;
}

async function fetchSeries(wikiTitle: string) {
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const u = `${PAGEVIEWS_API}/ko.wikipedia/all-access/user/${article}/monthly/2015070100/2026090100`;
  const res = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  return (j.items ?? []).map((it: any) => it.views as number);
}

const HANGUL_RE = /[가-힣]/;

async function main() {
  const holdout30: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const holdout20: any[] = JSON.parse(fs.readFileSync('scripts/output/holdout-extra20.json', 'utf8'));
  const allArtists = [...new Set([...holdout30.map((h) => h.artist), ...holdout20.map((h) => h.artist)])];

  const artistByName = new Map<string, { name_native: string | null; native_language: string | null; country: string | null }>();
  for (let i = 0; i < allArtists.length; i += 50) {
    const chunk = allArtists.slice(i, i + 50);
    const { data, error } = await db.from('artists').select('name, name_native, native_language, country').in('name', chunk);
    if (error) { console.error(error.message); continue; }
    for (const r of data ?? []) {
      // Names can collide across unrelated artists (e.g. a Korean "IVE" and
      // an unrelated German "IVE"). Prefer the Korean-country row when both
      // are present instead of taking whichever the DB happens to return.
      const existing = artistByName.get(r.name);
      if (!existing || r.country === 'KR') artistByName.set(r.name, { name_native: r.name_native, native_language: r.native_language, country: r.country });
    }
  }

  const out: Record<string, { koWikiTitle: string | null; koMedianViewsArtist: number | null }> = {};
  for (const artist of allArtists) {
    const info = artistByName.get(artist);
    const isKorean = info?.native_language === 'ko' || info?.country === 'KR' || HANGUL_RE.test(artist);
    if (!isKorean) {
      out[artist] = { koWikiTitle: null, koMedianViewsArtist: null };
      continue;
    }
    // Try the DB's native name first, then fall back to the raw artist
    // string itself (works when it's already Hangul, e.g. "창모"), then to
    // the plain English/romanized name (Korean Wikipedia sometimes titles
    // Latin-alphabet group names in English, e.g. many K-pop groups).
    const candidates = [info?.name_native, HANGUL_RE.test(artist) ? artist : null, artist].filter(
      (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
    );
    let resolved: { title: string } | null = null;
    let usedQuery: string | null = null;
    for (const q of candidates) {
      resolved = await resolveKoArtist(q);
      if (resolved) { usedQuery = q; break; }
    }
    if (!resolved) {
      console.log(`${artist} (tried: ${candidates.join(', ')}) -> not resolved on ko.wikipedia`);
      out[artist] = { koWikiTitle: null, koMedianViewsArtist: null };
      continue;
    }
    const series = await fetchSeries(resolved.title);
    const median = medianOf(series);
    console.log(`${artist} (${usedQuery}) -> ${resolved.title}, medianViews=${median}`);
    out[artist] = { koWikiTitle: resolved.title, koMedianViewsArtist: median };
  }

  fs.writeFileSync('scripts/output/holdout-korean-artist-fame.json', JSON.stringify(out, null, 2));
  const resolvedCount = Object.values(out).filter((x) => x.koWikiTitle).length;
  console.log(`\nResolved ${resolvedCount}/${allArtists.length} Korean artist Wikipedia pages.`);
  console.log('Wrote scripts/output/holdout-korean-artist-fame.json');
}

main();
