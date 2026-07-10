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
 * This samples CAA-covered releases (prestige pool first — the most user-visible),
 * fetches the SAME album's cover from Deezer (an independent source), perceptually
 * hashes both, and flags pairs whose images are visually DIFFERENT (one is likely
 * wrong). It does NOT write anything — it produces a review worklist. Deciding which
 * source is correct, and repointing cover_url, is a human/follow-up call.
 *
 * Perceptual hash (jimp pHash + Hamming distance, 0 = identical … ~0.5 = unrelated):
 *   distance ≲ 0.15  → same image (resolution/compression differences only)
 *   distance ≳ 0.25  → likely a DIFFERENT image → FLAG for review
 */
import { Jimp, distance } from 'jimp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchAlbums } from './deezer-client';

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

async function readImage(url: string): Promise<Awaited<ReturnType<typeof Jimp.read>> | null> {
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

  const flagged: any[] = [];
  let agree = 0, noDeezer = 0, imgErr = 0;

  for (let i = 0; i < rows.length; i++) {
    const rg = rows[i];
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${rows.length}] ${rg.artist_display.slice(0, 20).padEnd(20)} ${rg.title.slice(0, 26).padEnd(26)} `);
    // Deezer cross-source cover for the same album.
    const hits = await searchAlbums(rg.artist_display, rg.title, 5);
    const hit = hits.find(h => overlap(h.artist, rg.artist_display) && (overlap(h.title, rg.title) || overlap(h.title, rg.native_title ?? '')));
    if (!hit?.cover) { noDeezer++; console.log('no deezer match'); continue; }

    const [caaImg, dzImg] = await Promise.all([readImage(rg.cover_url), readImage(hit.cover)]);
    if (!caaImg || !dzImg) { imgErr++; console.log('image fetch failed'); continue; }

    const d = distance(caaImg, dzImg); // 0 = identical, ~0.5 = unrelated
    if (d > THRESHOLD) {
      flagged.push({ id: rg.id, artist: rg.artist_display, title: rg.title, prestige: rg.prestige_score, distance: +d.toFixed(3), caa: rg.cover_url, deezer: hit.cover });
      console.log(`⚠ FLAG  d=${d.toFixed(3)}`);
    } else {
      agree++; console.log(`ok  d=${d.toFixed(3)}`);
    }
  }

  const checked = agree + flagged.length;
  console.log('\n  ── SUMMARY ─────────────────────────────────────────────');
  console.log(`  Sampled:               ${rows.length}`);
  console.log(`  Cross-checked (Deezer): ${checked}   (${noDeezer} no deezer match · ${imgErr} image errors)`);
  console.log(`  Agree (same cover):    ${agree}`);
  console.log(`  ►FLAGGED (different):  ${flagged.length}${checked ? `  (${(100 * flagged.length / checked).toFixed(1)}% of cross-checked)` : ''}`);
  if (flagged.length) {
    console.log('\n  FLAGGED — CAA vs Deezer disagree (review; higher distance = more different):');
    for (const f of [...flagged].sort((a, b) => b.distance - a.distance)) {
      console.log(`    d=${f.distance}  ${f.artist} — "${f.title}"`);
      console.log(`             CAA:    ${f.caa}`);
      console.log(`             Deezer: ${f.deezer}`);
    }
  }

  try { mkdirSync(JSON_OUT.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  writeFileSync(JSON_OUT, JSON.stringify({ threshold: THRESHOLD, sampled: rows.length, crossChecked: checked, agree, noDeezer, imgErr, flagged }, null, 2));
  console.log(`\n  Full report → ${JSON_OUT}`);
  console.log('  (READ-ONLY — flags for review; a human decides which source is correct before repointing cover_url.)\n');
}

main().catch(e => { console.error(e); process.exit(1); });
