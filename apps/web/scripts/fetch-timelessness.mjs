// Timelessness signal: for every item already resolved to a Wikipedia
// article (English or Korean), re-fetch the FULL monthly pageview series
// (not just the median, which is all that was kept before) over the longest
// window the API supports (pageview data starts July 2015), and compute a
// real "sustained vs. spiky" metric: the fraction of months where views are
// at least 25% of the all-time peak month. A true classic holds that
// threshold across most of its history; a one-hit-wonder/temporary-hype
// item spikes once and falls back near zero for the rest of the window.
import fs from 'fs';

const PAGEVIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const UA = 'sillajuku-timelessness/1.0 (admin@sillajuku.com)';
const POOL_ENRICHED = 'scripts/output/pool-enriched.json';
const KOREAN_RESOLVED = 'scripts/output/korean-wiki-resolved.json';
const HOLDOUT_SCORED_DIR = 'scripts/output';
const OUT_PATH = 'scripts/output/timelessness.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const EARLIEST = '2015070100'; // pageviews API start

async function fetchSeries(project, wikiTitle) {
  const article = encodeURIComponent(wikiTitle.replace(/ /g, '_'));
  const now = new Date();
  const excludeYm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const end = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}01`;
  const url = `${PAGEVIEWS_API}/${project}/all-access/user/${article}/monthly/${EARLIEST}/${end}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const j = await res.json();
  const items = (j.items ?? []).filter((it) => it.timestamp.slice(0, 6) !== excludeYm);
  return items.map((it) => it.views);
}

function timelessnessScore(views) {
  if (!views || views.length < 6) return null;
  // Use the SECOND-highest month as the reference "peak", not the absolute
  // max — a single one-time news spike (an artist's death, a major
  // anniversary) can dwarf every other month by 10-30x even for a genuinely
  // consistently-relevant figure. Verified live: David Bowie's peak month
  // (Jan 2016, his death) is 13x his second-highest month, even though his
  // real baseline the rest of the time is a very substantial 357K
  // views/month median — using the raw max made him score as the LEAST
  // timeless artist in the whole pool, which is absurd.
  const sorted = [...views].sort((a, b) => b - a);
  const referencePeak = sorted[1] ?? sorted[0];
  if (referencePeak <= 0) return null;
  const threshold = referencePeak * 0.25;
  const monthsAbove = views.filter((v) => v >= threshold).length;
  return monthsAbove / views.length;
}

async function main() {
  const enItems = JSON.parse(fs.readFileSync(POOL_ENRICHED, 'utf8')).filter((x) => x.wikiTitle);
  const koItems = JSON.parse(fs.readFileSync(KOREAN_RESOLVED, 'utf8')).filter((x) => x.wikiTitleKo);
  let holdoutEn = [];
  try {
    holdoutEn = JSON.parse(fs.readFileSync(`${HOLDOUT_SCORED_DIR}/holdout-scored.json`, 'utf8'))
      .filter((x) => x.wikiAlbumTitle)
      .map((x) => ({ id: 'holdout-' + x.id.replace('holdout-', ''), wikiTitle: x.wikiAlbumTitle }));
  } catch (e) { console.log('no holdout file found, skipping holdout timelessness'); }

  const targets = [
    ...enItems.map((x) => ({ id: x.id, project: 'en.wikipedia', title: x.wikiTitle })),
    ...koItems.map((x) => ({ id: x.id, project: 'ko.wikipedia', title: x.wikiTitleKo })),
    ...holdoutEn.map((x) => ({ id: x.id, project: 'en.wikipedia', title: x.wikiTitle })),
  ];
  console.log(`Fetching full pageview history for ${targets.length} resolved items...`);

  const out = [];
  let done = 0;
  for (const t of targets) {
    const views = await fetchSeries(t.project, t.title);
    const score = timelessnessScore(views);
    out.push({ id: t.id, project: t.project, wikiTitle: t.title, monthsOfData: views?.length ?? 0, timelessness: score, views });
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r${done}/${targets.length}`);
    }
    await sleep(150);
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nDone. ${out.filter((o) => o.timelessness != null).length}/${out.length} scored.`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
