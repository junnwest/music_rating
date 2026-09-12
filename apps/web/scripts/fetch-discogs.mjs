// Real "do serious music fans engage with this" signal via Discogs — a
// collector/crate-digger platform, not mainstream listeners, so it's a
// different axis from Wikipedia traffic (broad awareness) or Sillajuku
// ratings (this app's own early userbase). Verified live: Lauryn Hill's
// Miseducation main release shows want=11146, have=9437, rating.count=894,
// rating.average=4.65 — a real, rich community-engagement signal.
//
// Album-only (Discogs releases are physical records, not artist pages).
// Two calls per item: search (verify match, get master_id) -> fetch the
// master's main_release for full community stats. Unauthenticated Discogs
// rate limit is 25 req/min, so ~2.5s between calls.
import fs from 'fs';

const UA = 'sillajuku-discogs-fetch/1.0 (admin@sillajuku.com)';
const POOL_PATH = 'scripts/output/suitability-pool.json';
const HOLDOUT_PATH = 'scripts/output/holdout-albums.json';
const OUT_PATH = 'scripts/output/discogs.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function discogsGet(url, attempt = 0) {
  await sleep(2500);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(5000 * 2 ** attempt); return discogsGet(url, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function resolveDiscogs(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const search = await discogsGet(`https://api.discogs.com/database/search?q=${q}&type=release&per_page=25`);
  const results = search?.results ?? [];
  const expectedArtistNorm = norm(artist);
  const expectedTitleNorm = norm(title);
  const matches = results.filter((r) => {
    const combinedNorm = norm(r.title || '');
    return combinedNorm.includes(expectedArtistNorm) && combinedNorm.includes(expectedTitleNorm);
  });
  if (!matches.length) return null;
  // Real bug found and fixed: following master_id -> main_release picked an
  // essentially arbitrary pressing (verified live on Playboi Carti's Whole
  // Lotta Red — main_release had want=341, but the actual most-collected
  // pressing of the same album had want=3915, have=12358, over 10x higher).
  // Community want/have is already present on every search result, so pick
  // whichever matching pressing has the highest engagement directly —
  // no master-release indirection needed.
  matches.sort((a, b) => ((b.community?.want || 0) + (b.community?.have || 0)) - ((a.community?.want || 0) + (a.community?.have || 0)));
  return matches[0];
}

async function fetchCommunityStats(result) {
  const release = await discogsGet(`https://api.discogs.com/releases/${result.id}`);
  const community = release?.community ?? result.community;
  if (!community) return null;
  return {
    want: community.want ?? null,
    have: community.have ?? null,
    ratingCount: community.rating?.count ?? null,
    ratingAverage: community.rating?.average ?? null,
  };
}

async function main() {
  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8')).filter((x) => x.type === 'album');
  const holdout = JSON.parse(fs.readFileSync(HOLDOUT_PATH, 'utf8')).map((h) => ({ ...h, id: 'holdout-' + h.id }));
  const targets = [...pool, ...holdout];
  console.log(`Resolving Discogs data for ${targets.length} albums...`);

  const out = [];
  let done = 0, resolved = 0;
  for (const item of targets) {
    const match = await resolveDiscogs(item.title, item.artist);
    let stats = null;
    if (match) stats = await fetchCommunityStats(match);
    if (stats) resolved++;
    out.push({ id: item.id, title: item.title, artist: item.artist, discogsTitle: match?.title ?? null, ...stats });
    done++;
    if (done % 10 === 0) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r${done}/${targets.length} (${resolved} resolved)`);
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nDone. ${resolved}/${out.length} resolved with real Discogs community stats.`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
