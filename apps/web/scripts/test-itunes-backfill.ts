/**
 * DRY-RUN validation harness for the iTunes backfill lane (discover-itunes-backfill.ts).
 *
 * Runs scanArtistBackfill in report-only mode across a sample of owned artists and hunts for the
 * failure modes a whole-discography sweep is exposed to, so we can eyeball them BEFORE any live
 * ingest or pipeline wiring. Writes nothing to the catalog. Emits a JSON report to
 * scripts/output/backfill-test-<n>.json and an anomaly-focused console summary.
 *
 * Anomalies surfaced (each = "look here before trusting auto-ingest"):
 *   • ABORT (identity unconfirmed) — safe (nothing would ingest), but the rate tells us how often
 *     the overlap gate refuses to guess. High rate on real artists = gate too strict.
 *   • WRONG-ARTIST SUSPECT — identity confirmed yet would-ingest is huge vs the owned count
 *     (>3× owned AND >12). Could be a partial same-name match or a VA/feature-heavy entity.
 *   • BORDERLINE IDENTITY — overlap sits exactly at the floor. One coincidental title match from a
 *     wrong artist would pass; worth spot-checking.
 *   • SUSPECTS — near-date/different-title pairs (possible romanized-vs-Hangul same release). These
 *     are never auto-ingested, but a high count flags catalog rows worth a manual look.
 *
 *   npx tsx --env-file=.env.local scripts/test-itunes-backfill.ts --sample=20
 *   npx tsx --env-file=.env.local scripts/test-itunes-backfill.ts --artists="P-Type,Simon Dominic,Beenzino"
 *   npx tsx --env-file=.env.local scripts/test-itunes-backfill.ts --sample=20 --include-singles
 */
import * as fs from 'fs';
import * as path from 'path';
import { getDB } from './itunes-ingest-core';
import { scanArtistBackfill, type BackfillArtist, type BackfillResult } from './discover-itunes-backfill';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Row {
  name: string;
  ourCount: number;
  resolvedArtistId: number | null;
  identityConfirmed: boolean;
  overlap: number;
  wouldIngest: number;
  suspects: number;
  abortReason?: string;
  ingestTitles: string[];
  suspectTitles: string[];
  flags: string[];
}

