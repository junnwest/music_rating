/**
 * Stage 3 of the trend-post pipeline: pull real Wikipedia monthly pageview
 * history for each resolved artist and flag statistically real spikes — not
 * just "the highest month," which is meaningless noise for a flat series.
 * A spike is a month at least 2x the median of every OTHER month, computed
 * per-artist since baseline attention varies hugely by artist.
 *
 * The current calendar month is always excluded — it's partial and will
 * under-count no matter what, so it can never be a real signal.
 *
 * Input: scripts/output/trend-artists-wiki.json (from resolve-artist-wikipedia.ts)
 * Output: scripts/output/trend-spike-candidates.json — one entry per detected
 * spike, with the full monthly series attached (needed later for chart
 * rendering) and the spike's month/magnitude. This is a data-only output —
 * it makes no claim about WHY the spike happened. That's a separate,
 * human/LLM-reviewed research step, not something this script attempts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/detect-pageview-spikes.ts
 *   npx tsx --env-file=.env.local scripts/detect-pageview-spikes.ts --months=36
 */
import fs from 'fs';
import path from 'path';

const MONTHS_BACK = Number(process.argv.find((a) => a.startsWith('--months='))?.split('=')[1] ?? 30);
const SPIKE_RATIO = 2; // month must be >= this many times the median of other months
const MIN_ABSOLUTE_VIEWS = 500; // ignore spikes on artists too obscure for the ratio to mean anything

const IN_PATH = path.resolve('scripts/output/trend-artists-wiki.json');
const OUT_PATH = path.resolve('scripts/output/trend-spike-candidates.json');
const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ymRange(monthsBack: number): { start: string; end: string; excludeCurrentYm: string } {
  const now = new Date();
  const excludeCurrentYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
  return { start: fmt(startDate), end: fmt(now), excludeCurrentYm };
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchMonthly(wikiTitle: string): Promise<{ ym: string; views: number }[]> {
  const { start, end, excludeCurrentYm } = ymRange(MONTHS_BACK);
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_API}/en.wikipedia/all-access/user/${article}/monthly/${start}/${end}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-trend-pipeline/1.0 (admin@sillajuku.com)' } });
  if (!res.ok) return [];
  const j = await res.json();
  const items: { timestamp: string; views: number }[] = j.items ?? [];
  return items
    .map((it) => ({ ym: it.timestamp.slice(0, 6), views: it.views }))
    .filter((it) => it.ym !== excludeCurrentYm);
}

interface SpikeCandidate {
  artist: string;
  wikiTitle: string;
  spikeYm: string;
  spikeViews: number;
  baselineMedian: number;
  ratio: number;
  series: { ym: string; views: number }[];
}

async function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Missing ${IN_PATH} — run resolve-wikipedia-subject.ts first.`);
    process.exit(1);
  }
  const { resolved }: { resolved: { artist: string; wikiTitle: string }[] } = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));

  // Merge with whatever's already there instead of overwriting — this file
  // is a shared, cumulative pipeline output (artists + albums + genres all
  // land here), and a blind overwrite silently destroys every other subject
  // type's results the moment resolve-wikipedia-subject.ts's input only
  // contains one type (exactly what happened testing this pipeline: an
  // album/genre-only resolve run wiped every previously-detected artist
  // spike, because this script used to just replace the whole file).
  const existing: SpikeCandidate[] = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : [];
  // Keep existing spikes for anything NOT in this run's resolved list (other
  // subject types); everything IN this run's list gets freshly re-checked
  // below and re-added if it's still a real spike.
  const spikes: SpikeCandidate[] = existing.filter((s) => !resolved.some((r) => r.artist === s.artist && r.wikiTitle === s.wikiTitle));

  for (const { artist, wikiTitle } of resolved) {
    console.log(`\n${artist} (${wikiTitle})`);
    const series = await fetchMonthly(wikiTitle);
    if (series.length < 6) {
      console.log(`  too little history (${series.length} months), skipping`);
      await sleep(200);
      continue;
    }

    const views = series.map((s) => s.views);
    let bestIdx = -1;
    let bestRatio = 0;
    for (let i = 0; i < views.length; i++) {
      const others = views.filter((_, j) => j !== i);
      const baseline = median(others);
      if (baseline <= 0) continue;
      const ratio = views[i] / baseline;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestIdx = i;
      }
    }

    if (bestIdx === -1 || bestRatio < SPIKE_RATIO || views[bestIdx] < MIN_ABSOLUTE_VIEWS) {
      console.log(`  no real spike (best ratio ${bestRatio.toFixed(2)}x)`);
      continue;
    }

    const others = views.filter((_, j) => j !== bestIdx);
    const baselineMedian = median(others);
    console.log(`  SPIKE: ${series[bestIdx].ym} — ${views[bestIdx]} views (${bestRatio.toFixed(1)}x baseline median ${baselineMedian})`);
    spikes.push({
      artist,
      wikiTitle,
      spikeYm: series[bestIdx].ym,
      spikeViews: views[bestIdx],
      baselineMedian,
      ratio: Math.round(bestRatio * 10) / 10,
      series,
    });
    await sleep(200);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(spikes, null, 2));
  console.log(`\n${spikes.length} real spike candidate(s) found. Wrote ${OUT_PATH}`);
  console.log('Next step (not automated by design): research and verify WHY each spike happened before it becomes a headline.');
}

main();
