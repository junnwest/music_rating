// Resolves each Korea-flagged item (artist or album) to a VERIFIED Korean
// Wikipedia (ko.wikipedia.org) article, same discipline as the English
// resolver: search -> description-guard -> near-exact title match after
// stripping a trailing parenthetical disambiguator. This matters more here,
// not less — already proved live that a bare artist name search for "빅뱅"
// resolves to the wrong article entirely (not the band), while the correctly
// disambiguated "빅뱅 (음악 그룹)" is the real one.
//
// Input: scripts/output/korean-names.json (from fetch-korean-names.ts)
// Output: scripts/output/korean-wiki-resolved.json — one entry per KR item
// with its resolved title + real median monthly ko.wikipedia pageviews.
//
// Run: node scripts/resolve-korean-wikipedia.mjs
import fs from 'fs';

const WIKI_API = 'https://ko.wikipedia.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const UA = 'sillajuku-korean-wiki-resolver/1.0 (admin@sillajuku.com)';
const IN_PATH = 'scripts/output/korean-names.json';
const OUT_PATH = 'scripts/output/korean-wiki-resolved.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Korean description guards — Wikipedia short descriptions aren't reliably
// populated on ko.wikipedia the way they are on en.wikipedia, so this also
// falls back to checking the article's opening extract when description is
// empty.
const ARTIST_GUARD = /가수|래퍼|음악가|그룹|밴드|듀오|아이돌|작곡가|작사가|프로듀서|싱어송라이터|보컬/;
const ALBUM_GUARD = /앨범|음반|EP|믹스테이프|정규|싱글/;

async function wikiGet(params, attempt = 0) {
  await sleep(280);
  const url = new URL(WIKI_API);
  Object.entries({ ...params, format: 'json' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return wikiGet(params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function getTextForGuard(titles) {
  // description prop is sparse on ko.wikipedia; pull a short extract too as
  // a fallback signal for the same guard check.
  const desc = await wikiGet({ action: 'query', titles, prop: 'description|extracts', exintro: '1', explaintext: '1', exchars: '300' });
  return Object.values(desc?.query?.pages ?? {});
}

async function resolveKorean(type, query, expectedTitle, expectedArtistNative) {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: query, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const pages = await getTextForGuard(titles);
  const guard = type === 'album' ? ALBUM_GUARD : ARTIST_GUARD;
  const expectedTitleNorm = norm(expectedTitle);

  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    const text = (page?.description ?? '') + ' ' + (page?.extract ?? '');
    if (!guard.test(text)) continue;
    if (type === 'album' && expectedArtistNative && !text.includes(expectedArtistNative)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedTitleNorm) continue;
    return { title: page.title };
  }
  return null;
}

async function fetchMedianViews(wikiTitle) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, 1));
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
  const excludeYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/ko.wikipedia/all-access/user/${article}/monthly/${fmt(start)}/${fmt(now)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  const items = (j.items ?? []).filter((it) => it.timestamp.slice(0, 6) !== excludeYm);
  if (!items.length) return null;
  const views = items.map((it) => it.views).sort((a, b) => a - b);
  return views[Math.floor(views.length / 2)];
}

async function main() {
  const items = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  const targets = items.filter((i) => i.country === 'KR');
  console.log(`Resolving ${targets.length} Korea-flagged items on ko.wikipedia...`);

  const out = [];
  let done = 0;
  for (const item of targets) {
    let resolved = null;
    if (item.type === 'artist' && item.artistNameNative) {
      resolved = await resolveKorean('artist', item.artistNameNative, item.artistNameNative, null);
    } else if (item.type === 'album') {
      const albumQueryTitle = item.albumNativeTitle || item.name.split(' — ')[0];
      const artistQuery = item.artistNameNative || item.name.split(' — ')[1] || '';
      const query = `${albumQueryTitle} ${artistQuery} 앨범`;
      resolved = await resolveKorean('album', query, albumQueryTitle, item.artistNameNative);
    }
    const medianViews = resolved ? await fetchMedianViews(resolved.title) : null;
    out.push({ id: item.id, type: item.type, name: item.name, wikiTitleKo: resolved?.title ?? null, medianViewsKo: medianViews });
    done++;
    if (done % 20 === 0) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r${done}/${targets.length}`);
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  const resolvedCount = out.filter((o) => o.wikiTitleKo).length;
  console.log(`\nDone. Resolved ${resolvedCount}/${out.length} on ko.wikipedia.`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
