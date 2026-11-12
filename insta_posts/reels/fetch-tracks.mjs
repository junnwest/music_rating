// For every album shown in a ranking reel, pick its most-played track on Last.fm and download that track's
// 30-second Apple preview (iTunes Search API, no key).
//
//   node --env-file=../apps/web/.env.local reels/fetch-tracks.mjs [tag ...]
//
// Writes reels/data/tracks.json  { <album id>: { track, listeners, itunes: {artist, track, album}, file } }
//        reels/data/previews/<album id>.m4a
// "Most played" = highest Last.fm listeners among the album's tracks (track.getInfo), so the pick is neutral.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm } from './grade.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'insta-posts/0.1 (music education carousel generator)';

async function lfm(params) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error('LASTFM_API_KEY is not set — run with --env-file=../apps/web/.env.local');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${new URLSearchParams({ ...params, api_key: key, format: 'json' })}`, { headers: { 'User-Agent': UA } });
      await sleep(220);
      return await r.json();
    } catch { await sleep(2000 * (attempt + 1)); }
  }
  return {};
}

export async function topTrack(entry) {
  const j = await lfm({ method: 'album.getinfo', artist: entry.artist, album: entry.name, autocorrect: '1' });
  let tracks = j.album?.tracks?.track || [];
  if (!Array.isArray(tracks)) tracks = [tracks];
  let best = null;
  for (const t of tracks.slice(0, 25)) {
    const ti = await lfm({ method: 'track.getinfo', artist: t.artist?.name || entry.artist, track: t.name, autocorrect: '1' });
    const listeners = Number(ti.track?.listeners || 0);
    if (!best || listeners > best.listeners) best = { track: t.name, artist: t.artist?.name || entry.artist, listeners };
  }
  return best;
}

export async function itunes(artistNames, album, track) {
  const names = artistNames.flatMap((n) => n.split(/\s*(?:&|\bX\b|\|)\s*/i)).map(norm).filter((n) => n.length > 1);
  for (const country of ['KR', 'US']) {
    for (const a of artistNames) {
      const u = `https://itunes.apple.com/search?${new URLSearchParams({ term: `${a} ${track}`, entity: 'song', limit: '25', country })}`;
      // Apple allows roughly 20 searches a minute; going faster returns errors that look like empty results
      let j = { results: [] };
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch(u).catch(() => null);
        await sleep(3200);
        if (r && r.ok) { j = await r.json().catch(() => ({ results: [] })); break; }
        await sleep(30000 * (attempt + 1));
      }
      const ok = (j.results || []).filter((r) => r.previewUrl && !/instrumental|karaoke/i.test(r.trackName + ' ' + r.collectionName) && names.some((n) => norm(r.artistName).includes(n) || n.includes(norm(r.artistName))));
      const hit = ok.find((r) => norm(r.trackName) === norm(track) && norm(r.collectionName).includes(norm(album).slice(0, 6)))
        || ok.find((r) => norm(r.trackName) === norm(track))
        // same title with a suffix ("Song (Remastered)") only when it is on the same album
        || ok.find((r) => norm(r.trackName).startsWith(norm(track)) && norm(r.collectionName).includes(norm(album).slice(0, 6)));
      if (hit) return { previewUrl: hit.previewUrl, artist: hit.artistName, track: hit.trackName, album: hit.collectionName, country };
    }
  }
  return null;
}

async function main() {
  const tags = process.argv.slice(2);
  const auto = JSON.parse(await readFile(join(DATA, 'auto.json'), 'utf8'));
  const tracksPath = join(DATA, 'tracks.json');
  const out = existsSync(tracksPath) ? JSON.parse(await readFile(tracksPath, 'utf8')) : {};
  await mkdir(join(DATA, 'previews'), { recursive: true });
  const dirs = tags.length ? tags : (await readdir(join(ROOT, 'work'))).filter((d) => existsSync(join(ROOT, 'work', d, 'graded.json')) && existsSync(join(ROOT, 'work', d, 'reel.json')) && /^(kma|kha|disco)-/.test(d));
  const ids = new Map();
  for (const d of dirs) {
    const g = JSON.parse(await readFile(join(ROOT, 'work', d, 'graded.json'), 'utf8'));
    const r = JSON.parse(await readFile(join(ROOT, 'work', d, 'reel.json'), 'utf8'));
    for (const a of g.albums.slice(0, r.top || 10)) ids.set(a.id, a);
  }
  const misses = [];
  for (const [id, a] of ids) {
    if (out[id]?.file && existsSync(join(DATA, 'previews', out[id].file))) continue;
    const entries = auto[id]?.lastfm?.entries || [];
    if (!entries.length) { misses.push(`${a.album}: no Last.fm entry`); continue; }
    let top = null;
    for (const entry of entries.slice(0, 4)) { top = await topTrack(entry); if (top) break; } // other spellings may carry the tracklist
    if (!top) { misses.push(`${a.album}: no tracklist`); continue; }
    const it = await itunes([a.artist_en, a.artist, top.artist].filter(Boolean), a.album, top.track);
    if (!it) { out[id] = { track: top.track, listeners: top.listeners, itunes: null, file: null }; misses.push(`${a.album}: no Apple preview for "${top.track}"`); continue; }
    const file = `${id}.m4a`;
    const r = await fetch(it.previewUrl);
    await writeFile(join(DATA, 'previews', file), Buffer.from(await r.arrayBuffer()));
    out[id] = { track: top.track, listeners: top.listeners, itunes: { artist: it.artist, track: it.track, album: it.album, country: it.country }, file };
    console.log(`${a.artist} — ${a.album}: "${top.track}" (${top.listeners}) → ${it.track} / ${it.album} [${it.country}]`);
    await writeFile(tracksPath, JSON.stringify(out, null, 2));
  }
  await writeFile(tracksPath, JSON.stringify(out, null, 2));
  console.log(`\n${ids.size} albums, ${misses.length} misses${misses.length ? ':\n  ' + misses.join('\n  ') : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
