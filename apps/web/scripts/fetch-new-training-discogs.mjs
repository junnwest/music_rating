import fs from 'fs';
const UA = 'sillajuku-new-training-discogs/1.0 (admin@sillajuku.com)';
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function discogsGet(url, attempt = 0) {
  await sleep(2500);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(5000 * 2 ** attempt); return discogsGet(url, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function fetchStats(title, artist) {
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
  const cases = JSON.parse(fs.readFileSync('scripts/output/new-training-cases.json', 'utf8'));
  const out = {};
  for (const c of cases) {
    const stats = await fetchStats(c.title, c.artist);
    out[c.id] = stats;
    console.log(c.name, '->', JSON.stringify(stats));
  }
  fs.writeFileSync('scripts/output/new-training-discogs.json', JSON.stringify(out, null, 2));
  console.log('Wrote scripts/output/new-training-discogs.json');
}

main();
