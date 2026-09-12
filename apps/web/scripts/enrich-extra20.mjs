// Full enrichment for the 20 extra holdout albums, reusing the same
// verified logic as the main pipeline: EN Wikipedia (resolve + description +
// extract for creative-involvement + award categories + real pageview
// history), Korean Wikipedia, Discogs (fixed best-pressing logic), and the
// corrected recency-ratio timelessness formula (not the old degenerate
// threshold-fraction one).
import fs from 'fs';
import { Jimp } from 'jimp';

const UA = 'sillajuku-extra20/1.0 (admin@sillajuku.com)';
const EN_API = 'https://en.wikipedia.org/w/api.php';
const KO_API = 'https://ko.wikipedia.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ARTIST_GUARD = /singer|rapper|musician|band|idol|songwriter|record producer|composer|vocalist|group|duo|dj\b/i;
const ALBUM_GUARD = /\balbum\b|\bep\b|mixtape|record by|studio album|extended play/i;
const CREATIVE_RE = /songwriter|song-writer|composer|record producer|\bproducer\b|music producer/i;
const AWARD_WIN_RE = /\b(Grammy Award for|Grammy Hall of Fame|Mercury Prize|Brit Award for|MTV Video Music Award for|American Music Award for|Billboard Music Award for|iHeartRadio Music Award for|Rock and Roll Hall of Fame|Mnet Asian Music Award for|Melon Music Award for|Golden Disc Award for|Seoul Music Award for|Circle Chart Music Award for)\b/i;
const NOT_WIN_RE = /nominee|nomination/i;
const KO_ARTIST_GUARD = /가수|래퍼|음악가|그룹|밴드|듀오|아이돌|작곡가|작사가|프로듀서|싱어송라이터|보컬/;
const KO_ALBUM_GUARD = /앨범|음반|EP|믹스테이프|정규|싱글/;

