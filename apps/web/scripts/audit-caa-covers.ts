/**
 * Cover Art Archive (CAA) cover QC audit.  READ-ONLY.
 *
 *   npx tsx --env-file=.env.local scripts/audit-caa-covers.ts [--limit N] [--threshold 0.25]
 *                                                             [--all] [--json path]
 *
 * WHY: ~231k of ~295k release-group covers come from Cover Art Archive, and CAA's
 * single "community-approved" image is trusted unconditionally — but at least one
 * confirmed case (YANGHONGWON / 오보에) had a completely unrelated image ship as the
 * canonical cover. Nothing cross-checks CAA against another source.
 *
 * This samples CAA-covered releases (prestige pool first — the most user-visible)
 * and cross-checks each against TWO independent sources (Deezer + iTunes), because
 * a single source can't tell a WRONG cover from a merely DIFFERENT EDITION: famous
 * albums have many editions (remaster/deluxe/regional) with different art, so a lone
 * Deezer mismatch is usually just a different edition, not an error (v1 of this tool
 * over-flagged canonical albums for exactly this reason). So we flag CAA as the
 * likely-wrong outlier ONLY when Deezer and iTunes agree WITH EACH OTHER but both
 * disagree with CAA. When the two sources disagree with each other, it's edition
 * variance → inconclusive, not flagged. READ-ONLY — produces a review worklist;
 * which source is correct and whether to repoint cover_url is a human call.
 *
 * Perceptual hash (jimp pHash + Hamming distance, 0 = identical … ~0.5 = unrelated):
 *   distance ≲ THRESHOLD → "agree" (same artwork, resolution/compression aside)
 *   CAA flagged only when dist(Deezer,iTunes) ≤ THRESHOLD AND both CAA distances > THRESHOLD
 *
 * INTERPRETING THE FLAG DISTANCE (learned from the 2026-07-10 prestige run):
 *   ~0.25–0.45  → usually a DIFFERENT EDITION, not a wrong cover — CAA often has the
 *                 original pressing while Deezer+iTunes both serve the modern remaster,
 *                 so they coincidentally agree and CAA looks like the outlier. Review,
 *                 but do NOT assume CAA is wrong (a prestige run flagged 7 iconic albums
 *                 here — Kind of Blue, Born to Run, MBDTF — all correct, just older art).
 *   ≳ 0.45      → near-random → the images are genuinely UNRELATED → likely a real CAA
 *                 error (the YANGHONGWON/오보에 class). This is the actionable signal.
 *   Raise --threshold to ~0.45 to hunt only genuine errors; keep 0.25 to also survey
 *   edition inconsistency. Either way this NEVER auto-repoints — a human confirms.
 */
import { Jimp, distance } from 'jimp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchAlbums } from './deezer-client';
import { searchAlbum as itunesSearchAlbum } from './itunes-client';

const argv = process.argv.slice(2);
const arg = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '80')!, 10);
const THRESHOLD = parseFloat(arg('--threshold', '0.25')!);
const ALL = argv.includes('--all'); // sample all CAA covers, not just prestige
const JSON_OUT = arg('--json', 'scripts/output/caa-cover-audit.json')!;

const db = getDB();

