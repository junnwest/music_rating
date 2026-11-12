// Render a reel (1080x1920, 30fps, H.264, no audio — music is added in the Instagram app from its
// licensed library, never baked in here).
//
//   node reels/render-reel.mjs <slug> [type]     (type: tier | countdown | barrace; default reel.type)
//
// Reads  reels/work/<slug>/reel.json (+ assets/)
// Writes reels/out/<slug>/reel.mp4, cover.png (last frame, for the Reels cover), caption.txt
//
// Each reel type is an HTML page whose state is a pure function of time: window.setT(seconds). Frames are
// captured one by one (deterministic, no real-time animation) and piped into ffmpeg.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const W = 1080, H = 1920, FPS = 30;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const BRAND = fileURLToPath(new URL('../brand/', import.meta.url));
const INK = '#131211', CREAM = '#EFE8D8';
const FONTS = `<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">`;
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- tier list ---------------------------------------------------------------------------------------
// Covers pop up big in the middle, one at a time (lowest tier first, S last), then fly into their row.
// Instagram overlays its UI on the top ~220px, the bottom ~380px and a right-hand strip; content stays clear.
function tierPage(reel, img, wordmark) {
  const T = { intro: 0.9, per: 1.25, outro: 2.8 };
  const rowTop = 460, rowH = 300, slot = 212, gap = 22, slotX = 196;
  const rows = reel.tiers;
  const count = {};
  const items = reel.items.map((it) => {
    const r = rows.indexOf(it.tier);
    const k = (count[it.tier] = (count[it.tier] || 0) + 1) - 1;
    return { ...it, x: slotX + k * (slot + gap), y: rowTop + r * rowH + 26 };
  });
  const duration = T.intro + items.length * T.per + T.outro;
  const css = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;background:${INK};color:${CREAM};font-family:Pretendard,sans-serif;overflow:hidden;position:relative}
