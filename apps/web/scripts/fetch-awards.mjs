// Real award signal: for every item already resolved to an English Wikipedia
// article, fetch its categories and check for genuine award-winner category
// patterns (verified live: Lauryn Hill's Miseducation correctly shows
// "Grammy Award for Album of the Year" and "Grammy Award for Best R&B Album"
// among ~85 mostly-technical/maintenance categories — so this only counts as
// a hit after the same kind of targeted filtering, not "has a category
// mentioning an award show" which would also catch nominee/non-winner noise).
import fs from 'fs';

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'sillajuku-awards/1.0 (admin@sillajuku.com)';
const POOL_ENRICHED = 'scripts/output/pool-enriched.json';
const HOLDOUT_SCORED = 'scripts/output/holdout-scored.json';
const OUT_PATH = 'scripts/output/awards.json';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Deliberately "won/inducted" patterns, not "nominee" or generic award-show
// mentions — Wikipedia's own category convention separates
// "X Award for Y" (winner) from "X Award Y nominees" (not a win).
const AWARD_WIN_RE = /\b(Grammy Award for|Grammy Hall of Fame|Mercury Prize|Brit Award for|MTV Video Music Award for|American Music Award for|Billboard Music Award for|iHeartRadio Music Award for|Rock and Roll Hall of Fame|Mnet Asian Music Award for|Melon Music Award for|Golden Disc Award for|Seoul Music Award for|Circle Chart Music Award for)\b/i;
const NOT_WIN_RE = /nominee|nomination/i;

async function wikiGet(params, attempt = 0) {
  await sleep(280);
  const url = new URL(WIKI_API);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); return wikiGet(params, attempt + 1); }
  if (!res.ok) return null;
  return res.json();
}

async function fetchAwardCategories(wikiTitle) {
  const data = await wikiGet({ action: 'query', titles: wikiTitle, prop: 'categories', cllimit: '500' });
  const page = Object.values(data?.query?.pages ?? {})[0];
  const cats = (page?.categories ?? []).map((c) => c.title.replace('Category:', ''));
  const wins = cats.filter((c) => AWARD_WIN_RE.test(c) && !NOT_WIN_RE.test(c));
  return wins;
}

async function main() {
  const enItems = JSON.parse(fs.readFileSync(POOL_ENRICHED, 'utf8')).filter((x) => x.wikiTitle);
  let holdoutItems = [];
  try {
    holdoutItems = JSON.parse(fs.readFileSync(HOLDOUT_SCORED, 'utf8'))
      .filter((x) => x.wikiAlbumTitle)
      .map((x) => ({ id: x.id, wikiTitle: x.wikiAlbumTitle }));
  } catch (e) { console.log('no holdout file, skipping'); }

  const targets = [...enItems.map((x) => ({ id: x.id, wikiTitle: x.wikiTitle })), ...holdoutItems];
  console.log(`Checking award categories for ${targets.length} resolved items...`);

  const out = [];
  let done = 0, withAward = 0;
  for (const t of targets) {
    const wins = await fetchAwardCategories(t.wikiTitle);
    if (wins.length) withAward++;
    out.push({ id: t.id, wikiTitle: t.wikiTitle, awardCategories: wins });
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stdout.write(`\r${done}/${targets.length} (${withAward} with a real award-win category so far)`);
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nDone. ${withAward}/${out.length} have at least one real award-win category.`);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
