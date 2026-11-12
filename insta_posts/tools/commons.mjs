// Wikimedia Commons helper: find freely licensed photos and download them with credit info.
//
//   node tools/commons.mjs search "columbia lp 1948" [limit]
//   node tools/commons.mjs get "File:Columbia ML4001 plate.png" posts/001-x/assets/lp.png
//
// Only public domain / CC0 / CC BY / CC BY-SA are usable (marked OK). NC, ND and
// fair-use files are marked NO and `get` refuses them.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'insta-posts/0.1 (music education carousel generator)';
const strip = (h = '') => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function usable(license = '') {
  const l = license.toLowerCase();
  if (/\bnc\b|\bnd\b|non-commercial|noderiv|fair use/.test(l)) return false;
  return /public domain|^pd|cc0|^cc by(-sa)? \d|^cc-by(-sa)?-\d/.test(l);
}

// Commons rate-limits bursts with 429; back off and retry instead of failing.
async function get429(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status !== 429 || attempt === 5) return res;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function api(params) {
  const res = await get429(`${API}?${new URLSearchParams({ format: 'json', ...params })}`);
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  return res.json();
}

const INFO = { prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist', iiurlwidth: '1600' };

async function search(query, limit = 10) {
  const j = await api({ action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit), gsrsearch: `${query} filetype:bitmap`, ...INFO });
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
  if (!pages.length) return console.log('(no results)');
  for (const p of pages) {
    const i = p.imageinfo?.[0];
    if (!i) continue;
    const lic = i.extmetadata?.LicenseShortName?.value || '?';
    console.log(`${usable(lic) ? 'OK' : 'NO'} | ${p.title} | ${lic} | ${i.width}x${i.height} | ${strip(i.extmetadata?.Artist?.value).slice(0, 60)}`);
  }
}

async function get(title, dest) {
  const j = await api({ action: 'query', titles: title, ...INFO });
  const p = Object.values(j.query?.pages || {})[0];
  const i = p?.imageinfo?.[0];
  if (!i) throw new Error(`Not found: ${title}`);
  const lic = i.extmetadata?.LicenseShortName?.value || '?';
  if (!usable(lic)) throw new Error(`License not usable: ${lic}`);
  const res = await get429(i.thumburl || i.url);
  if (!res.ok) throw new Error(`Download ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  const artist = strip(i.extmetadata?.Artist?.value) || 'Unknown';
  const credit = /public domain|cc0/i.test(lic) ? 'Public domain' : `Photo: ${artist}, ${lic}`;
  console.log(JSON.stringify({ saved: dest, license: lic, artist, credit, source: i.descriptionurl }, null, 2));
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'search' && a) await search(a, Number(b) || 10);
  else if (cmd === 'get' && a && b) await get(a, b);
  else {
    console.error('Usage: node tools/commons.mjs search "<query>" [limit] | get "<File:…>" <dest>');
    process.exit(1);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