async function apiGet(api, params, attempt = 0) {
  await sleep(280);
  const url = new URL(api);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return apiGet(api, params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function resolveEn(type, name, expectedArtist) {
  const q = type === 'album' ? `${name} ${expectedArtist} album` : name;
  const search = await apiGet(EN_API, { action: 'query', list: 'search', srsearch: q, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const data = await apiGet(EN_API, { action: 'query', titles, prop: 'description|extracts|categories', exintro: '1', explaintext: '1', exchars: '400', cllimit: '500' });
  const pages = Object.values(data?.query?.pages ?? {});
  const guard = type === 'album' ? ALBUM_GUARD : ARTIST_GUARD;
  const expectedTitleNorm = norm(name);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    if (!page?.description || !guard.test(page.description)) continue;
    if (type === 'album' && expectedArtist && !norm(page.description).includes(norm(expectedArtist))) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedTitleNorm) continue;
    const cats = (page.categories ?? []).map((c) => c.title.replace('Category:', ''));
    const awardWins = cats.filter((c) => AWARD_WIN_RE.test(c) && !NOT_WIN_RE.test(c));
    return { title: page.title, description: page.description, extract: page.extract || '', awardWins };
  }
  return null;
}

async function resolveKo(type, koName, expectedArtistKo) {
  if (!koName) return null;
  const q = type === 'album' ? `${koName} ${expectedArtistKo || ''} 앨범` : koName;
  const search = await apiGet(KO_API, { action: 'query', list: 'search', srsearch: q, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const data = await apiGet(KO_API, { action: 'query', titles, prop: 'description|extracts', exintro: '1', explaintext: '1', exchars: '300' });
  const pages = Object.values(data?.query?.pages ?? {});
  const guard = type === 'album' ? KO_ALBUM_GUARD : KO_ARTIST_GUARD;
  const expectedTitleNorm = norm(koName);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    const text = (page?.description ?? '') + ' ' + (page?.extract ?? '');
    if (!guard.test(text)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedTitleNorm) continue;
    return { title: page.title };
  }
  return null;
}

async function fetchSeries(project, wikiTitle) {
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/${project}/all-access/user/${article}/monthly/2015070100/2026090100`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  return (j.items ?? []).map((it) => it.views);
}

function medianOf(arr) { if (!arr || !arr.length) return null; const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }

function recencyRatio(views) {
  if (!views || views.length < 18) return null;
  const sorted = [...views].sort((a, b) => b - a);
  const p90Index = Math.max(1, Math.floor(sorted.length * 0.10));
  const referencePeak = sorted[p90Index];
  if (referencePeak <= 0) return null;
  const recent12 = views.slice(-12);
  const recentMedian = medianOf(recent12);
  return Math.min(1, recentMedian / referencePeak);
}

async function fetchCover(url, id) {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);
    img.cover({ w: 140, h: 140 });
    const outBuf = await img.getBuffer('image/jpeg', { quality: 68 });
    return `data:image/jpeg;base64,${outBuf.toString('base64')}`;
  } catch (e) { return null; }
}

async function discogsGet(url, attempt = 0) {
  await sleep(2500);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(5000 * 2 ** attempt); return discogsGet(url, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}
async function fetchDiscogs(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const search = await discogsGet(`https://api.discogs.com/database/search?q=${q}&type=release&per_page=25`);
  const results = search?.results ?? [];
  const expectedArtistNorm = norm(artist), expectedTitleNorm = norm(title);
  const matches = results.filter((r) => { const c = norm(r.title || ''); return c.includes(expectedArtistNorm) && c.includes(expectedTitleNorm); });
  if (!matches.length) return null;
  matches.sort((a, b) => ((b.community?.want || 0) + (b.community?.have || 0)) - ((a.community?.want || 0) + (a.community?.have || 0)));
  const best = matches[0];
  const release = await discogsGet(`https://api.discogs.com/releases/${best.id}`);
  const community = release?.community ?? best.community;
  if (!community) return null;
  return { want: community.want ?? null, have: community.have ?? null, ratingCount: community.rating?.count ?? null, ratingAverage: community.rating?.average ?? null };
}

async function main() {
  const items = JSON.parse(fs.readFileSync('scripts/output/holdout-extra20.json', 'utf8'));
  const out = [];
  for (const item of items) {
    console.log(`\n=== ${item.name} ===`);
    const enAlbum = await resolveEn('album', item.title, item.artist);
    const enArtist = await resolveEn('artist', item.artist, null);
    console.log('EN album:', enAlbum?.title ?? 'not resolved', '| EN artist:', enArtist?.title ?? 'not resolved');

    const albumViews = enAlbum ? await fetchSeries('en.wikipedia', enAlbum.title) : null;
    const medianViews = medianOf(albumViews);
    const timelessness = recencyRatio(albumViews);

    const koAlbum = await resolveKo('album', item.title, null);
    const koViews = koAlbum ? await fetchSeries('ko.wikipedia', koAlbum.title) : null;
    const koMedianViews = medianOf(koViews);

    const isIndividual = enArtist ? (/singer|rapper|songwriter|record producer|composer|vocalist|\bdj\b/i.test(enArtist.description) && !/\bband\b|\bduo\b|\bgroup\b|boy band|girl group/i.test(enArtist.description)) : null;
    const creativeInvolvement = enArtist ? CREATIVE_RE.test(enArtist.extract || '') : null;

    const discogs = await fetchDiscogs(item.title, item.artist);
    const cover = await fetchCover(item.coverUrl, item.id);

    console.log('medianViews:', medianViews, '| timelessness:', timelessness?.toFixed(2), '| koMedianViews:', koMedianViews, '| discogs:', discogs, '| award:', enAlbum?.awardWins ?? []);

    out.push({
      ...item,
      cover,
      medianViews,
      timelessness,
      koMedianViews,
      isIndividual,
      creativeInvolvement,
      awardWins: enAlbum?.awardWins ?? [],
      discogsWant: discogs?.want ?? null,
      discogsHave: discogs?.have ?? null,
      discogsRatingAvg: discogs?.ratingAverage ?? null,
    });
  }
  fs.writeFileSync('scripts/output/extra20-scored-raw.json', JSON.stringify(out, null, 2));
  console.log('\nWrote scripts/output/extra20-scored-raw.json');
}

main();
