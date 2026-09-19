// Downloads cover art + fetches Wikipedia recognizability/identity features
// for the 30 holdout albums, then scores each with the trained binary
// suitability model (exclude vs. keep) for a visual holdout check.
import fs from 'fs';
import { Jimp } from 'jimp';

const UA = 'sillajuku-suitability-holdout/1.0 (admin@sillajuku.com)';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const IN_PATH = 'scripts/output/holdout-albums.json';
const OUT_PATH = 'scripts/output/holdout-scored.json';
const COVER_DIR = 'scripts/output/holdout-covers';
const MODEL_PATH = 'scripts/output/binary-model.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ALBUM_GUARD = /\balbum\b|\bep\b|mixtape|record by|studio album|extended play/i;
const INDIVIDUAL_RE = /singer|rapper|songwriter|record producer|composer|vocalist|\bdj\b/i;
const GROUP_RE = /\bband\b|\bduo\b|\bgroup\b|boy band|girl group/i;

async function wikiGet(params, attempt = 0) {
  await sleep(280);
  const url = new URL(WIKI_API);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return wikiGet(params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function resolveAlbum(artist, title) {
  const q = `${title} ${artist} album`;
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: q, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const desc = await wikiGet({ action: 'query', titles, prop: 'description' });
  const pages = Object.values(desc?.query?.pages ?? {});
  const expectedArtistNorm = norm(artist);
  const expectedTitleNorm = norm(title);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    if (!page?.description || !ALBUM_GUARD.test(page.description)) continue;
    if (!norm(page.description).includes(expectedArtistNorm)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedTitleNorm) continue;
    return { title: page.title, description: page.description };
  }
  return null;
}

async function resolveArtistDesc(artistName) {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: artistName, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const desc = await wikiGet({ action: 'query', titles, prop: 'description' });
  const pages = Object.values(desc?.query?.pages ?? {});
  const guard = /singer|rapper|musician|band|idol|songwriter|record producer|composer|vocalist|group|duo|dj\b/i;
  const expectedNorm = norm(artistName);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    if (!page?.description || !guard.test(page.description)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedNorm) continue;
    return page.description;
  }
  return null;
}

async function fetchMedianViews(wikiTitle) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, 1));
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
  const excludeYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/en.wikipedia/all-access/user/${article}/monthly/${fmt(start)}/${fmt(now)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  const items = (j.items ?? []).filter((it) => it.timestamp.slice(0, 6) !== excludeYm);
  if (!items.length) return null;
  const views = items.map((it) => it.views).sort((a, b) => a - b);
  return views[Math.floor(views.length / 2)];
}

async function fetchCover(item) {
  fs.mkdirSync(COVER_DIR, { recursive: true });
  const localPath = `${COVER_DIR}/${item.id}.jpg`;
  if (!item.coverUrl) return null;
  try {
    const res = await fetch(item.coverUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);
    img.cover({ w: 140, h: 140 });
    const outBuf = await img.getBuffer('image/jpeg', { quality: 68 });
    fs.writeFileSync(localPath, outBuf);
    return `data:image/jpeg;base64,${outBuf.toString('base64')}`;
  } catch (e) { return null; }
}

function hasGenre(genres, needle) { return (genres || []).some((g) => g.toLowerCase().includes(needle)); }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

async function main() {
  const items = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));

  const results = [];
  for (const item of items) {
    const albumResolved = await resolveAlbum(item.artist, item.title);
    let medianViews = albumResolved ? await fetchMedianViews(albumResolved.title) : null;
    let isIndividual = null;
    const artistDesc = await resolveArtistDesc(item.artist);
    if (artistDesc) {
      if (INDIVIDUAL_RE.test(artistDesc) && !GROUP_RE.test(artistDesc)) isIndividual = true;
      else if (GROUP_RE.test(artistDesc)) isIndividual = false;
    }
    const cover = await fetchCover(item);

    const feat = {
      type_artist: 0,
      is_korea: 0, // country unknown for these (not looked up) — treated as unknown
      is_unknown_country: 1,
      log_rating: Math.log((item.ratingCount || 0) + 1),
      log_views: medianViews != null ? Math.log(medianViews + 1) : 0,
      has_views: medianViews != null ? 1 : 0,
      is_individual: isIndividual === true ? 1 : isIndividual === false ? -1 : 0,
      hip_hop: hasGenre(item.genres, 'hip hop') ? 1 : 0,
      k_pop: hasGenre(item.genres, 'k-pop') ? 1 : 0,
      rock: hasGenre(item.genres, 'rock') ? 1 : 0,
      r_b: hasGenre(item.genres, 'r&b') ? 1 : 0,
      pop: hasGenre(item.genres, 'pop') && !hasGenre(item.genres, 'k-pop') ? 1 : 0,
      jazz: hasGenre(item.genres, 'jazz') ? 1 : 0,
    };
    const std = model.standardizeStats;
    feat.log_rating = (feat.log_rating - std.log_rating.mean) / std.log_rating.sd;
    feat.log_views = (feat.log_views - std.log_views.mean) / std.log_views.sd;

    const x = [1, ...model.FEATURES.map((f) => feat[f])];
    const p = sigmoid(model.w.reduce((s, wj, j) => s + wj * x[j], 0));

    results.push({
      ...item,
      cover,
      wikiAlbumTitle: albumResolved?.title ?? null,
      medianViews,
      isIndividual,
      keepProbability: p,
      prediction: p >= 0.5 ? 'keep' : 'exclude',
    });
    console.log(`${item.name} -> p(keep)=${p.toFixed(2)} -> ${p >= 0.5 ? 'KEEP' : 'EXCLUDE'}`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
}

main();