function normLoose(s: string): string { return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function overlap(a: string, b: string): boolean {
  const x = normLoose(a), y = normLoose(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

async function readImage(url: string): Promise<InstanceType<typeof Jimp> | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-cover-qc/1.0' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await Jimp.read(buf);
  } catch { return null; }
}

interface RgRow { id: string; title: string; artist_display: string; native_title: string | null; cover_url: string; prestige_score: number | null; }

async function main() {
  console.log(`\n  CAA cover QC — sampling ${ALL ? 'ALL' : 'prestige'} CAA-covered releases (limit ${LIMIT}), flag distance > ${THRESHOLD}\n`);

  // Prestige-first sample (most user-visible). CAA URLs are coverartarchive.org / archive.org.
  let q = db.from('release_groups')
    .select('id, title, artist_display, native_title, cover_url, prestige_score')
    .or('cover_url.ilike.%coverartarchive%,cover_url.ilike.%archive.org%')
    .in('release_group_type', ['album', 'ep']);
  q = ALL ? q.limit(LIMIT) : q.gt('prestige_score', 0).order('prestige_score', { ascending: false }).limit(LIMIT);
  const { data, error } = await q;
  if (error) { console.error('DB error:', error.message); process.exit(1); }
  const rows = (data ?? []) as RgRow[];
  console.log(`  ${rows.length} releases to check\n`);

  const flagged: any[] = [];       // CAA is the outlier — Deezer≈iTunes but both differ from CAA
  const inconclusive: any[] = [];  // the two sources disagree with each other → edition variance
  let agree = 0, insufficient = 0, imgErr = 0;

  for (let i = 0; i < rows.length; i++) {
    const rg = rows[i];
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${rows.length}] ${rg.artist_display.slice(0, 18).padEnd(18)} ${rg.title.slice(0, 24).padEnd(24)} `);
    // Two INDEPENDENT cross-source covers for the same album.
    const dzHits = await searchAlbums(rg.artist_display, rg.title, 5);
    const dzHit = dzHits.find(h => overlap(h.artist, rg.artist_display) && (overlap(h.title, rg.title) || overlap(h.title, rg.native_title ?? '')));
    const itAlbum = await itunesSearchAlbum(rg.title, rg.artist_display, null);
    const itCover = itAlbum?.artworkUrl100 ? itAlbum.artworkUrl100.replace('100x100bb', '600x600bb') : null;
    if (!dzHit?.cover || !itCover) { insufficient++; console.log('need 2 sources — skip'); continue; }

    const [caaImg, dzImg, itImg] = await Promise.all([readImage(rg.cover_url), readImage(dzHit.cover), readImage(itCover)]);
    if (!caaImg || !dzImg || !itImg) { imgErr++; console.log('image fetch failed'); continue; }

    const dCaaDz = distance(caaImg, dzImg), dCaaIt = distance(caaImg, itImg), dDzIt = distance(dzImg, itImg);
    if (dDzIt > THRESHOLD) {
      // Independent sources disagree with EACH OTHER → edition variance; can't isolate CAA.
      inconclusive.push({ id: rg.id, artist: rg.artist_display, title: rg.title, dCaaDz: +dCaaDz.toFixed(3), dCaaIt: +dCaaIt.toFixed(3), dDzIt: +dDzIt.toFixed(3) });
      console.log(`~ sources differ (dz≁it=${dDzIt.toFixed(2)})`);
    } else if (dCaaDz > THRESHOLD && dCaaIt > THRESHOLD) {
      // Deezer≈iTunes yet both differ from CAA → CAA is the outlier → likely wrong.
      flagged.push({ id: rg.id, artist: rg.artist_display, title: rg.title, prestige: rg.prestige_score, dCaaDz: +dCaaDz.toFixed(3), dCaaIt: +dCaaIt.toFixed(3), caa: rg.cover_url, deezer: dzHit.cover, itunes: itCover });
      console.log(`⚠ CAA OUTLIER  caa≁dz=${dCaaDz.toFixed(2)} caa≁it=${dCaaIt.toFixed(2)}`);
    } else {
      agree++; console.log('ok');
    }
  }

  const checked = agree + flagged.length + inconclusive.length;
  console.log('\n  ── SUMMARY ─────────────────────────────────────────────');
  console.log(`  Sampled:                  ${rows.length}`);
  console.log(`  Cross-checked (2 sources): ${checked}   (${insufficient} lacked 2 sources · ${imgErr} image errors)`);
  console.log(`  All 3 agree:              ${agree}`);
  console.log(`  Edition variance (dz≠it): ${inconclusive.length}  (not flagged — can't tell wrong-cover from different-edition)`);
  console.log(`  ►CAA OUTLIER (likely wrong): ${flagged.length}${checked ? `  (${(100 * flagged.length / checked).toFixed(1)}% of cross-checked)` : ''}`);
  if (flagged.length) {
    console.log('\n  CAA OUTLIERS — Deezer & iTunes agree, CAA differs from both (review these):');
    for (const f of [...flagged].sort((a, b) => (b.dCaaDz + b.dCaaIt) - (a.dCaaDz + a.dCaaIt))) {
      console.log(`    caa≁dz=${f.dCaaDz} caa≁it=${f.dCaaIt}  ${f.artist} — "${f.title}"`);
      console.log(`             CAA:    ${f.caa}`);
      console.log(`             Deezer: ${f.deezer}`);
      console.log(`             iTunes: ${f.itunes}`);
    }
  }

  try { mkdirSync(JSON_OUT.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  writeFileSync(JSON_OUT, JSON.stringify({ threshold: THRESHOLD, sampled: rows.length, crossChecked: checked, agree, editionVariance: inconclusive.length, insufficient, imgErr, flagged, inconclusive }, null, 2));
  console.log(`\n  Full report → ${JSON_OUT}`);
  console.log('  (READ-ONLY — CAA outliers are cross-verified by 2 independent sources; a human confirms before repointing cover_url.)\n');
}

main().catch(e => { console.error(e); process.exit(1); });
