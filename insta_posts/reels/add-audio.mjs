// Mix the album previews into rendered ranking reels.
//
//   node reels/add-audio.mjs <tag> [countdown|barrace]   (both when omitted)
//
// countdown: each album's top track plays while its card is on screen (cut on the card change, short fades),
//            then the #1 album's track plays over the recap.
// barrace:   the #1 album's track plays under the whole video.
// The silent render is kept as reel-<type>.silent.mp4, so this can be re-run safely.
// Timing mirrors countdownPage()/barracePage() in render-reel.mjs: change both together.
import { readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(ROOT, 'data');
const OFFSET = 6; // seconds into the 30 s preview (skip quiet intros)

function ranked(reel, graded, type) {
  if (type === 'line') return graded.albums.filter((a) => a.parts?.ratings != null && a.art).sort((a, b) => String(a.year).localeCompare(String(b.year)));
  return graded.albums.filter((a) => a.grade != null && a.art).slice(0, reel.top || 10);
}

// mirrors LINE_T in render-reel.mjs
function lineSegments(items) {
  const T = { intro: 0.6, per: 2.2, outro: 3.0 };
  const segs = items.map((a, i) => ({ id: a.id, start: T.intro + i * T.per, dur: T.per }));
  segs.push({ id: items[items.length - 1].id, start: T.intro + items.length * T.per, dur: T.outro, tail: true, offset: OFFSET + T.per });
  return { segs, duration: T.intro + items.length * T.per + T.outro };
}

function countdownSegments(items) {
  const n = items.length;
  const durs = items.map((_, k) => (n - 1 - k < 3 ? 3.0 : 2.0));
  const starts = [];
  durs.forEach((d, k) => starts.push(k ? starts[k - 1] + durs[k - 1] : 0.5));
  const endAt = starts[n - 1] + durs[n - 1];
  const segs = items.map((_, k) => ({ id: items[n - 1 - k].id, start: starts[k], dur: durs[k] }));
  segs.push({ id: items[0].id, start: endAt, dur: 3.2, tail: true, offset: OFFSET + 3.0 }); // #1 continues over the recap
  return { segs, duration: endAt + 3.2 };
}

async function mix(tag, type) {
  const dir = join(ROOT, 'out', tag);
  const video = join(dir, `reel-${type}.mp4`), silent = join(dir, `reel-${type}.silent.mp4`);
  if (!existsSync(silent)) {
    if (!existsSync(video)) { console.log(`${tag} ${type}: no video`); return; }
    await rename(video, silent);
  }
  const reel = JSON.parse(await readFile(join(ROOT, 'work', tag, 'reel.json'), 'utf8'));
  const graded = JSON.parse(await readFile(join(ROOT, 'work', tag, 'graded.json'), 'utf8'));
  const tracks = JSON.parse(await readFile(join(DATA, 'tracks.json'), 'utf8'));
  const items = ranked(reel, graded, type);
  const { segs, duration } = type === 'countdown' ? countdownSegments(items) : type === 'line' ? lineSegments(items) : { segs: [{ id: items[0].id, start: 0, dur: 13.0, long: true }], duration: 13.0 };
  const args = ['-v', 'error', '-y', '-i', silent];
  const filters = [], labels = [];
  let k = 0;
  for (const s of segs) {
    const t = tracks[s.id];
    if (!t?.file) { console.log(`  ! ${tag}: no preview for ${s.id}, silence there`); continue; }
    k++;
    args.push('-ss', String(s.offset ?? OFFSET), '-t', String(s.dur + 0.1), '-i', join(DATA, 'previews', t.file));
    const fin = s.long ? 0.4 : 0.15, fout = s.long || s.tail ? 0.8 : 0.3;
    filters.push(`[${k}:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100,afade=t=in:st=0:d=${fin},afade=t=out:st=${(s.dur - fout).toFixed(3)}:d=${fout},adelay=${Math.round(s.start * 1000)}|${Math.round(s.start * 1000)}[a${k}]`);
    labels.push(`[a${k}]`);
  }
  if (!k) { await rename(silent, video); console.log(`${tag} ${type}: no previews, left silent`); return; }
  filters.push(`${labels.join('')}amix=inputs=${k}:normalize=0,apad,atrim=0:${duration.toFixed(3)}[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', video);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${tag} ${type}`);
  console.log(`${tag} ${type}: ${k} clips mixed`);
}

const [tag, type] = process.argv.slice(2);
if (!tag) { console.error('Usage: node reels/add-audio.mjs <tag> [countdown|barrace]'); process.exit(1); }
for (const t of type ? [type] : ['countdown', 'barrace', 'line']) if (existsSync(join(ROOT, 'out', tag, `reel-${t}.mp4`)) || existsSync(join(ROOT, 'out', tag, `reel-${t}.silent.mp4`))) await mix(tag, t);
