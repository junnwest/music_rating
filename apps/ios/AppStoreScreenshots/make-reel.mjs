#!/usr/bin/env node
/**
 * Turn the rendered reel cards into an Instagram reel (1080 x 1920, H.264).
 *
 *   node export.mjs --lang=reel --no-showcase   # cards first
 *   node make-reel.mjs                          # -> reel/out/reel.mp4
 *
 * Options: --hold=2.6 (seconds a card is on screen) --fade=0.45 (transition) --fps=30
 *          --transition=slideleft (any ffmpeg xfade name)
 *          --dir=reel/out  --out=reel/out/reel.mp4
 *
 * WHY THE CARDS ARE RENDERED AT 2x FIRST. The push-in is a zoompan, and zoompan steps its zoom in
 * whole source pixels: applied straight to a 1080-wide card it visibly judders, because each step
 * lands on a different pixel grid. Scaling to 2160 first gives it a half-pixel grid to walk, which
 * at this zoom rate reads as smooth. It costs memory, not quality.
 *
 * WHY NOT ANIMATE IN THE BROWSER. The renderer paints one static frame per slide, so real in-page
 * motion would mean rendering every frame through headless Chrome - about 400 screenshots for a
 * 13-second reel, minutes per run, for motion the viewer reads as a slow push and a dissolve anyway.
 * The move that would actually justify it is animating the phone independently of the copy, which
 * needs the layers rendered separately; see the README note before reaching for it.
 *
 * NO AUDIO TRACK. Reels are published with sound chosen in the Instagram app, and shipping a silent
 * track here would only get replaced. The file is video-only on purpose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d;

const HOLD = Number(opt('hold', 2.6));   // seconds a card is fully on screen
const FADE = Number(opt('fade', 0.45));  // transition between cards
/* A dissolve is wrong for these cards. Both headlines stay legible through the middle of a fade, so
   two sets of heavy Korean type overlap into mush - the first build of this reel did exactly that.
   A slide replaces one card with the next without ever showing both in the same place, and it reads
   as the swipe the carousel already implies: the panorama flower is laid out across slide seams, so
   sliding horizontally carries it from one card to the next the way swiping the posts does. */
const TRANSITION = opt('transition', 'slideleft');
const FPS = Number(opt('fps', 30));
const DIR = path.resolve(ROOT, opt('dir', 'reel/out'));
const OUT = path.resolve(ROOT, opt('out', 'reel/out/reel.mp4'));

const cards = fs.readdirSync(DIR).filter((f) => /^\d+\.png$/.test(f)).sort();
if (cards.length < 2) {
  console.error(`Need at least 2 cards in ${DIR}. Run: node export.mjs --lang=reel --no-showcase`);
  process.exit(1);
}

// Each card is held for HOLD and overlaps the next by FADE, so the pair costs (HOLD - FADE) of
// timeline. The last card keeps its full hold, which is what leaves the end card readable.
const STEP = HOLD - FADE;
const TOTAL = STEP * (cards.length - 1) + HOLD;
if (STEP <= 0) { console.error('--fade must be shorter than --hold'); process.exit(1); }

// -framerate must be set on the INPUT: it decides how many frames the looped still produces, and
// zoompan below consumes them one for one. Left at ffmpeg's 25fps default the clip would run long.
const inputs = cards.flatMap((f) => ['-framerate', String(FPS), '-loop', '1', '-t', String(HOLD), '-i', path.join(DIR, f)]);

/* Alternating push-in and pull-back. A reel where every card zooms the same way reads as a slideshow
   with an effect applied; alternating the direction makes each cut feel like a change of shot. The
   range is deliberately small (8%) - this is a product card, and anything more starts cropping the
   headline the safe area was arranged around. */
/* zoompan's `d` is frames emitted PER INPUT FRAME, not per clip. With a looped still already supplying
   HOLD * FPS frames, a d of HOLD * FPS multiplies the two and the reel comes out HOLD times too long -
   13s of cards became a 180s file the first time this ran. d=1 is the correct pairing with a looped
   input: one frame in, one frame out, with `on` (the output frame counter) driving the zoom. */
const pan = (i) => {
  const inZoom = i % 2 === 0;
  const z = inZoom
    ? `min(1.001+0.0009*on,1.08)`
    : `max(1.08-0.0009*on,1.001)`;
  return `[${i}:v]scale=2160:3840,setsar=1,`
    + `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920,`
    + `format=yuv420p[v${i}]`;
};

const chain = [];
let prev = 'v0';
for (let i = 1; i < cards.length; i++) {
  const label = i === cards.length - 1 ? 'vout' : `x${i}`;
  // xfade's offset is measured on the OUTPUT timeline, so it accumulates by STEP, not by HOLD.
  chain.push(`[${prev}][v${i}]xfade=transition=${TRANSITION}:duration=${FADE}:offset=${(STEP * i).toFixed(3)}[${label}]`);
  prev = label;
}

const filter = [...cards.map((_, i) => pan(i)), ...chain].join(';');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const ff = [
  '-y', ...inputs,
  '-filter_complex', filter,
  '-map', '[vout]',
  '-r', String(FPS),
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-crf', '18', '-preset', 'slow',
  '-movflags', '+faststart',
  OUT,
];

console.log(`${cards.length} cards · hold ${HOLD}s · ${TRANSITION} ${FADE}s · ${FPS}fps → ~${TOTAL.toFixed(1)}s`);
const r = spawnSync('ffmpeg', ff, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr?.split('\n').slice(-18).join('\n') || r.error);
  process.exit(1);
}
const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log(`  ✓ ${path.relative(process.cwd(), OUT)}  ${mb} MB`);
