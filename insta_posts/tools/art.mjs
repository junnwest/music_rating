// Album cover art from the Cover Art Archive (MusicBrainz), at up to 1200px. No key needed.
//
//   node tools/art.mjs search "kind of blue" "miles davis"
//   node tools/art.mjs get <release-group MBID> work/005-kind-of-blue/assets/art-kind-of-blue.jpg
//
// Album covers are copyrighted by the label/artist. They are used only to identify the record
// being discussed; put the label in the slide's `credit` (e.g. "Album cover: Columbia, 1959"),
// which render.mjs lists separately from the Commons photo credits.
//
// One MusicBrainz request per search (their limit is 1 req/s) — fine beside the catalog pipeline.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const UA = 'insta-posts/0.1 (music education carousel generator)';

async function search(title, artist) {
  const q = `releasegroup:"${title}"` + (artist ? ` AND artist:"${artist}"` : '');
  const url = `https://musicbrainz.org/ws/2/release-group?${new URLSearchParams({ query: q, fmt: 'json', limit: '8' })}`;
  // MusicBrainz answers 503 when the shared 1 req/s budget is busy (e.g. the catalog pipeline); back off and retry.
  let res;
  for (let i = 0; i < 5; i++) {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  const { 'release-groups': rgs = [] } = await res.json();
  for (const g of rgs) {
    const who = (g['artist-credit'] || []).map((c) => c.name + (c.joinphrase || '')).join('');
    console.log(`${g.id}  ${who} — ${g.title} (${(g['first-release-date'] || '').slice(0, 4)}) [${g['primary-type'] || '?'}] score ${g.score}`);
  }
  if (!rgs.length) console.log('no results');
}

async function get(mbid, out) {
  const img = await fetch(`https://coverartarchive.org/release-group/${mbid}/front-1200`, { headers: { 'User-Agent': UA } });
  if (!img.ok) throw new Error(`Cover Art Archive ${img.status} (no front cover for ${mbid}?)`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(await img.arrayBuffer()));
  console.log(`saved ${out} — read it to confirm it is the right cover/edition`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'search' && a) await search(a, b);
else if (cmd === 'get' && a && b) await get(a, b);
else console.log('usage: node tools/art.mjs search "<album>" ["<artist>"] | get <release-group MBID> <out.jpg>');
