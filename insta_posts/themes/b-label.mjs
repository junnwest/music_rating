// B — Label: near-black sleeve, mustard record-label accent, full-bleed photos.
// Slides carry the headline (plus a photo band + fact box on the summary slide);
// each slide's long text goes into caption.txt for per-photo captions.
const INK = '#131211';
const CREAM = '#EFE8D8';
const ACCENT = '#E6A93A';

export default {
  name: 'label',
  label: 'B — Label',
  css: `
.slide{background:${INK};color:${CREAM};font-family:Pretendard,sans-serif}
.wm{position:absolute;left:0;right:0;bottom:64px;text-align:center;z-index:3;color:${CREAM};opacity:.85;line-height:0}
.wm svg{height:40px;width:auto;fill:currentColor}
h1{font-weight:800;letter-spacing:-.035em;line-height:1.1;word-break:keep-all}
.copy{position:absolute;left:80px;right:80px;bottom:150px}
.bleed{position:absolute;inset:0 0 auto 0;height:900px}
.bleed img{width:100%;height:100%;object-fit:cover;filter:saturate(.75) contrast(1.05)}
.bleed:after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,${INK}66 0%,${INK}00 18%,${INK}00 55%,${INK} 100%)}
/* cover */
.cover .bleed{height:1350px}
.cover .bleed:after{background:linear-gradient(180deg,${INK}66 0%,${INK}00 20%,${INK}22 50%,${INK} 88%)}
.cover h1{font-size:120px}
/* album art (s.art): the square cover uncropped and unfiltered, over a blurred copy of itself */
.artbg{position:absolute;inset:-80px;width:calc(100% + 160px);height:calc(100% + 160px);object-fit:cover;filter:blur(60px) brightness(.4) saturate(1.1)}
.artbg-fade{position:absolute;inset:0;background:linear-gradient(180deg,${INK}00 45%,${INK}CC 75%,${INK} 100%)}
.art{position:absolute;left:50%;top:100px;width:800px;height:800px;margin-left:-400px;object-fit:cover;box-shadow:0 30px 90px #000B}
.photo .art,.table .art{top:120px;width:640px;height:640px;margin-left:-320px}
.table.has-art .copy{bottom:150px}
/* photo */
.photo h1{font-size:96px}
/* text: vinyl disc with label */
.disc{position:absolute;left:50%;top:150px;width:800px;height:800px;margin-left:-400px;border-radius:50%;
  background:repeating-radial-gradient(circle,#1d1c1a 0 2px,#0c0b0a 2px 5px);box-shadow:0 30px 80px #0008}
.disc:before{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 20deg,#fff0,#ffffff14 8%,#fff0 16%,#fff0 50%,#ffffff10 58%,#fff0 66%)}
.lbl{position:absolute;left:50%;top:50%;width:360px;height:360px;margin:-180px 0 0 -180px;border-radius:50%;background:${ACCENT};color:${INK};
  display:flex;align-items:center;justify-content:center;text-align:center;font-weight:900;letter-spacing:-.04em;line-height:.9}
.lbl span{font-size:160px;position:relative;top:-6px}
.lbl.two span{font-size:98px;line-height:1.05}
.lbl.word span{font-size:68px;line-height:1.1}
.text h1{font-size:88px}
/* table: photo band + fact box (label above value, two columns, no numbering) */
.table .bleed{height:560px}
.table .bleed:after{background:linear-gradient(180deg,${INK}55 0%,${INK}00 25%,${INK}00 50%,${INK} 100%)}
.table .copy{bottom:150px}
.table h1{font-size:76px;margin-bottom:36px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:30px 56px;border-top:1px solid ${CREAM}40;padding-top:32px}
.facts .k{font-size:24px;font-weight:500;color:${CREAM}8C;margin-bottom:8px;letter-spacing:.01em}
.facts .v{font-size:36px;font-weight:700;line-height:1.28;letter-spacing:-.02em;word-break:keep-all}
.facts.five .v{font-size:32px}
/* path: album covers in a column joined by arrows (a listening order or lineage) */
.path .pw{position:absolute;left:80px;right:80px;top:110px;bottom:150px;display:flex;flex-direction:column}
.path h1{font-size:76px;margin-bottom:44px}
.step{display:flex;align-items:center;gap:44px}
.step img{width:160px;height:160px;object-fit:cover;flex:none;box-shadow:0 12px 32px #000B}
.step .k{font-size:24px;font-weight:500;color:${CREAM}8C;margin-bottom:6px;letter-spacing:.01em}
.step .v{font-size:40px;font-weight:700;line-height:1.2;letter-spacing:-.02em}
.arrow{width:160px;height:52px;display:flex;align-items:center;justify-content:center;color:${CREAM}66}
.arrow svg{width:26px;height:34px;display:block}
.path .body{margin-top:auto}
.path.bare .pw{top:90px;bottom:140px;justify-content:center}
.path.bare .step{gap:56px}
.path.bare .step img{width:228px;height:228px}
.path.bare .step .k{font-size:30px;margin-bottom:10px}
.path.bare .step .v{font-size:54px}
.path.bare .arrow{width:228px;height:62px}
.path.bare .arrow svg{width:30px;height:42px}
/* table: full-page summary diagram, set like the back-cover credits of a record: a quiet label column,
   the value beside it, hairline rules between rows. No dots, no accent colour; rows sized to their content
   and the block centred in the page. 'timeline' and 'facts' share it. */
.tw{position:absolute;left:90px;right:90px;top:90px;bottom:170px;display:flex;flex-direction:column;justify-content:center}
.tw .g{display:grid;grid-template-columns:max-content 1fr}
.tw .k,.tw .v{padding:46px 0 48px;border-top:1px solid ${CREAM}33}
.tw .k{font-size:34px;font-weight:500;color:${CREAM}80;letter-spacing:0;font-variant-numeric:tabular-nums;line-height:1.2;padding-top:62px}
.tw .v{padding-left:64px;font-size:66px;font-weight:700;line-height:1.16;letter-spacing:-.03em;word-break:keep-all;text-wrap:balance}
.tw .g>:nth-last-child(-n+2){border-bottom:1px solid ${CREAM}33}
.tw.many .k,.tw.many .v{padding-top:34px;padding-bottom:36px}
.tw.many .k{padding-top:46px;font-size:30px}
.tw.many .v{font-size:56px}
/* grid: a closing slide of album covers (listen next / pick one). Optional short title; 2 side by side,
   3 as rows (cover left, name right), 4 as a 2x2 grid. */
.gw{position:absolute;left:80px;right:80px;top:110px;bottom:150px;display:flex;flex-direction:column}
.gw h1{font-size:72px;margin-bottom:20px}
.gg{flex:1;display:grid;align-content:center;justify-content:center;gap:48px 44px}
.gg.n2{grid-template-columns:repeat(2,438px)}
.gg.n4{grid-template-columns:repeat(2,360px);gap:40px 56px}
.gg img{width:100%;aspect-ratio:1;object-fit:cover;display:block;box-shadow:0 14px 40px #000B}
.gg .k{font-size:26px;font-weight:500;color:${CREAM}80;margin:22px 0 6px;letter-spacing:.01em}
.gg .v{font-size:38px;font-weight:700;line-height:1.2;letter-spacing:-.02em;word-break:keep-all}
.gg.n3{grid-template-columns:1fr;gap:44px;justify-content:stretch}
.gg.n3 .cell{display:flex;align-items:center;gap:52px}
.gg.n3 img{width:270px;flex:none}
.gg.n3 .k{margin-top:0;font-size:30px}
.gg.n3 .v{font-size:54px}
/* closing: brand end card */
.closing.white{background:#F5F2EA;color:${INK}}
.closing.white .wm{color:${INK}}
.closing.black{background:#000}
.flower{position:absolute;right:-370px;top:-240px;width:1120px;opacity:.4}
.closing h1{font-size:112px}
/* promo: launch posts (brand logo, founding badge) */
.promo-logo,.promo-badge{background:#FFFFFF;color:${INK}}
.promo-logo .wm,.promo-badge .wm{color:${INK}}
.promo-logo .wm{display:none}
.pl{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px}
.pl .mark{width:380px;margin-top:-40px}
.pl .word{color:${INK};line-height:0;margin-top:10px}
.pl .word svg{height:84px;width:auto;fill:currentColor}
.pl .lead{font-size:40px;font-weight:600;letter-spacing:-.02em;margin-top:70px;word-break:keep-all}
.pl .store{height:128px;width:auto;margin-top:190px}
.pl .web{margin-top:30px;font-family:'Plus Jakarta Sans',sans-serif;font-size:38px;font-weight:600;letter-spacing:-.01em;color:${INK}}
.pb{position:absolute;left:80px;right:80px;top:120px;bottom:150px;display:flex;flex-direction:column}
.pb h1{font-size:92px;line-height:1.12}
.pb .icon{width:600px;height:600px;margin:auto;color:#FF7A00}
.pb .icon svg{width:100%;height:100%;display:block}
/* with-text variant (post.captionInImage): each slide also shows its long text */
.wt .body{font-size:31px;line-height:1.62;font-weight:400;color:${CREAM}D9;word-break:keep-all;margin-top:28px}
.wt .copy{bottom:150px}
.wt.photo .bleed{height:900px}
.wt.photo h1,.wt.text h1{font-size:76px}
.wt .disc{top:110px;width:540px;height:540px;margin-left:-270px}
.wt .lbl{width:250px;height:250px;margin:-125px 0 0 -125px}
.wt .lbl span{font-size:112px}
.wt .lbl.two span{font-size:68px}
.wt .lbl.word span{font-size:48px}
.wt.table .body{font-size:29px;margin-top:34px}
.wt.closing h1{font-size:96px}
.wt.closing .body{font-size:34px}
.wt.closing.white .body{color:${INK}CC}
`,
  slide(s, c) {
    const wm = `<div class="wm">${c.wordmark}</div>`;
    const focus = s.focus ? ` style="object-position:${c.esc(s.focus)}"` : '';
    const art = s.art
      ? `<img class="artbg" src="${c.img(s.art)}"><div class="artbg-fade"></div><img class="art" src="${c.img(s.art)}">`
      : '';
    const bleed = art || (s.photo ? `<div class="bleed"><img src="${c.img(s.photo)}"${focus}></div>` : '');
    const h1Only = `<h1 data-fit="2">${c.br(s.title)}</h1>`;
    const body = c.withText && s.text && s.type !== 'cover' ? `<p class="body">${c.esc(s.text)}</p>` : '';
    const h1 = h1Only + body;
    let inner = '';
    let cls = s.type + (c.withText ? ' wt' : '');
    if (s.type === 'cover' || s.type === 'photo') inner = `${bleed}<div class="copy">${h1}</div>`;
    if (s.type === 'text') {
      const kind = s.big.includes('\n') ? 'two' : s.big.length > 3 ? 'word' : '';
      inner = `<div class="disc"><div class="lbl ${kind}"><span>${c.br(s.big)}</span></div></div><div class="copy">${h1}</div>`;
    }
    if (s.type === 'table') {
      // Full-page summary diagram: no photo, no title, no body; label/value rows between hairlines.
      const rows = s.rows.map(([k, v]) => `<div class="k">${c.esc(k)}</div><div class="v">${c.esc(v)}</div>`).join('');
      inner = `<div class="tw${s.rows.length > 4 ? ' many' : ''}"><div class="g">${rows}</div></div>`;
    }
    if (s.type === 'path') {
      const arrow = `<div class="arrow"><svg viewBox="0 0 26 34" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2v28M3 21l10 10 10-10"/></svg></div>`;
      const steps = s.items
        .map((it) => `<div class="step"><img src="${c.img(it.art)}"><div><div class="k">${c.esc(it.label || '')}</div><div class="v">${c.esc(it.name)}</div></div></div>`)
        .join(arrow);
      // No title and no text: the diagram gets the whole slide (the caption already says what it is).
      if (!s.title && !s.text) cls += ' bare';
      const head = s.title ? `<h1 data-fit="1">${c.br(s.title)}</h1>` : '';
      inner = `<div class="pw">${head}${steps}${body}</div>`;
    }
    if (s.type === 'grid') {
      const n = s.items.length;
      const cells = s.items
        .map((it) => `<div class="cell"><img src="${c.img(it.art)}"${it.focus ? ` style="object-position:${c.esc(it.focus)}"` : ''}><div><div class="k">${c.esc(it.label || '')}</div><div class="v">${c.esc(it.name)}</div></div></div>`)
        .join('');
      const head = s.title ? `<h1 data-fit="1">${c.br(s.title)}</h1>` : '';
      inner = `<div class="gw">${head}<div class="gg n${n}">${cells}</div></div>`;
    }
    if (s.type === 'promo-logo') {
      inner = `<div class="pl"><img class="mark" src="${c.flowerPng}"><div class="word">${c.wordmark}</div>${s.title ? `<div class="lead">${c.br(s.title)}</div>` : ""}<img class="store" src="${c.appStoreBadge}"><div class="web">${c.esc(s.web || '')}</div></div>`;
    }
    if (s.type === 'promo-badge') {
      inner = `<div class="pb"><h1 data-fit="2">${c.br(s.title)}</h1><div class="icon">${c.rocketSvg}</div></div>`;
    }
    if (s.type === 'closing') {
      cls += ` ${c.closingBg}`;
      inner = `<img class="flower" src="${c.flower}"><div class="copy">${h1.replace('data-fit="2"', 'data-fit="1"')}</div>`;
    }
    return `<section class="slide ${cls}">${inner}${wm}</section>`;
  },
};
