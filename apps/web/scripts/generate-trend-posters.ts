/**
 * Stage 4 (final) of the trend-post pipeline: renders the approved poster
 * template from real pipeline data, for every spike that has a
 * human-verified cause. Three chart forms rotate across posts (line,
 * big-number + sparkline, before/after bars) so a batch doesn't read as one
 * template with the artist name swapped — same real ratio underneath either
 * way, just a different honest way of showing it.
 *
 * Framed as "화제성" (buzz/topic-momentum), not "위키 조회수" — the metric is
 * still real Wikipedia pageview data, but that's a dry technical label, not
 * how a Korean entertainment outlet would actually describe a spike.
 *
 * This is the "generate endless posts" piece — once
 * scripts/data/trend-post-causes.json has an entry for a spike (artist,
 * verified headline, cause label, chart form), running this script produces
 * a finished poster with zero further design work.
 *
 * Input:
 *   scripts/output/trend-spike-candidates.json (real data, from detect-pageview-spikes.ts)
 *   scripts/data/trend-post-causes.json (verified causes + chart form, human-curated)
 * Output:
 *   scripts/output/trend-posters/<slug>.dc.html — one Design Component per post
 *
 * Run:
 *   npx tsx scripts/generate-trend-posters.ts
 */
import fs from 'fs';
import path from 'path';

const SPIKES_PATH = path.resolve('scripts/output/trend-spike-candidates.json');
const CAUSES_PATH = path.resolve('scripts/data/trend-post-causes.json');
const OUT_DIR = path.resolve('scripts/output/trend-posters');

type ChartForm = 'line' | 'bignum' | 'bars' | 'timeline';

interface SpikeCandidate {
  artist: string;
  wikiTitle: string;
  spikeYm: string;
  spikeViews: number;
  baselineMedian: number;
  ratio: number;
  series: { ym: string; views: number }[];
}
interface CauseEntry {
  artist: string;
  wikiTitle: string;
  spikeYm: string;
  headline: string;
  causeLabel: string;
  chartForm: ChartForm;
  // timeline form only — two real dated facts (never a fabricated old
  // pageview number; the Wikipedia pageviews API has no data before 2015).
  fromYear?: string;
  fromLabel?: string;
  toLabel?: string;
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '').slice(0, 24) || 'post';
}

const PAGE_HEAD = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    img { display: block; }
  </style>
</helmet>
<div style="width:1080px;height:1350px;background:#F8F8F5;padding:96px 90px;font-family:'Noto Sans KR',sans-serif;display:flex;flex-direction:column;">
`;

const PAGE_FOOT = `
  <div style="display:flex;align-items:center;justify-content:center;">
    <img src="logo-flower.svg" style="width:56px;height:56px;opacity:0.9;">
  </div>
</div>
</x-dc>
</body>
</html>
`;

function headlineBlock(headline: string): string {
  return `  <div style="font-size:64px;font-weight:900;color:#1A1A18;line-height:1.28;max-width:900px;">${headline}</div>\n`;
}

// ── Form: line — the shape of the spike over time ──────────────────────────
function renderLine(series: { ym: string; views: number }[], spikeYm: string, causeLabel: string): string {
  const W = 900, H = 380;
  const views = series.map((s) => s.views);
  const min = Math.min(...views), max = Math.max(...views);
  const range = max - min || 1;
  const pts = series.map((s, i) => ({
    x: ((i / (series.length - 1)) * W).toFixed(1),
    y: (H - ((s.views - min) / range) * H).toFixed(1),
  }));
  const spikeIdx = series.findIndex((s) => s.ym === spikeYm);
  const peak = spikeIdx >= 0 ? pts[spikeIdx] : pts[0];
  const peakViews = spikeIdx >= 0 ? views[spikeIdx] : views[0];
  const startYear = series[0]?.ym.slice(0, 4) ?? '';
  const endYear = series[series.length - 1]?.ym.slice(0, 4) ?? '';
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  // Peak label sits above the line by default; if the spike is early in the
  // series there's no room above it for a two-line label, so flip it below.
  const labelBelow = Number(peak.x) < 120;
  const labelY1 = labelBelow ? Number(peak.y) + 34 : -40;
  const labelY2 = labelBelow ? Number(peak.y) + 56 : -18;

  return `  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:8px;">
    <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;color:#8C8C8A;font-weight:600;">월별 위키피디아 화제성 (조회수)</div>
    <svg viewBox="-20 -60 940 480" width="900" height="460" style="overflow:visible;">
      <line x1="0" y1="380" x2="900" y2="380" stroke="#E8E8E6" stroke-width="1"></line>
      <polyline points="${polyline}" fill="none" stroke="#2979B7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <circle cx="${peak.x}" cy="${peak.y}" r="7" fill="#2979B7"></circle>
      <text x="${peak.x}" y="${labelY1}" text-anchor="middle" font-family="'Plus Jakarta Sans',sans-serif" font-size="15" font-weight="700" fill="#1A1A18">${causeLabel}</text>
      <text x="${peak.x}" y="${labelY2}" text-anchor="middle" font-family="'Plus Jakarta Sans',sans-serif" font-size="15" font-weight="800" fill="#2979B7">${fmtViews(peakViews)}회</text>
      <text x="0" y="410" font-family="'Plus Jakarta Sans',sans-serif" font-size="13" fill="#8C8C8A">${startYear}</text>
      <text x="900" y="410" text-anchor="end" font-family="'Plus Jakarta Sans',sans-serif" font-size="13" fill="#8C8C8A">${endYear}</text>
    </svg>
  </div>
