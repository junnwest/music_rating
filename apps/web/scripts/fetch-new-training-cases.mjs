// Fetches real data for the new confirmed-suitable albums the user named,
// to add as genuine new training rows (not just validation cases). Discogs
// is fetched separately afterward (avoiding overlap with the concurrent
// Discogs re-fetch job for the existing pool).
import fs from 'fs';

const UA = 'sillajuku-new-training/1.0 (admin@sillajuku.com)';
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

async function fetchViews(project, wikiTitle, months = 24) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
  const excludeYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/${project}/all-access/user/${article}/monthly/${fmt(start)}/${fmt(now)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  const items = (j.items ?? []).filter((it) => it.timestamp.slice(0, 6) !== excludeYm);
  return items.map((it) => it.views);
}

function timelessnessScore(views) {
  if (!views || views.length < 6) return null;
  const sorted = [...views].sort((a, b) => b - a);
  const p90Index = Math.max(1, Math.floor(sorted.length * 0.10));
  const referencePeak = sorted[p90Index];
  if (referencePeak <= 0) return null;
  const threshold = referencePeak * 0.25;
  return views.filter((v) => v >= threshold).length / views.length;
}

const NEW_CASES = [
  { title: 'Circles', artist: 'Mac Miller', koArtist: null, genres: ['hip hop', 'pop rap'], country: null },
  { title: 'Brat', artist: 'Charli XCX', koArtist: null, genres: ['pop', 'hyperpop', 'dance-pop'], country: null },
  { title: 'The College Dropout', artist: 'Kanye West', koArtist: '카니예 웨스트', genres: ['hip hop'], country: null },
  { title: 'Late Registration', artist: 'Kanye West', koArtist: '카니예 웨스트', genres: ['hip hop'], country: null },
  { title: 'Graduation', artist: 'Kanye West', koArtist: '카니예 웨스트', genres: ['hip hop'], country: null },
  { title: '201', artist: 'The Black Skirts', koArtist: '더 블랙 스커츠', genres: ['indie pop', 'k-indie'], country: 'KR' },
  { title: 'channel ORANGE', artist: 'Frank Ocean', koArtist: null, genres: ['r&b', 'hip hop'], country: null },
];

async function main() {
  const out = [];
  for (const c of NEW_CASES) {
    console.log(`\n=== ${c.title} — ${c.artist} ===`);
    const enAlbum = await resolveEn('album', c.title, c.artist);
    console.log('EN album:', enAlbum?.title ?? 'not resolved');
    const enArtist = await resolveEn('artist', c.artist, null);
    console.log('EN artist:', enArtist?.title ?? 'not resolved');
    const albumViews = enAlbum ? await fetchViews('en.wikipedia', enAlbum.title) : null;
    const albumMedian = albumViews ? [...albumViews].sort((a,b)=>a-b)[Math.floor(albumViews.length/2)] : null;
    const timelessness = timelessnessScore(albumViews);

    const koAlbum = c.koArtist ? await resolveKo('album', c.title, c.koArtist) : null;
    const koViews = koAlbum ? await fetchViews('ko.wikipedia', koAlbum.title) : null;
    const koMedian = koViews ? [...koViews].sort((a,b)=>a-b)[Math.floor(koViews.length/2)] : null;
    console.log('KO album:', koAlbum?.title ?? 'not resolved (or not attempted)', '| median:', koMedian);

    const isIndividual = enArtist ? (/singer|rapper|songwriter|record producer|composer|vocalist|\bdj\b/i.test(enArtist.description) && !/\bband\b|\bduo\b|\bgroup\b|boy band|girl group/i.test(enArtist.description)) : null;
    const creativeInvolvement = enArtist ? CREATIVE_RE.test(enArtist.extract || '') : null;

    out.push({
      id: 'newtrain-' + out.length,
      type: 'album',
      name: `${c.title} — ${c.artist}`,
      title: c.title,
      artist: c.artist,
      genres: c.genres,
      country: c.country,
      decision: 'suitable',
      medianViews: albumMedian,
      wikiTitle: enAlbum?.title ?? null,
      awardWins: enAlbum?.awardWins ?? [],
      timelessness,
      koMedianViews: koMedian,
      isIndividual,
      creativeInvolvement,
    });
  }
  fs.writeFileSync('scripts/output/new-training-cases.json', JSON.stringify(out, null, 2));
  console.log('\nWrote scripts/output/new-training-cases.json');
}

main();
