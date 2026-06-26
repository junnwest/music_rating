/**
 * MB coverage gate (RENOVATION_PLAN §12.3) — READ-ONLY. No DB writes, no auth.
 * Validates the MB-primary bet on the real seed list before we build the full pipeline:
 *   - artist match rate (and ambiguous rate)
 *   - release-groups per matched artist
 *   - ISRC density (sampled on one representative release)
 *   - Cover Art Archive availability (sampled)
 * Broken down KR vs non-KR (Korean coverage is the make-or-break).
 *
 * Run:
 *   npx tsx scripts/mb-coverage-gate.ts                 # full seed list (~20 min @ 1 req/s)
 *   npx tsx scripts/mb-coverage-gate.ts --region=KR     # Korean subset only
 *   npx tsx scripts/mb-coverage-gate.ts --limit=40      # quick sample
 */

import { SEED, type SeedArtist } from './seed-artists';
import { resolveArtist } from './mb-ingest';
import { browseReleaseGroups, browseReleases, getReleaseTracks } from './mb-client';

const REGION = process.argv.find(a => a.startsWith('--region='))?.split('=')[1] ?? null;
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// Cover Art Archive availability (own host; HEAD, no body). Follows 307 → 200 if art exists.
async function hasCover(releaseGroupMbid: string): Promise<boolean> {
  try {
    const res = await fetch(`https://coverartarchive.org/release-group/${releaseGroupMbid}/front-250`, {
      method: 'HEAD', headers: { 'User-Agent': 'sillajuku/1.0 ( admin@sillajuku.com )' },
    });
    return res.ok;
  } catch { return false; }
}

interface Row {
  name: string; region: string | null;
  matched: boolean; ambiguous: boolean; needsReview: boolean; mbName?: string; disambig?: string | null;
  rgCount: number; isrcPct: number | null; cover: boolean | null;
}

async function probe(seed: SeedArtist): Promise<Row> {
  const { best, ambiguous, needsReview } = await resolveArtist(seed.name, seed.region);
  if (!best) return { name: seed.name, region: seed.region, matched: false, ambiguous: false, needsReview, rgCount: 0, isrcPct: null, cover: null };

  const rgs = await browseReleaseGroups(best.id);
  let isrcPct: number | null = null;
  let cover: boolean | null = null;

  // Sample one representative release-group (prefer an Album) for ISRC + cover.
  const sampleRg = rgs.find(r => (r.primaryType ?? '').toLowerCase() === 'album') ?? rgs[0];
  if (sampleRg) {
    cover = await hasCover(sampleRg.id);
    const releases = await browseReleases(sampleRg.id);
    const rep = releases.find(r => r.status === 'Official') ?? releases[0];
    if (rep) {
      const tracks = await getReleaseTracks(rep.id);
      if (tracks.length) isrcPct = Math.round(100 * tracks.filter(t => t.isrcs.length > 0).length / tracks.length);
    }
  }
  return {
    name: seed.name, region: seed.region, matched: true, ambiguous, needsReview: false,
    mbName: best.name, disambig: best.disambiguation, rgCount: rgs.length, isrcPct, cover,
  };
}

function summarize(label: string, rows: Row[]) {
  if (rows.length === 0) return;
  const matched = rows.filter(r => r.matched);
  const review = rows.filter(r => !r.matched && r.needsReview).length;
  const noMatch = rows.filter(r => !r.matched && !r.needsReview).length;
  const amb = matched.filter(r => r.ambiguous);
  const rgAvg = matched.length ? (matched.reduce((s, r) => s + r.rgCount, 0) / matched.length) : 0;
  const isrcVals = matched.map(r => r.isrcPct).filter((v): v is number => v != null);
  const isrcAvg = isrcVals.length ? Math.round(isrcVals.reduce((s, v) => s + v, 0) / isrcVals.length) : 0;
  const coverVals = matched.map(r => r.cover).filter((v): v is boolean => v != null);
  const coverPct = coverVals.length ? Math.round(100 * coverVals.filter(Boolean).length / coverVals.length) : 0;
  const thin = matched.filter(r => r.rgCount <= 2).length;
  console.log(`
  ── ${label} (${rows.length}) ──
    matched:        ${matched.length}/${rows.length} (${Math.round(100*matched.length/rows.length)}%)
    needs review:   ${review}
    no match:       ${noMatch}
    ambiguous:      ${amb.length}
    avg RG/artist:  ${rgAvg.toFixed(1)}
    thin (≤2 RG):   ${thin}
    avg ISRC %:     ${isrcAvg}%
    cover present:  ${coverPct}%`);
}

async function main() {
  const NAMES = process.argv.find(a => a.startsWith('--names='))?.split('=').slice(1).join('=');
  let list: SeedArtist[];
  if (NAMES) {
    list = NAMES.split(',').map(n => ({ name: n.trim(), region: REGION }));
  } else {
    list = SEED.filter(s => !REGION || s.region === REGION);
  }
  if (Number.isFinite(LIMIT)) list = list.slice(0, LIMIT);
  console.log(`\n  MB coverage gate — ${list.length} artists${REGION ? ` [region=${REGION}]` : ''} (read-only)\n`);

  const rows: Row[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = await probe(list[i]);
    rows.push(r);
    const tag = !r.matched
      ? (r.needsReview ? 'NEEDS REVIEW' : 'NO MATCH')
      : `${r.rgCount} RG, ISRC ${r.isrcPct ?? '-'}%, cover ${r.cover ? 'Y' : 'n'}${r.ambiguous ? ', AMBIG' : ''}`;
    console.log(`  [${i + 1}/${list.length}] ${r.name.padEnd(22)} → ${r.matched ? r.mbName : ''}${r.disambig ? ` (${r.disambig})` : ''}  ${tag}`);
    await sleep(50);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  summarize('ALL', rows);
  summarize('Korea', rows.filter(r => r.region === 'KR'));
  summarize('non-Korea', rows.filter(r => r.region !== 'KR'));
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => { console.error(e); process.exit(1); });