`;
}

// ── Form: bignum — the ratio itself is the hero, sparkline is support ──────
function renderBignum(series: { ym: string; views: number }[], spikeYm: string, ratio: number, causeLabel: string): string {
  const W = 700, H = 90;
  const views = series.map((s) => s.views);
  const min = Math.min(...views), max = Math.max(...views);
  const range = max - min || 1;
  const pts = series.map((s, i) => ({
    x: ((i / (series.length - 1)) * W).toFixed(1),
    y: (H - ((s.views - min) / range) * H).toFixed(1),
  }));
  const spikeIdx = series.findIndex((s) => s.ym === spikeYm);
  const peak = spikeIdx >= 0 ? pts[spikeIdx] : pts[0];
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const ratioLabel = Number.isInteger(ratio) ? `${ratio}` : ratio.toFixed(1);

  return `  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;">
    <div style="display:flex;align-items:baseline;gap:10px;">
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:220px;font-weight:800;color:#2979B7;line-height:1;">${ratioLabel}</div>
      <div style="font-size:56px;font-weight:900;color:#1A1A18;">배</div>
    </div>
    <div style="font-size:20px;color:#8C8C8A;font-weight:500;">평소 대비 화제성 상승률</div>
    <svg viewBox="-10 -10 720 110" width="700" height="110" style="overflow:visible;margin-top:8px;">
      <polyline points="${polyline}" fill="none" stroke="#E8E8E6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <circle cx="${peak.x}" cy="${peak.y}" r="6" fill="#2979B7"></circle>
      <text x="${peak.x}" y="${Number(peak.y) - 14}" text-anchor="middle" font-family="'Plus Jakarta Sans',sans-serif" font-size="14" font-weight="700" fill="#1A1A18">${causeLabel}</text>
    </svg>
  </div>
`;
}

// Korean convention for large counts: 만 (10,000) units above that threshold,
// plain comma-grouped digits below it — "12.9만" reads naturally, "12900" doesn't.
function fmtViews(n: number): string {
  if (n >= 10000) {
    const man = Math.round(n / 1000) / 10;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}만`;
  }
  return n.toLocaleString('ko-KR');
}

// ── Form: bars — plain before/after comparison ──────────────────────────────
function renderBars(spikeViews: number, baselineMedian: number, causeLabel: string, spikeYm: string): string {
  const maxH = 320;
  const ymLabel = `${spikeYm.slice(0, 4)}년 ${Number(spikeYm.slice(4, 6))}월`;
  const scale = maxH / Math.max(spikeViews, baselineMedian);
  const baseH = Math.round(baselineMedian * scale);
  const spikeH = Math.round(spikeViews * scale);

  return `  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:120px;">
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#8C8C8A;margin-bottom:14px;">${fmtViews(baselineMedian)}회</div>
        <div style="width:140px;height:${baseH}px;background:#E8E8E6;"></div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;color:#8C8C8A;font-weight:600;margin-top:16px;">평소</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;font-weight:700;color:#1A1A18;white-space:nowrap;margin-bottom:8px;">${causeLabel}</div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:#2979B7;margin-bottom:14px;">${fmtViews(spikeViews)}회</div>
        <div style="width:140px;height:${spikeH}px;background:#2979B7;"></div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;color:#1A1A18;font-weight:700;margin-top:16px;">${ymLabel}</div>
      </div>
    </div>
  </div>
`;
}

