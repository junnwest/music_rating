// "Real musician vs. known for image/exposure" signal — verified live: short
// Wikipedia descriptions are too terse to catch this (G-Dragon's is just
// "South Korean rapper"), but the full opening extract reliably does
// ("...rapper, singer, songwriter, and entrepreneur" for G-Dragon vs.
// "South Korean girl group" with no creative-credit language at all for
// Fromis_9). Resolves every unique artist name across the pool + holdout,
// fetches a real extract, and flags songwriter/composer/producer credit.
import fs from 'fs';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'sillajuku-creative-involvement/1.0 (admin@sillajuku.com)';
const OUT_PATH = 'scripts/output/creative-involvement.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const ARTIST_GUARD = /singer|rapper|musician|band|idol|songwriter|record producer|composer|vocalist|group|duo|dj\b/i;
const CREATIVE_RE = /songwriter|song-writer|composer|record producer|\bproducer\b|music producer/i;

async function wikiGet(params, attempt = 0) {
  await sleep(280);
  const url = new URL(WIKI_API);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return wikiGet(params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function resolveAndCheck(name) {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: name, srlimit: '5' });
  const hits = search?.query?.search ?? [];
  if (!hits.length) return null;
  const titles = hits.map((h) => h.title).join('|');
  const data = await wikiGet({ action: 'query', titles, prop: 'description|extracts', exintro: '1', explaintext: '1', exchars: '400' });
  const pages = Object.values(data?.query?.pages ?? {});
  const expectedNorm = norm(name);
  for (const hit of hits) {
    const page = pages.find((p) => p.title === hit.title);
    if (!page?.description || !ARTIST_GUARD.test(page.description)) continue;
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, ''));
    if (coreTitleNorm !== expectedNorm) continue;
    return { title: page.title, creativeInvolvement: CREATIVE_RE.test(page.extract || '') };
  }
  return null;
}

async function main() {
  const pool = JSON.parse(fs.readFileSync('scripts/output/suitability-pool.json', 'utf8'));
  const holdout = JSON.parse(fs.readFileSync('scripts/output/holdout-albums.json', 'utf8'));
  const names = new Set();
  for (const p of pool) names.add(p.type === 'artist' ? p.name : p.artist);
  for (const h of holdout) names.add(h.artist);

  let out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};
  const todo = [...names].filter((n) => !(n in out));
  console.log(`Resolving creative-involvement for ${todo.length} unique artists (${names.size} total, ${names.size - todo.length} already done)...`);

  let done = 0;
  for (const name of todo) {
    const result = await resolveAndCheck(name);
    out[name] = result ? { wikiTitle: result.title, creativeInvolvement: result.creativeInvolvement } : null;
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r${done}/${todo.length}`);
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  const resolved = Object.values(out).filter((v) => v);
  console.log(`\nDone. ${resolved.length}/${names.size} resolved, ${resolved.filter((v) => v.creativeInvolvement).length} with real creative-involvement credit.`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
