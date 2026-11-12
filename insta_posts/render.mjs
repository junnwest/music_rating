// Render a post into its upload folder.
//
//   node render.mjs 001-lp-ep-single
//
// Reads  work/<slug>/post.json (+ assets/)
// Writes posts/<slug>/01.png … NN.png  (1080x1350)
//        posts/<slug>/caption.txt      (main caption + one text per slide)
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import config from './config.mjs';

const ROOT = new URL('.', import.meta.url);
const W = 1080, H = 1350;
const FONTS = `
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@500;600;700&display=block" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">`;

const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const br = (s = '') => esc(s).replace(/\n/g, '<br>');

async function loadTheme(name) {
  const files = (await readdir(new URL('./themes/', ROOT))).filter((f) => f.endsWith('.mjs'));
  for (const f of files) {
    const t = (await import(`./themes/${f}`)).default;
    if (t.name === name) return t;
  }
  throw new Error(`No theme named "${name}"`);
}

async function buildHtml(theme, post, workDir) {
  const wordmark = (await readFile(new URL('./brand/wordmark.svg', ROOT), 'utf8')).replace(/<\?xml[^>]*\?>\s*/, '');
  const ctx = {
    n: post.slides.length,
    esc,
    br,
    wordmark,
    flower: new URL('./brand/flower.png', ROOT).href,
    flowerPng: new URL('./brand/flower.png', ROOT).href,
    appStoreBadge: new URL('./brand/appstore-badge-kr.svg', ROOT).href,
    rocketSvg: await readFile(new URL('./brand/icon-rocket-filled.svg', ROOT), 'utf8'),
    flowerSvg: (await readFile(new URL('./brand/icon-flower.svg', ROOT), 'utf8')).replace(/<\?xml[^>]*\?>\s*/, ''),
    closingBg: process.env.CLOSING_BG || config.closingBg,
    withText: !!post.captionInImage,
    cover: post.slides.find((x) => x.type === 'cover'),
    img: (p) => pathToFileURL(resolve(workDir, p)).href,
  };
  const slides = post.slides.map((s, i) => theme.slide(s, { ...ctx, i: i + 1 })).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONTS}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#777}
.slide{width:${W}px;height:${H}px;position:relative;overflow:hidden}
img{display:block}
${theme.css}
</style></head><body>${slides}</body></html>`;
}

// Runs in the page. Shrinks [data-fit=N] headlines until they fit in N lines,
// then reports text that spills off the slide or into the wordmark.
function fitAndCheck() {
  const out = [];
  document.querySelectorAll('[data-fit]').forEach((el) => {
    const max = Number(el.dataset.fit);
    let size = parseFloat(getComputedStyle(el).fontSize);
    const lines = () => el.offsetHeight / parseFloat(getComputedStyle(el).lineHeight);
    while (lines() > max + 0.2 && size > 40) el.style.fontSize = `${(size -= 4)}px`;
  });
  document.querySelectorAll('.slide').forEach((slide, i) => {
    const n = String(i + 1).padStart(2, '0');
    const sr = slide.getBoundingClientRect();
    const wm = slide.querySelector('.wm')?.getBoundingClientRect();
    slide.querySelectorAll('h1, .trk').forEach((el) => {
      const r = el.getBoundingClientRect();
      const label = el.tagName.toLowerCase() === 'h1' ? 'title' : 'table';
      if (r.right > sr.right - 40 || r.left < sr.left || r.top < sr.top + 40 || el.scrollWidth > el.clientWidth + 1)
        out.push(`${n}: ${label} overflows the slide edge`);
      if (wm && r.bottom > wm.top - 20) out.push(`${n}: ${label} runs into the wordmark`);
    });
    const body = slide.querySelector('.body');
    if (body) {
      const lines = Math.round(body.offsetHeight / parseFloat(getComputedStyle(body).lineHeight));
      if (lines > 4) out.push(`${n}: body text is ${lines} lines (max 4) — shorten it`);
    }
    const h1 = slide.querySelector('h1[data-fit]');
    if (h1?.style.fontSize) out.push(`${n}: title auto-shrunk to ${h1.style.fontSize} (consider a shorter title)`);
  });
  return out;
}

function buildCaption(post) {
  const all = [...new Set(post.slides.flatMap((s) => [s.credit, s.artCredit, ...(s.items || []).map((i) => i.credit)]).filter(Boolean))];
  // Album covers are credited to their label on their own line; everything else came from Commons.
  const art = all.filter((c) => /^Album cover/i.test(c));
  const credits = all.filter((c) => !/^Album cover/i.test(c)).map((c) => c.replace(/^Photo:\s*/, ''));
  const main = [
    post.caption.trim(),
    post.hashtags?.trim(),
    credits.length ? `Photos: ${credits.join(' · ')} (via Wikimedia Commons)` : '',
    art.join(' · '),
  ]
    .filter(Boolean)
    .join('\n\n');
  const perSlide = post.slides
    .map((s, i) => `[${String(i + 1).padStart(2, '0')}] ${(s.title || '').replace(/\n/g, ' ')}\n${(s.text || '').trim()}`)
    .join('\n\n');
  if (post.captionInImage) return `[본문]\n${main}\n`; // slide texts are already on the images
  return `[본문]\n${main}\n\n==============================\n[장별 본문]\n\n${perSlide}\n`;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node render.mjs <slug>   e.g. node render.mjs 001-lp-ep-single');
    process.exit(1);
  }
  const slug = basename(arg);
  const workDir = join(fileURLToPath(new URL('./work/', ROOT)), slug);
  const outDir = join(fileURLToPath(new URL('./posts/', ROOT)), slug);
  const post = JSON.parse(await readFile(join(workDir, 'post.json'), 'utf8'));
  const theme = await loadTheme(config.theme);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const htmlPath = join(workDir, '.slides.html');
  await writeFile(htmlPath, await buildHtml(theme, post, workDir));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  for (const w of await page.evaluate(fitAndCheck)) console.warn(`  ! slide ${w}`);
  const els = await page.$$('.slide');
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: join(outDir, `${String(i + 1).padStart(2, '0')}.png`) });
  }
  await browser.close();
  await rm(htmlPath);

  await writeFile(join(outDir, 'caption.txt'), buildCaption(post));
  console.log(`${els.length} slides + caption.txt -> ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