// ── Form: timeline — release year vs. a later real event, for "N years later" ──
// stories where the honest comparison is two dated facts, not a fabricated
// pageview number for a year Wikipedia has no traffic data for (the pageviews
// API only goes back to 2015).
function renderTimeline(fromYear: string, toYear: string, fromLabel: string, toLabel: string, ratio: number): string {
  const gapYears = Number(toYear) - Number(fromYear);
  const ratioLabel = Number.isInteger(ratio) ? `${ratio}` : ratio.toFixed(1);

  return `  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:56px;">
    <div style="display:flex;align-items:center;gap:36px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:72px;font-weight:900;color:#1A1A18;">${fromYear}</div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#8C8C8A;font-weight:600;">${fromLabel}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:170px;">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:15px;color:#2979B7;font-weight:700;white-space:nowrap;">${gapYears}년 후</div>
        <svg width="170" height="12" viewBox="0 0 170 12" style="overflow:visible;">
          <line x1="0" y1="6" x2="170" y2="6" stroke="#2979B7" stroke-width="2" stroke-dasharray="4 6"></line>
          <circle cx="170" cy="6" r="4" fill="#2979B7"></circle>
        </svg>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:72px;font-weight:900;color:#2979B7;">${toYear}</div>
        <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:18px;color:#1A1A18;font-weight:700;max-width:260px;text-align:center;">${toLabel}</div>
      </div>
    </div>
    <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:16px;color:#8C8C8A;">그 여파로 위키피디아 화제성 <span style="color:#2979B7;font-weight:800;">${ratioLabel}배</span> 상승</div>
  </div>
`;
}

function renderPoster(cause: CauseEntry, spike: SpikeCandidate): string {
  let chart: string;
  if (cause.chartForm === 'bignum') {
    chart = renderBignum(spike.series, spike.spikeYm, spike.ratio, cause.causeLabel);
  } else if (cause.chartForm === 'bars') {
    chart = renderBars(spike.spikeViews, spike.baselineMedian, cause.causeLabel, spike.spikeYm);
  } else if (cause.chartForm === 'timeline') {
    if (!cause.fromYear || !cause.fromLabel || !cause.toLabel) {
      throw new Error(`${cause.artist}: chartForm "timeline" needs fromYear/fromLabel/toLabel`);
    }
    const toYear = spike.spikeYm.slice(0, 4);
    chart = renderTimeline(cause.fromYear, toYear, cause.fromLabel, cause.toLabel, spike.ratio);
  } else {
    chart = renderLine(spike.series, spike.spikeYm, cause.causeLabel);
  }
  return PAGE_HEAD + headlineBlock(cause.headline) + chart + PAGE_FOOT;
}

function main() {
  if (!fs.existsSync(SPIKES_PATH) || !fs.existsSync(CAUSES_PATH)) {
    console.error('Missing input files. Run the detect-pageview-spikes.ts stage first.');
    process.exit(1);
  }
  const spikes: SpikeCandidate[] = JSON.parse(fs.readFileSync(SPIKES_PATH, 'utf8'));
  const causes: CauseEntry[] = JSON.parse(fs.readFileSync(CAUSES_PATH, 'utf8'));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let made = 0;
  const formCounts: Record<string, number> = {};

  for (const cause of causes) {
    const spike = spikes.find((s) => s.artist === cause.artist && s.spikeYm === cause.spikeYm);
    if (!spike) {
      console.log(`SKIP ${cause.artist} (${cause.spikeYm}) — no matching real spike in trend-spike-candidates.json`);
      continue;
    }
    const html = renderPoster(cause, spike);
    const file = `${slugify(cause.artist)}.dc.html`;
    fs.writeFileSync(path.join(OUT_DIR, file), html);
    console.log(`wrote ${file}  (${cause.artist}, ${cause.spikeYm}, ${spike.ratio}x, form=${cause.chartForm})`);
    formCounts[cause.chartForm] = (formCounts[cause.chartForm] ?? 0) + 1;
    made++;
  }

  console.log(`\n${made} poster(s) generated in ${OUT_DIR}`);
  console.log('chart form mix:', formCounts);
}

main();
