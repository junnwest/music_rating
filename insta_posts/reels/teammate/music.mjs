// Music for the silent teammate reels: each album's most-played track on Last.fm, as Apple's 30 s preview.
//   node --env-file=../../../apps/web/.env.local music.mjs
// Writes music/<name>.m4a and music.json { name: {track, listeners, itunes} }. Videos that already have audio are skipped.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { topTrack, itunes } from '../fetch-tracks.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HAS_AUDIO = ['08-', '10-', '11-', '12-', '13-'];
// English artist names (Last.fm / Apple search); album overrides where Last.fm uses a different title
const EN = {
  wavetoearth: 'wave to earth', baekyerin: 'Yerin Baek', kidmillibeige: 'Kid Milli', silicagel: 'Silica Gel', 'frankocean-blonde': 'Frank Ocean',
  'lanadelrey-nfr': 'Lana Del Rey', cigarettesaftersex: 'Cigarettes After Sex', 'charlixcx-brat': 'Charli xcx', 'frankocean-channelorange': 'Frank Ocean',
  'macmiller-kids': 'Mac Miller', 'playboicarti-wlr': 'Playboi Carti', 'stevelacy-apolloxxi': 'Steve Lacy', 'daftpunk-discovery': 'Daft Punk',
  'yujaeha-love': '유재하', 'jazzyfact-lifeslike': 'Jazzyfact', '250-ppong': '250', 'unnine-ordinary': "Sister's Barbershop", 'cjamm-kung': 'C JAMM',
  'beenzino-nowitzki': 'Beenzino', 'blackskirts-201': 'The Black Skirts', 'esens-anecdote': 'E SENS', 'leemoonsae-4': '이문세',
  'beatles-abbeyroad': 'The Beatles', 'michaeljackson-thriller': 'Michael Jackson', 'radiohead-okcomputer': 'Radiohead', 'nirvana-nevermind': 'Nirvana',
  'milesdavis-kindofblue': 'Miles Davis', kanyewest: 'Kanye West', 'outkast-stankonia': 'OutKast', kendricklamar: 'Kendrick Lamar', 'tiffanyday-halo': 'Tiffany Day',
};
const ALBUM = { '38-rating-spread-250-ppong': 'PPONG', '45-rating-spread-leemoonsae-4': '이문세 4', '39-rating-spread-unnine-ordinary': '가장 보통의 존재' };

const meta = JSON.parse(await readFile(join(HERE, 'meta.json'), 'utf8'));
const outPath = join(HERE, 'music.json');
const out = existsSync(outPath) ? JSON.parse(await readFile(outPath, 'utf8')) : {};
await mkdir(join(HERE, 'music'), { recursive: true });
const misses = [];
for (const [name, m] of Object.entries(meta)) {
  if (HAS_AUDIO.some((p) => name.startsWith(p))) continue;
  if (out[name]?.file && existsSync(join(HERE, 'music', out[name].file))) continue;
  const key = Object.keys(EN).find((k) => name.includes(k));
  const artist = EN[key];
  const album = ALBUM[name] || m.album;
  const top = await topTrack({ artist, name: album });
  if (!top) { misses.push(`${name}: no Last.fm tracklist for ${artist} — ${album}`); continue; }
  const it = await itunes([artist, m.artist], album, top.track);
  if (!it) { misses.push(`${name}: no Apple preview for "${top.track}"`); out[name] = { track: top.track, listeners: top.listeners, itunes: null, file: null }; continue; }
  const file = `${name}.m4a`;
  await writeFile(join(HERE, 'music', file), Buffer.from(await (await fetch(it.previewUrl)).arrayBuffer()));
  out[name] = { track: top.track, listeners: top.listeners, itunes: { artist: it.artist, track: it.track, album: it.album }, file };
  console.log(`${name}: "${top.track}" → ${it.track} / ${it.album}`);
  await writeFile(outPath, JSON.stringify(out, null, 2));
}
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log(`${misses.length} misses${misses.length ? ':\n  ' + misses.join('\n  ') : ''}`);
