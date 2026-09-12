// Recomputes timelessness from the already-fetched raw monthly series
// (no re-fetching needed). v3 formula: reference "peak" = 90th percentile
// month, not the max or second-max — robust to a viral moment that spans
// several months (Kate Bush's 2022 Stranger Things resurgence: top TWO
// months alone were 1.68M and 968K against a genuinely healthy 91K median
// baseline, which still broke the "second-highest" version of this fix).
// A 90th-percentile reference needs ~10% of the entire multi-year history to
// be elevated before it counts as the "peak" reference, which a short viral
// spike can't dominate the way 1-2 months can.
import fs from 'fs';

const IN_PATH = 'scripts/output/timelessness.json';

function timelessnessScoreV3(views) {
  if (!views || views.length < 6) return null;
  const sorted = [...views].sort((a, b) => b - a);
  const p90Index = Math.max(1, Math.floor(sorted.length * 0.10));
  const referencePeak = sorted[p90Index];
  if (referencePeak <= 0) return null;
  const threshold = referencePeak * 0.25;
  const monthsAbove = views.filter((v) => v >= threshold).length;
  return monthsAbove / views.length;
}

const data = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
for (const item of data) {
  item.timelessnessV2 = item.timelessness; // keep the second-highest version for comparison
  item.timelessness = timelessnessScoreV3(item.views);
}
fs.writeFileSync(IN_PATH, JSON.stringify(data, null, 2));

const bowie = data.find((x) => x.wikiTitle === 'David Bowie');
const kb = data.find((x) => x.wikiTitle === 'Kate Bush');
console.log('David Bowie:', bowie.timelessness.toFixed(2), '(was', bowie.timelessnessV2.toFixed(2), ')');
console.log('Kate Bush:', kb.timelessness.toFixed(2), '(was', kb.timelessnessV2.toFixed(2), ')');

const sorted = [...data].filter((x) => x.timelessness != null).sort((a, b) => b.timelessness - a.timelessness);
console.log('most timeless:', sorted.slice(0, 8).map((x) => `${x.wikiTitle} (${x.timelessness.toFixed(2)})`));
console.log('least timeless:', sorted.slice(-8).map((x) => `${x.wikiTitle} (${x.timelessness.toFixed(2)})`));
