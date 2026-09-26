#!/usr/bin/env node
/**
 * Pixel-exact export of the App Store screenshot set. No npm dependencies:
 * serves this folder on localhost and drives your installed Chrome/Edge headless.
 *
 *   node export.mjs                 → out/01-home.png … + out/showcase.png
 *   node export.mjs --only=1,3      → just slides 1 and 3
 *   node export.mjs --no-showcase   → skip the portfolio board
 *   node export.mjs --lang=ko       → the Korean set: reads ko/slides.config.js, writes ko/out/
 *   node export.mjs --serve         → local server for editing (real screenshots in
 *                                     screens/ load reliably; in-page PNG export works)
 *
 * Browser: set CHROME_PATH to override auto-detection.
 * Brand assets (icons, wordmark, flower logo, app icon) are re-synced from the
 * iOS asset catalog on every run; see sync-assets.mjs.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncAssets } from './sync-assets.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;

// Read the slide config the same way the page does.
const ctx = { window: {} };
const LANG = opt('lang', '');
const LANG_DIR = LANG ? path.join(ROOT, LANG) : ROOT;
if (LANG && !fs.existsSync(path.join(LANG_DIR, 'slides.config.js'))) { console.error(`No ${LANG}/slides.config.js`); process.exit(1); }
vm.runInNewContext(fs.readFileSync(path.join(LANG_DIR, 'slides.config.js'), 'utf8'), ctx);
const cfg = ctx.window.APPSHOTS;
syncAssets();
const { width: W, height: H } = cfg.canvas;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
});
await new Promise((ok) => server.listen(Number(opt('port', 0)), '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const lq = LANG ? `lang=${LANG}&` : '';

if (has('serve')) {
  console.log(`Serving the template → ${base}${LANG ? `?lang=${LANG}` : ''}\n(Ctrl+C to stop)`);
} else {
  try { await exportAll(); } finally { server.close(); }
}

function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) { console.error('No Chrome/Edge found. Set CHROME_PATH to your browser binary.'); process.exit(1); }
  return hit;
}

function shoot(chrome, url, w, h, out) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'appshots-'));
    const p = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--force-device-scale-factor=1', `--window-size=${w},${h}`,
      '--virtual-time-budget=15000', '--run-all-compositor-stages-before-draw', `--screenshot=${out}`, url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may still hold a lock */ }
      if (fs.existsSync(out)) resolve(); else reject(new Error(`Browser exited ${code}\n${err.slice(-600)}`));
    });
  });
}

function pngSize(f) { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }

async function exportAll() {
  const chrome = findChrome();
  const outDir = path.resolve(LANG_DIR, opt('out', 'out'));
  fs.mkdirSync(outDir, { recursive: true });
  const only = opt('only') ? opt('only').split(',').map(Number) : cfg.slides.map((_, i) => i + 1);
  const jobs = only.map((n) => ({
    url: `${base}?${lq}slide=${n}`, w: W, h: H,
    out: path.join(outDir, `${String(n).padStart(2, '0')}-${cfg.slides[n - 1].id}.png`),
  }));
  if (!has('no-showcase')) jobs.push({ url: `${base}?${lq}showcase&raw`, w: 4800, h: 2700, out: path.join(outDir, 'showcase.png') });

  console.log(`Exporting ${jobs.length} image(s) with ${path.basename(chrome)} → ${path.relative(process.cwd(), outDir) || '.'}`);
  for (const j of jobs) {
    if (fs.existsSync(j.out)) fs.rmSync(j.out);
    await shoot(chrome, j.url, j.w, j.h, j.out);
    const [w, h] = pngSize(j.out);
    const ok = w === j.w && h === j.h;
    console.log(`  ${ok ? '✓' : '✗'} ${path.basename(j.out)}  ${w}×${h}${ok ? '' : `  (expected ${j.w}×${j.h})`}`);
    if (!ok) process.exitCode = 1;
  }
}