.title{position:absolute;left:60px;right:140px;top:236px;font-size:84px;font-weight:800;letter-spacing:-.04em;line-height:1.05}
.sub{position:absolute;left:62px;top:342px;font-size:34px;font-weight:500;color:${CREAM}99}
.row{position:absolute;left:60px;right:60px;height:${rowH}px;border-top:1px solid ${CREAM}2E}
.row:last-of-type{border-bottom:1px solid ${CREAM}2E}
.tier{position:absolute;left:0;top:50%;transform:translateY(-50%);font-size:120px;font-weight:800;letter-spacing:-.05em;width:120px}
.it{position:absolute;left:0;top:0;width:${slot}px;transform-origin:0 0;will-change:transform}
.it img{width:${slot}px;height:${slot}px;object-fit:cover;display:block;box-shadow:0 10px 30px #000A}
.it .nm{font-size:21px;font-weight:600;line-height:1.2;margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${CREAM}D9}
.scrim{position:absolute;inset:0;background:${INK};opacity:0;z-index:5}
.pop{position:absolute;left:0;right:0;text-align:center;opacity:0;z-index:11}
.pop .a{font-size:36px;font-weight:500;color:${CREAM}A6;margin-bottom:8px}
.pop .n{font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.1;padding:0 120px;word-break:keep-all}
.end{position:absolute;left:60px;right:140px;top:1410px;opacity:0}
.end .q{font-size:76px;font-weight:800;letter-spacing:-.04em}
.end .c{font-size:34px;font-weight:500;color:${CREAM}99;margin-top:14px}
.wm{position:absolute;right:60px;top:${rowTop - 64}px;line-height:0;opacity:.7}
.wm svg{height:30px;width:auto;fill:${CREAM}}
`;
  const html = `
<div class="title">${esc(reel.title)}</div><div class="sub">${esc(reel.sub || '')}</div>
<div class="wm">${wordmark}</div>
${rows.map((t, r) => `<div class="row" style="top:${rowTop + r * rowH}px"><div class="tier">${esc(t)}</div></div>`).join('')}
<div class="scrim" id="scrim"></div>
${items.map((it, i) => `<div class="it" id="it${i}"><img src="${img(it.art)}"><div class="nm">${esc(it.name)}</div></div>`).join('')}
<div class="pop" id="pop"><div class="a" id="popA"></div><div class="n" id="popN"></div></div>
<div class="end" id="end"><div class="q">${esc(reel.end)}</div><div class="c">댓글로 알려주세요</div></div>`;
  const js = `
const T=${JSON.stringify(T)}, items=${JSON.stringify(items.map(({ x, y, name, artist, year }) => ({ x, y, name, artist, year })))};
const BIG=600, BX=(${W}-BIG)/2, BY=440;
const clamp=(v)=>Math.max(0,Math.min(1,v)), lerp=(a,b,u)=>a+(b-a)*u;
const outBack=(u)=>{const c=1.5;return 1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2)};
const inOut=(u)=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;
window.setT=(t)=>{
  let scrim=0, pop=null, popO=0;
  items.forEach((it,i)=>{
    const el=document.getElementById('it'+i), s=T.intro+i*T.per, u=t-s;
    if(u<0){el.style.opacity=0;return}
    el.style.opacity=1; el.style.zIndex=10;
    const popIn=clamp(u/0.32), fly=inOut(clamp((u-0.82)/0.36));
    const sc0=BIG/${slot}, sc=lerp(sc0*(0.72+0.28*outBack(popIn)),1,fly);
    const x=lerp(BX,it.x+${60},fly), y=lerp(BY,it.y,fly);
    el.style.transform='translate('+x+'px,'+y+'px) scale('+sc+')';
    el.querySelector('.nm').style.opacity=fly;
    if(u<1.18){scrim=Math.max(scrim,0.92*clamp(u/0.1)*(1-fly)); pop=it; popO=clamp(u/0.25)*(1-clamp((u-0.78)/0.2));}
    else el.style.zIndex=1;
  });
  document.getElementById('scrim').style.opacity=scrim;
  const p=document.getElementById('pop');
  if(pop){document.getElementById('popA').textContent=pop.artist+' · '+pop.year;document.getElementById('popN').textContent=pop.name;}
  p.style.opacity=popO; p.style.top=(BY+BIG+44)+'px';
  const e=T.intro+items.length*T.per, eu=clamp((t-e)/0.35);
  const end=document.getElementById('end'); end.style.opacity=eu; end.style.transform='translateY('+(1-eu)*30+'px)';
};`;
  return { duration, html: `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONTS}<style>${css}</style></head><body>${html}<script>${js}</script></body></html>` };
}


// ---- ranking reels (data from reels/grade.mjs → graded.json) -----------------------------------------
// Shared: the list is `reel.ranked` (top N, best first), each with parts {ratings, reach, recognition}, the
// renormalised weights used for its grade (w), and draft=true while RYM/AOTY are not entered yet.
const PART_LABEL = { ratings: '평점', reach: '인기', recognition: '수상' };
const baseCss = `*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;background:${INK};color:${CREAM};font-family:Pretendard,sans-serif;overflow:hidden;position:relative}
.hd{position:absolute;left:60px;right:140px;top:220px}
.hd .title{font-size:64px;font-weight:800;letter-spacing:-.04em;line-height:1.12;word-break:keep-all;white-space:pre-line}
.hd .sub{font-size:28px;font-weight:500;color:${CREAM}99;margin-top:12px}
.draft{position:absolute;right:60px;top:180px;font-size:24px;font-weight:700;letter-spacing:.08em;color:${INK};background:${CREAM};padding:6px 12px}
.wm{position:absolute;left:0;right:0;top:1490px;text-align:center;line-height:0;opacity:.85}.wm svg{height:40px;width:auto;fill:${CREAM}}`;
const rpage = (css, html, js) => `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONTS}<style>${baseCss}${css}</style></head><body>${html}<script>${js}</script></body></html>`;
const header = (reel, wordmark, draft) => `<div class="hd"><div class="title">${esc(reel.title)}</div><div class="sub">${esc(reel.sub || '')}</div></div>
<div class="wm">${wordmark}</div>${draft ? '<div class="draft">DRAFT · 평점 미입력</div>' : ''}`;

function countdownPage(reel, img, wordmark) {
  const items = reel.ranked;
  const n = items.length;
  // shown order k = 0..n-1 is rank n..1; #N…#4 quick, top 3 slower, then a recap grid.
  const durs = items.map((_, k) => (n - 1 - k < 3 ? 3.0 : 2.0));
  const starts = [];
  durs.forEach((d, k) => starts.push(k ? starts[k - 1] + durs[k - 1] : 0.5));
  const endAt = starts[n - 1] + durs[n - 1];
  const duration = endAt + 3.2;
  const css = `
