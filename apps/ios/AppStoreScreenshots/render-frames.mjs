#!/usr/bin/env node
/**
 * Capture the animated reel scene frame by frame.
 *
 *   node render-frames.mjs --lang=reel          → reel/frames/0001.png …
 *   node render-frames.mjs --lang=reel --fps=30 --scale=1
 *
 * WHY THIS EXISTS RATHER THAN export.mjs. That script spawns a whole browser per image, with a fresh
 * temp profile and a 15-second virtual-time budget — fine for six stills, hopeless for the ~470 frames
 * a 15-second reel needs: twenty-odd minutes of process churn. This keeps ONE browser open and talks
 * to it over the DevTools protocol, so a frame costs a seek and a screenshot. Node 22+ ships a global
 * WebSocket, so CDP needs no dependency, which keeps this folder's no-npm-deps rule intact.
 *
 * DETERMINISM IS THE WHOLE DESIGN. The page exposes SJ_REEL.seek(t) as a pure function of time with no
 * CSS transitions and no rAF, so a frame is identical whenever it is asked for. That is what makes a
 * frame-at-a-time capture valid, and why a crashed run can simply be re-run: existing frames are
 * skipped unless --force.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncAssets } from './sync-assets.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d;

const LANG = opt('lang', 'reel');
const LANG_DIR = LANG ? path.join(ROOT, LANG) : ROOT;
const cfgPath = path.join(LANG_DIR, 'slides.config.js');
if (!fs.existsSync(cfgPath)) { console.error(`No ${LANG}/slides.config.js`); process.exit(1); }
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(cfgPath, 'utf8'), ctx);
const cfg = ctx.window.APPSHOTS;
syncAssets();

const { width: W, height: H } = cfg.canvas;
const FPS = Number(opt('fps', cfg.reel?.fps ?? 30));
const OUT = path.resolve(LANG_DIR, opt('out', 'frames'));
const FORCE = has('force');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  const hit = c.find((p) => fs.existsSync(p));
  if (!hit) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(1); }
  return hit;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'appshots-reel-'));
const chrome = spawn(findChrome(), [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--force-device-scale-factor=1', `--window-size=${W},${H}`,
  '--remote-debugging-port=0', '--remote-allow-origins=*', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

// Chrome prints the DevTools endpoint on stderr once it is listening; there is no other way to learn
// the port when it was asked for 0.
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('Browser did not report a DevTools endpoint')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(timer); resolve(m[0]); }
  });
  chrome.on('close', (c) => { clearTimeout(timer); reject(new Error(`Browser exited ${c}\n${buf.slice(-500)}`)); });
});

const ws = new WebSocket(wsUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('CDP connect failed')); });
let msgId = 0;
const pending = new Map();
const events = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { ok, no } = pending.get(m.id); pending.delete(m.id);
    m.error ? no(new Error(m.error.message)) : ok(m.result);
  } else if (m.method && events.has(m.method)) { events.get(m.method)(); events.delete(m.method); }
};
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++msgId; pending.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const once = (method) => new Promise((ok) => events.set(method, ok));

// No width/height here: Chrome rejects a size on a tab target ("Target position can only be set for
// new windows"), and the viewport is set properly by setDeviceMetricsOverride below anyway.
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const call = (m, p) => send(m, p, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: Number(opt('scale', 1)), mobile: false });

const url = `http://127.0.0.1:${port}/index.html?${LANG ? `lang=${LANG}&` : ''}anim&t=0`;
const loaded = once('Page.loadEventFired');
await call('Page.navigate', { url });
await loaded;

// Wait for the scene to exist and its fonts and images to settle. Without this the first frames can
// capture fallback type or a missing flower, which is invisible until the encoded reel is watched.
const ready = async () => {
  for (let i = 0; i < 200; i++) {
    const r = await call('Runtime.evaluate', {
      expression: 'Boolean(window.SJ_REEL) && document.fonts.status === "loaded" && [...document.images].every(i => i.complete)',
      returnByValue: true,
    });
    if (r.result?.value) return true;
    await new Promise((ok) => setTimeout(ok, 50));
  }
  return false;
};
if (!await ready()) { console.error('Scene never became ready (is ?anim supported in index.html?)'); process.exit(1); }

const info = (await call('Runtime.evaluate', { expression: 'JSON.stringify({d: SJ_REEL.duration})', returnByValue: true })).result.value;
const DURATION = Number(opt('duration', JSON.parse(info).d));
const TOTAL = Math.round(DURATION * FPS);

fs.mkdirSync(OUT, { recursive: true });
console.log(`${TOTAL} frames · ${DURATION.toFixed(2)}s @ ${FPS}fps · ${W}x${H} → ${path.relative(process.cwd(), OUT)}`);

let wrote = 0, skipped = 0;
const t0 = Date.now();
for (let n = 0; n < TOTAL; n++) {
  const file = path.join(OUT, `${String(n + 1).padStart(4, '0')}.png`);
  if (!FORCE && fs.existsSync(file)) { skipped++; continue; }
  const t = n / FPS;
  await call('Runtime.evaluate', { expression: `SJ_REEL.seek(${t})`, returnByValue: true });
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  wrote++;
  if (wrote % 30 === 0) process.stdout.write(`  ${n + 1}/${TOTAL}\r`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  ✓ ${wrote} frame(s) written${skipped ? `, ${skipped} already present` : ''} in ${secs}s`);

try { chrome.kill(); } catch { /* already gone */ }
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold a lock */ }
process.exit(0);
