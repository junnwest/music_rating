// Transparent 1080x1920 overlays for the teammate's "앨범 평점 모음" reels: the overall score in the app's score
// badge (port of music_rating/apps/web/components/sj/ScoreBadge.tsx + lib/sj/display.ts spectrum), blurred on the
// first slide and revealed on the last.   node overlays.mjs jobs.json
// jobs.json: [{ out_dir, score (0–100), critic, user }]  → out_dir/{first,last_blur,last}.png
// The badge uses the app's 5-point scale: 0–100 / 20, one decimal.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// embedded as a data URI: a page opened with setContent may not load file:// images
const FLOWER = 'data:image/svg+xml;base64,' + (await readFile(new URL('../../../apps/web/public/logo-flower.svg', import.meta.url))).toString('base64');
const FONT = `<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">`;

// ── spectrum (copied from apps/web/lib/sj/display.ts) ──
const STOPS = [{ score: 0.5, hue: 25, chroma: 0.16 }, { score: 1.6, hue: 58, chroma: 0.145 }, { score: 2.7, hue: 126, chroma: 0.15 }, { score: 3.8, hue: 196, chroma: 0.115 }, { score: 5.0, hue: 262, chroma: 0.155 }];
const lerp = (a, b, t) => a + (b - a) * t;
function stop(score) {
  const s = Math.min(Math.max(score, 0.5), 5);
  for (let i = 0; i < STOPS.length - 1; i++) { const a = STOPS[i], b = STOPS[i + 1]; if (s <= b.score) { const t = (s - a.score) / (b.score - a.score); return { hue: lerp(a.hue, b.hue, t), chroma: lerp(a.chroma, b.chroma, t) }; } }
  return STOPS[STOPS.length - 1];
}
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function oklab(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function oklch(L, chroma, hue) {
  const rad = (hue * Math.PI) / 180; let c = chroma, rgb = [0, 0, 0];
  for (let i = 0; i < 24; i++) { rgb = oklab(L, c * Math.cos(rad), c * Math.sin(rad)); if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) break; c *= 0.92; }
  const [r, g, b] = rgb.map((v) => Math.round(Math.min(1, Math.max(0, gamma(Math.min(1, Math.max(0, v))))) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}
const color = (score, L, k = 1) => { const { hue, chroma } = stop(score); return oklch(L, chroma * k, hue); };
const fill = (s) => color(s, 0.92, 0.28), number = (s) => color(s, 0.45, 0.95), ring = (s) => color(s, 0.63, 1);

function badge(score, size) {
  const stroke = Math.round(size * 0.0625), gap = Math.round(size * 0.042);
  const d = size + 2 * (gap + stroke), r = (d - stroke) / 2, c = 2 * Math.PI * r, frac = Math.min(Math.max(score / 5, 0), 1);
  return `<div style="position:relative;width:${d}px;height:${d}px;margin:0 auto">
<svg width="${d}" height="${d}" style="transform:rotate(-90deg)"><circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="rgb(232,232,230)" stroke-width="${stroke}"/>
<circle cx="${d / 2}" cy="${d / 2}" r="${r}" fill="none" stroke="${ring(score)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c * frac} ${c}"/></svg>
<div style="position:absolute;inset:${gap + stroke}px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${fill(score)};box-shadow:inset 0 ${size * 0.02}px ${size * 0.04}px rgba(255,255,255,.6),0 ${size * 0.02}px ${size * 0.06}px rgba(0,0,0,.12)">
<img src="${FLOWER}" style="position:absolute;width:${size * 0.66}px;height:${size * 0.66}px;opacity:.6;filter:brightness(0) invert(1) drop-shadow(0 ${size * 0.02}px ${size * 0.02}px rgba(0,0,0,.3))">
<span style="position:relative;font-weight:800;line-height:1;font-size:${size * 0.37}px;color:${number(score)};text-shadow:0 0 ${size * 0.06}px rgba(255,255,255,.55);transform:scaleY(1.14);letter-spacing:-.02em">${score.toFixed(1)}</span></div></div>`;
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8">${FONT}<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1080px;height:1920px;background:transparent;font-family:Pretendard,sans-serif;color:#1b1b1b}
.blk{position:absolute;left:0;right:0;text-align:center}
.lbl{font-size:34px;font-weight:700;letter-spacing:.02em;color:#2a2a2a;margin-bottom:22px}
.sub{font-size:30px;font-weight:600;color:#555;margin-top:22px}
.blur{filter:blur(26px)}
.alb{font-size:54px;font-weight:800;letter-spacing:-.02em;color:#151515;padding:0 80px;word-break:keep-all;line-height:1.15}
.art{font-size:32px;font-weight:500;color:#444;margin-top:12px}
</style></head><body>${body}</body></html>`;

// last slide text layer (composited by retime.py over the cleaned background and the moved logo)
const esc = (t = '') => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const endText = (j, badgeHtml, parts) => `<div class="blk" style="top:290px"><div class="alb">${esc(j.album)}</div><div class="art">${esc(j.artist)} · ${esc(j.year)}</div></div>
<div class="blk" style="top:520px"><div class="lbl">종합 점수</div>${badgeHtml}<div class="sub">${parts}</div></div>`;

const LEVELS = 20;
const jobs = JSON.parse(await readFile(process.argv[2], 'utf8'));
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
for (const j of jobs) {
  await mkdir(j.out_dir, { recursive: true });
  const s5 = Math.round((j.score / 20) * 10) / 10;
  const f5 = (v) => (Math.round((v / 20) * 10) / 10).toFixed(1);
  const parts = [j.critic != null ? `평론가 ${f5(j.critic)}` : null, j.user != null ? `유저 ${f5(j.user)}` : null].filter(Boolean).join(' · ');
  const shots = {
    first: `<div class="blk" style="top:1480px"><div class="lbl">종합 점수</div><div class="blur">${badge(s5, 150)}</div></div>`,
    // focus pull: 21 levels from fully blurred to sharp (blur radius and a small scale-up), composited per level
    ...Object.fromEntries(Array.from({ length: LEVELS + 1 }, (_, i) => {
      const k = i / LEVELS;
      return [`lvl_${String(i).padStart(2, '0')}`, endText(j, `<div style="filter:blur(${(26 * (1 - k)).toFixed(2)}px);transform:scale(${(0.94 + 0.06 * k).toFixed(4)})">${badge(s5, 330)}</div>`, parts)];
    })),
  };
  for (const [name, body] of Object.entries(shots)) {
    await p.setContent(page(body), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(j.out_dir, `${name}.png`), omitBackground: true });
  }
}
await browser.close();
console.log(`${jobs.length} overlay sets`);