.card{position:absolute;left:60px;right:60px;top:480px;height:900px;opacity:0}
.rk{font-size:150px;font-weight:800;letter-spacing:-.05em;line-height:1}
.cv{position:absolute;right:0;top:0;width:520px;height:520px;object-fit:cover;box-shadow:0 20px 60px #000B}
.meta{position:absolute;left:0;right:0;top:560px}
.meta .a{font-size:32px;font-weight:500;color:${CREAM}A6}
.meta .n{font-size:58px;font-weight:800;letter-spacing:-.03em;line-height:1.1;margin-top:6px;word-break:keep-all}
.score{position:absolute;left:0;top:200px;font-size:110px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.score small{display:block;font-size:26px;font-weight:500;color:${CREAM}99;letter-spacing:0;margin-bottom:4px}
.parts{position:absolute;left:0;right:0;top:800px;display:flex;gap:44px;font-size:26px;color:${CREAM}A6}
.parts b{display:block;font-size:40px;color:${CREAM};font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums}
.recap{position:absolute;left:60px;right:60px;top:480px;display:grid;grid-template-columns:repeat(5,1fr);gap:26px 18px;opacity:0}
.recap div{font-size:22px;font-weight:600;color:${CREAM}D9;line-height:1.2;word-break:keep-all}
.recap img{width:100%;aspect-ratio:1;object-fit:cover;display:block;margin-bottom:8px}
.endq{position:absolute;left:60px;right:140px;top:1180px;font-size:72px;font-weight:800;letter-spacing:-.04em;opacity:0}`;
  const cards = items.map((it, i) => `<div class="card" id="c${i}"><div class="rk">#${i + 1}</div>
<img class="cv" src="${img(it.art)}"><div class="score"><small>점수</small><span id="s${i}">0.0</span></div>
<div class="meta"><div class="a">${esc(it.artist)} · ${esc(it.year)}${reel.yearSuffix ? " " + esc(reel.yearSuffix) : ""}</div><div class="n">${esc(it.album)}</div></div>
<div class="parts">${Object.keys(PART_LABEL).map((k) => `<div>${PART_LABEL[k]}<b>${it.parts[k] == null ? '—' : Math.round(it.parts[k])}</b></div>`).join('')}</div></div>`).join('');
  const recap = `<div class="recap" id="recap">${items.map((it, i) => `<div><img src="${img(it.art)}">${i + 1}. ${esc(it.album)}</div>`).join('')}</div>`;
  const js = `
const n=${n}, starts=${JSON.stringify(starts)}, durs=${JSON.stringify(durs)}, endAt=${endAt}, grades=${JSON.stringify(items.map((x) => x.grade))};
const clamp=(v)=>Math.max(0,Math.min(1,v)), out=(u)=>1-Math.pow(1-u,3);
window.setT=(t)=>{
  for(let k=0;k<n;k++){
    const i=n-1-k, el=document.getElementById('c'+i), u=t-starts[k], d=durs[k];
    const a=clamp(u/0.3)*(1-clamp((u-d+0.3)/0.3)); el.style.opacity=u<0?0:a;
    el.style.transform='translateY('+((1-out(clamp(u/0.45)))*60)+'px)';
    document.getElementById('s'+i).textContent=(grades[i]*out(clamp((u-0.15)/1.0))).toFixed(1);
  }
  document.getElementById('recap').style.opacity=clamp((t-endAt)/0.4);
  document.getElementById('endq').style.opacity=clamp((t-endAt-0.5)/0.4);
};`;
  return { duration, html: rpage(css, header(reel, wordmark, reel.draft) + cards + recap + `<div class="endq" id="endq">${esc(reel.end)}</div>`, js) };
}

function barracePage(reel, img, wordmark) {
  const items = reel.ranked; const n = items.length;
  const keys = ['ratings', 'reach', 'recognition'];
  const contrib = items.map((it) => keys.map((k) => (it.parts[k] == null ? 0 : it.parts[k] * it.w[k])));
  const stages = [{ t0: 0.8, t1: 3.8 }, { t0: 4.3, t1: 7.0 }, { t0: 7.5, t1: 9.6 }];
  const duration = 13.0;
  const rowTop = 510, rowH = 86, barX = 430, barMax = 440;
  const css = `
.row{position:absolute;left:60px;right:60px;top:0;height:${rowH - 12}px;will-change:transform}
.row img{position:absolute;left:0;top:0;width:${rowH - 12}px;height:${rowH - 12}px;object-fit:cover}
.row .l{position:absolute;left:${rowH + 6}px;top:6px;width:${barX - rowH - 84}px;font-size:24px;font-weight:700;line-height:1.15;word-break:keep-all;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row .l small{display:block;font-size:19px;font-weight:500;color:${CREAM}99;margin-top:4px}
.row .bar{position:absolute;left:${barX - 60}px;top:22px;height:36px;display:flex}
.row .bar i{display:block;height:100%}
.row .v{position:absolute;top:22px;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;line-height:36px}
.stage{position:absolute;left:60px;top:455px;font-size:30px;font-weight:700}
.legend{position:absolute;left:60px;right:200px;top:1408px;display:flex;gap:28px;font-size:24px;color:${CREAM}B3}
.legend span::before{content:'';display:inline-block;width:18px;height:18px;margin-right:8px;vertical-align:-2px;background:var(--c)}
.endq{position:absolute;left:60px;right:140px;top:1392px;font-size:52px;font-weight:800;letter-spacing:-.03em;opacity:0}`;
  const shades = [`${CREAM}`, `${CREAM}99`, `${CREAM}55`]; // steps of one colour, no chart palette
  const rows = items.map((it, i) => `<div class="row" id="r${i}"><img src="${img(it.art)}"><div class="l">${esc(it.album)}<small>${esc(it.artist)}</small></div>
<div class="bar">${keys.map((k, j) => `<i id="b${i}_${j}" style="background:${shades[j]}"></i>`).join('')}</div><div class="v" id="v${i}"></div></div>`).join('');
  const html = header(reel, wordmark, reel.draft) + `<div class="stage" id="stage"></div>` + rows +
    `<div class="legend" id="legend">${keys.map((k, j) => `<span style="--c:${shades[j]}">${PART_LABEL[k]} ${Math.round(reel.weights[k] * 100)}%</span>`).join('')}</div><div class="endq" id="endq">${esc(reel.end)}</div>`;
  const labels = keys.map((k, j) => ['①', '②', '③'][j] + ' ' + (j ? '+ ' : '') + PART_LABEL[k] + ' ' + Math.round(reel.weights[k] * 100) + '%');
  const js = `
const n=${n}, C=${JSON.stringify(contrib)}, S=${JSON.stringify(stages)}, rowTop=${rowTop}, rowH=${rowH}, barMax=${barMax}, labels=${JSON.stringify(labels)};
const clamp=(v)=>Math.max(0,Math.min(1,v)), io=(u)=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;
const total=(i,p)=>C[i].reduce((s,c,j)=>s+c*p[j],0);
const ranks=(p)=>{const o=[...Array(n).keys()].sort((a,b)=>total(b,p)-total(a,p)||a-b);const r=[];o.forEach((i,k)=>r[i]=k);return r;};
const mx=Math.max(...[...Array(n).keys()].map(i=>total(i,[1,1,1])));
window.setT=(t)=>{
  const p=S.map(s=>io(clamp((t-s.t0)/(s.t1-s.t0))));
  let st=0; for(let k=0;k<3;k++) if(t>=S[k].t0) st=k;
  const before=[0,1,2].map(k=>k<st?1:0), after=[0,1,2].map(k=>k<=st?1:0), u=p[st];
  const r0=ranks(before), r1=ranks(after);
  for(let i=0;i<n;i++){
    const y=rowTop+(r0[i]+(r1[i]-r0[i])*u)*rowH;
    document.getElementById('r'+i).style.transform='translateY('+y+'px)';
    for(let j=0;j<3;j++) document.getElementById('b'+i+'_'+j).style.width=(C[i][j]*p[j]/mx*barMax)+'px';
    const v=document.getElementById('v'+i), w=total(i,p)/mx*barMax;
    v.style.left=(${barX - 60}+w+14)+'px'; v.textContent=t<S[0].t0?'':total(i,p).toFixed(1);
  }
  document.getElementById('stage').textContent=t<S[0].t0?'':labels[st];
  document.getElementById('legend').style.opacity=1-clamp((t-S[2].t1-0.2)/0.3);
  document.getElementById('endq').style.opacity=clamp((t-S[2].t1-0.4)/0.4);
};`;
  return { duration, html: rpage(css, html, js) };
}


// ---- timeline: one artist's albums in release order, 평점 (RYM/AOTY average, 0–100) as a line -----------------
// Each album: the line draws to its point, the cover pops above it with the value. Timing mirrored in add-audio.mjs.
const LINE_T = { intro: 0.6, per: 2.2, outro: 3.0 };
function linePage(reel, img, wordmark) {
  const items = reel.ranked; const n = items.length;
  const vals = items.map((a) => a.parts.ratings);
  const lo = Math.floor((Math.min(...vals) - 4) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 4) / 5) * 5;
  const X0 = 150, X1 = 960, Y0 = 1240, Y1 = 640; // plot box (y grows down)
  const px = (i) => (n === 1 ? (X0 + X1) / 2 : X0 + (i * (X1 - X0)) / (n - 1));
  const py = (v) => Y0 - ((v - lo) / (hi - lo)) * (Y0 - Y1);
  const pts = items.map((a, i) => ({ x: px(i), y: py(vals[i]), v: vals[i] }));
  const T = LINE_T, duration = T.intro + n * T.per + T.outro;
  const cov = n > 8 ? 92 : n > 6 ? 104 : 120;
  const grid = [lo, (lo + hi) / 2, hi].map((g) => `<div class="gl" style="top:${py(g)}px"><span>${Math.round(g)}</span></div>`).join('');
  const css = `
.gl{position:absolute;left:60px;right:60px;height:0;border-top:1px solid ${CREAM}22}
.gl span{position:absolute;left:0;top:-30px;font-size:22px;color:${CREAM}80;font-variant-numeric:tabular-nums}
svg.ln{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:visible}
.pt{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:${CREAM};opacity:0}
.cv{position:absolute;width:${cov}px;height:${cov}px;object-fit:cover;box-shadow:0 8px 24px #000B;opacity:0}
.val{position:absolute;width:160px;margin-left:-80px;text-align:center;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;opacity:0}
.yr{position:absolute;top:${Y0 + 26}px;width:160px;margin-left:-80px;text-align:center;font-size:22px;color:${CREAM}99;opacity:0}
.cap{position:absolute;left:60px;right:140px;top:${Y0 + 90}px;opacity:0}
.cap .n{font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1.15;word-break:keep-all}
.cap .a{font-size:26px;color:${CREAM}A6;margin-top:6px}
.endq{position:absolute;left:60px;right:140px;top:${Y0 + 90}px;font-size:56px;font-weight:800;letter-spacing:-.03em;opacity:0}`;
  const html = header(reel, wordmark, false) + grid +
    `<svg class="ln" viewBox="0 0 ${W} ${H}"><polyline id="line" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" points=""/></svg>` +
    pts.map((p, i) => `<div class="pt" id="p${i}" style="left:${p.x}px;top:${p.y}px"></div>
<img class="cv" id="c${i}" src="${img(items[i].art)}" style="left:${p.x - cov / 2}px;top:${p.y - cov - 70}px">
<div class="val" id="v${i}" style="left:${p.x}px;top:${p.y - 58}px">${p.v.toFixed(1)}</div>
<div class="yr" id="y${i}" style="left:${p.x}px">${esc(items[i].year || '')}</div>
<div class="cap" id="t${i}"><div class="n">${esc(items[i].album)}</div><div class="a">${esc(items[i].year || '')} · 평점 ${p.v.toFixed(1)}</div></div>`).join('') +
    `<div class="endq" id="endq">${esc(reel.end)}</div>`;
  const js = `
const T=${JSON.stringify(T)}, P=${JSON.stringify(pts)}, n=${n};
const clamp=(v)=>Math.max(0,Math.min(1,v)), io=(u)=>u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2, ob=(u)=>{const c=1.6;return 1+(c+1)*Math.pow(u-1,3)+c*Math.pow(u-1,2)};
window.setT=(t)=>{
  const pts=[];
  for(let i=0;i<n;i++){
    const s=T.intro+i*T.per, u=t-s;
    // the line reaches point i over the first 0.6 s of its turn (point 0 just appears)
    const g=i===0?clamp(u/0.2):io(clamp(u/0.6));
    if(u>=0){ if(i===0) pts.push(P[0]); else { const a=P[i-1], b=P[i]; pts.push({x:a.x+(b.x-a.x)*g, y:a.y+(b.y-a.y)*g}); } }
    const arrive=clamp((u-(i===0?0:0.55))/0.25);
    document.getElementById('p'+i).style.opacity=arrive;
    const pop=clamp((u-(i===0?0.05:0.6))/0.35);
    const c=document.getElementById('c'+i); c.style.opacity=pop; c.style.transform='scale('+(0.6+0.4*ob(pop))+')';
    document.getElementById('v'+i).style.opacity=pop; document.getElementById('y'+i).style.opacity=pop;
    const cap=document.getElementById('t'+i); cap.style.opacity=u<0?0:clamp((u-0.6)/0.25)*(1-clamp((u-T.per+0.25)/0.25)) * (i===n-1 ? 1-clamp((t-(T.intro+n*T.per))/0.3) : 1);
  }
  document.getElementById('line').setAttribute('points', pts.map(p=>p.x+','+p.y).join(' '));
  document.getElementById('endq').style.opacity=clamp((t-(T.intro+n*T.per)-0.3)/0.4);
};`;
  return { duration, html: rpage(css, html, js) };
}

const TYPES = { tier: tierPage, countdown: countdownPage, barrace: barracePage, line: linePage };

function caption(reel) {
  const credits = [...new Set((reel.items || (reel.ranked || []).map((a) => ({ credit: `Album cover: ${a.album} (${a.artist_en})` }))).map((i) => i.credit).filter(Boolean))];
  return `${reel.caption}\n\n${reel.hashtags || ''}\n\n${credits.join('\n')}\n`;
}

async function main() {
  const slug = basename(process.argv[2] || '');
  if (!slug) { console.error('Usage: node reels/render-reel.mjs <slug>'); process.exit(1); }
  const workDir = join(ROOT, 'work', slug), outDir = join(ROOT, 'out', slug);
  const reel = JSON.parse(await readFile(join(workDir, 'reel.json'), 'utf8'));
  const type = process.argv[3] || reel.type;
  const make = TYPES[type];
  if (!make) throw new Error(`Unknown reel type "${type}"`);
  if (type === 'line') { reel.title = reel.lineTitle || reel.title; reel.sub = reel.lineSub || 'RYM·AOTY 유저 평점 평균'; reel.end = reel.lineEnd || '여러분이 가장 좋아하는 앨범은?'; }
  if (reel.data) { // ranking reels: top N from graded.json (reels/grade.mjs)
    const g = JSON.parse(await readFile(join(workDir, reel.data), 'utf8'));
    reel.weights = g.weights;
    const pool = type === 'line'
      ? g.albums.filter((a) => a.parts?.ratings != null && a.art).sort((a, b) => String(a.year).localeCompare(String(b.year)))
      : g.albums.filter((a) => a.grade != null && a.art).slice(0, reel.top || 10);
    reel.ranked = pool.map((a) => {
      const used = Object.keys(g.weights).filter((k) => a.parts[k] != null);
      const ws = used.reduce((t, k) => t + g.weights[k], 0);
      return { ...a, w: Object.fromEntries(Object.keys(g.weights).map((k) => [k, used.includes(k) ? g.weights[k] / ws : 0])) };
    });
    reel.draft = reel.ranked.some((a) => a.draft);
  }
  const outName = reel.data ? `reel-${type}.mp4` : 'reel.mp4';
  const wordmark = (await readFile(join(BRAND, 'wordmark.svg'), 'utf8')).replace(/<\?xml[^>]*\?>\s*/, '');
  const { duration, html } = make(reel, (p) => pathToFileURL(resolve(workDir, p)).href, wordmark);
  await mkdir(outDir, { recursive: true });
  const htmlPath = join(workDir, '.reel.html');
  await writeFile(htmlPath, html);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium', '-r', String(FPS),
    '-movflags', '+faststart', join(outDir, outName)], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  const n = Math.round(duration * FPS);
  let last;
  for (let f = 0; f < n; f++) {
    await page.evaluate((t) => window.setT(t), f / FPS);
    last = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(last)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await writeFile(join(outDir, outName.replace('.mp4', '-cover.png')), last);
  await writeFile(join(outDir, 'caption.txt'), caption(reel));
  await browser.close();
  console.log(`${slug} ${type}: ${n} frames, ${duration.toFixed(1)}s -> ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