function analyze(name: string, r: BackfillResult, minOverlap: number): Row {
  const ing = r.candidates.filter(c => c.decision === 'ingest');
  const sus = r.candidates.filter(c => c.decision === 'suspect');
  const flags: string[] = [];
  if (r.resolved && !r.identityConfirmed) flags.push('ABORT');
  if (r.identityConfirmed && ing.length > 12 && ing.length > r.ourCount * 3) flags.push('WRONG-ARTIST?');
  if (r.identityConfirmed && r.overlap === minOverlap) flags.push('BORDERLINE-ID');
  if (sus.length > 0) flags.push(`SUSPECT×${sus.length}`);
  if (!r.resolved) flags.push('UNRESOLVED');
  return {
    name, ourCount: r.ourCount, resolvedArtistId: r.resolvedArtistId,
    identityConfirmed: r.identityConfirmed, overlap: r.overlap,
    wouldIngest: ing.length, suspects: sus.length, abortReason: r.abortReason,
    ingestTitles: ing.map(c => `${c.date} ${c.classification} ${c.title}`),
    suspectTitles: sus.map(c => `${c.date} ${c.title} (${c.reason})`),
    flags,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const SAMPLE = arg('--sample') ? parseInt(arg('--sample')!, 10) : 15;
  const COUNTRY = arg('--country') ?? 'KR';
  const INCLUDE_SINGLES = args.includes('--include-singles');
  const NAMES = arg('--artists')?.split(',').map(s => s.trim()).filter(Boolean) ?? null;
  const minOverlap = 2;

  const db = getDB();
  let artists: BackfillArtist[];
  if (NAMES) {
    const out: BackfillArtist[] = [];
    for (const n of NAMES) {
      const { data } = await db.from('artists').select('id, name, name_native, native_language')
        .eq('ingest_state', 'tracks_done').ilike('name', n).limit(1);
      if (data?.[0]) out.push(data[0] as BackfillArtist);
      else console.log(`  (no tracks_done artist named "${n}")`);
    }
    artists = out;
  } else {
    // Sample: KR artists with ≥2 owned release-groups (identity gate needs overlap to work).
    // Spread across the id space by taking every k-th row for variety, not just the first N.
    const { data } = await db.from('artists').select('id, name, name_native, native_language')
      .eq('ingest_state', 'tracks_done').eq('country', COUNTRY).order('id').limit(SAMPLE * 6);
    const pool = (data ?? []) as BackfillArtist[];
    const step = Math.max(1, Math.floor(pool.length / SAMPLE));
    artists = pool.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  }

  if (!artists.length) { console.log('No artists to test.'); return; }
  console.log(`DRY-RUN validation — ${artists.length} artist(s), singles ${INCLUDE_SINGLES ? 'included' : 'excluded'}\n`);

  const rows: Row[] = [];
  let blocked = false;
  for (let i = 0; i < artists.length; i++) {
    const a = artists[i];
    process.stdout.write(`  [${i + 1}/${artists.length}] ${a.name.padEnd(28)} `);
    try {
      const r = await scanArtistBackfill(db, a, {
        ingest: false, includeSingles: INCLUDE_SINGLES, ingestSuspects: false, country: COUNTRY, minOverlap,
      });
      const row = analyze(a.name, r, minOverlap);
      rows.push(row);
      const idPart = r.identityConfirmed ? `ok ${r.overlap}/${r.ourCount}` : (r.resolved ? `ABORT (${r.overlap}/${r.ourCount})` : 'unresolved');
      console.log(`${idPart.padEnd(18)} ingest ${String(row.wouldIngest).padStart(2)} · suspect ${row.suspects} ${row.flags.length ? '‹' + row.flags.join(',') + '›' : ''}`);
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message.slice(0, 60)}`);
      rows.push({ name: a.name, ourCount: 0, resolvedArtistId: null, identityConfirmed: false, overlap: 0, wouldIngest: 0, suspects: 0, abortReason: 'exception', ingestTitles: [], suspectTitles: [], flags: ['EXCEPTION'] });
      if (/iTunes IP-block/i.test((e as Error).message)) { blocked = true; break; }
    }
    await sleep(300);
  }

  // ── Aggregate + anomaly report ────────────────────────────────────────────────
  const confirmed = rows.filter(r => r.identityConfirmed);
  const aborted = rows.filter(r => r.flags.includes('ABORT'));
  const wrongArtist = rows.filter(r => r.flags.includes('WRONG-ARTIST?'));
  const borderline = rows.filter(r => r.flags.includes('BORDERLINE-ID'));
  const withSuspects = rows.filter(r => r.suspects > 0);
  const totalIngest = rows.reduce((s, r) => s + r.wouldIngest, 0);
  const totalSuspect = rows.reduce((s, r) => s + r.suspects, 0);

  console.log(`\n═══════════════ ANOMALY REPORT ═══════════════`);
  console.log(`Tested: ${rows.length}${blocked ? ' (stopped early — iTunes IP-block)' : ''}`);
  console.log(`Identity confirmed: ${confirmed.length} · aborted (safe, no ingest): ${aborted.length}`);
  console.log(`Total would-ingest: ${totalIngest} albums/EPs${INCLUDE_SINGLES ? '+singles' : ''} · total suspects: ${totalSuspect}`);

  if (wrongArtist.length) {
    console.log(`\n⚠ WRONG-ARTIST SUSPECTS (${wrongArtist.length}) — huge ingest vs owned, verify identity:`);
    for (const r of wrongArtist) console.log(`   ${r.name}: owned ${r.ourCount}, would-ingest ${r.wouldIngest}, iTunes ${r.resolvedArtistId}`);
  }
  if (borderline.length) {
    console.log(`\n⚠ BORDERLINE IDENTITY (${borderline.length}) — overlap at the floor, spot-check:`);
    for (const r of borderline) console.log(`   ${r.name}: overlap ${r.overlap}/${r.ourCount}, would-ingest ${r.wouldIngest}`);
  }
  if (withSuspects.length) {
    console.log(`\n⚠ SUSPECTS (${withSuspects.length} artists) — near-date/different-title, never auto-ingested:`);
    for (const r of withSuspects) for (const t of r.suspectTitles) console.log(`   ${r.name}: ${t}`);
  }
  if (aborted.length) {
    console.log(`\n· ABORTS (${aborted.length}) — identity unconfirmed, nothing would ingest:`);
    for (const r of aborted) console.log(`   ${r.name}: ${r.abortReason}`);
  }

  console.log(`\n── would-ingest detail (confirmed artists) ──`);
  for (const r of confirmed.filter(r => r.wouldIngest > 0)) {
    console.log(`  ${r.name} (owned ${r.ourCount}, +${r.wouldIngest}):`);
    for (const t of r.ingestTitles) console.log(`      ➕ ${t}`);
  }

  const outDir = path.resolve('scripts/output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `backfill-test-${rows.length}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ testedAt: 'dry-run', country: COUNTRY, includeSingles: INCLUDE_SINGLES, rows }, null, 2));
  console.log(`\nFull JSON → ${outFile}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
