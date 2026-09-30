/**
 * Cover HEALTH audit — finds covers that are stored correctly but do not load, and repoints them.
 *
 * WHY THIS IS A SEPARATE AUDIT FROM audit-caa-covers.ts. That one asks "is this the RIGHT image?"
 * by comparing three sources perceptually. This one asks "does the image arrive at all?" Those fail
 * independently, and nothing covered the second: GAPFILL only fills a NULL cover_url
 * (`.is('cover_url', null)`), so a row whose cover is present but returns 500 forever is invisible
 * to every repair path we have. Reported case: Yorushika's "だから僕は音楽を辞めた" served a broken
 * coverartarchive URL for months while the row looked perfectly healthy in the database.
 *
 * TRANSIENT vs PERSISTENT is the whole problem. coverartarchive.org 307-redirects into
 * archive.org storage nodes that fail intermittently — the SAME url measured 200,500,500,500,500,500
 * across six attempts minutes apart. A single failed fetch therefore proves nothing, and repointing
 * on one would rewrite thousands of healthy rows. So a cover is only condemned after ATTEMPTS
 * consecutive failures spaced by a delay, which is the same reasoning app/api/img uses when it
 * retries three times before falling back.
 *
 * REPLACEMENT SOURCE: whichever of iTunes / Deezer answers for the same artist+title, iTunes first
 * (stable CDN paths at a requested size). No perceptual check is done here — this audit is about
 * reachability, and a reachable cover from a source that names the same album is strictly better
 * than one that returns nothing. Run audit-caa-covers.ts if you also want to know it is the right
 * picture.
 *
 * REPORT-ONLY unless --apply. Append-only in spirit: it only ever replaces a cover that failed
 * every attempt, and never touches a row whose cover loads.
 *
 *   npx tsx --env-file=.env.local scripts/audit-cover-health.ts --limit 200
 *   npx tsx --env-file=.env.local scripts/audit-cover-health.ts --limit 200 --host coverartarchive
 *   npx tsx --env-file=.env.local scripts/audit-cover-health.ts --limit 200 --apply
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { getDB } from './itunes-ingest-core';
import { searchAlbums } from './deezer-client';
import { searchAlbum as itunesSearchAlbum } from './itunes-client';

const argv = process.argv.slice(2);
const arg = (f: string, d?: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '200')!, 10);
const ATTEMPTS = parseInt(arg('--attempts', '3')!, 10);
const RETRY_MS = parseInt(arg('--retry-ms', '1500')!, 10);
const HOST = arg('--host', 'coverartarchive')!;   // substring match on cover_url; '' = every host
const APPLY = argv.includes('--apply');
const JSON_OUT = arg('--json', 'scripts/data/cover-health.json')!;

const db = getDB();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; title: string; artist_display: string; native_title: string | null; cover_url: string }

/** True when the url delivers an image. Follows redirects; a non-2xx or a throw both count as failure. */
async function loads(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'sillajuku-cover-health/1.0', Accept: 'image/*' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    // A 170-byte "image/jpeg" is archive.org's error body, not a cover.
    return buf.byteLength > 1024;
  } catch {
    return false;
  }
}

async function replacementFor(rg: Row): Promise<string | null> {
  const it = await itunesSearchAlbum(rg.title, rg.artist_display, null).catch(() => null);
  const itCover = it?.artworkUrl100 ? it.artworkUrl100.replace('100x100bb', '600x600bb') : null;
  if (itCover && await loads(itCover)) return itCover;
  const dz = await searchAlbums(rg.artist_display, rg.title, 5).catch(() => []);
  const dzCover = dz.find((h) => h.cover)?.cover ?? null;
  if (dzCover && await loads(dzCover)) return dzCover;
  return null;
}

async function main() {
  console.log(`\n  cover health — ${LIMIT} row(s), ${ATTEMPTS} attempts each${HOST ? `, host~${HOST}` : ''}${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);

  let q = db.from('release_groups')
    .select('id, title, artist_display, native_title, cover_url')
    .not('cover_url', 'is', null);
  if (HOST) q = q.like('cover_url', `%${HOST}%`);
  const { data, error } = await q.order('prestige_score', { ascending: false, nullsFirst: false }).limit(LIMIT);
  if (error) { console.error('DB error:', error.message); process.exit(1); }
  const rows = (data ?? []) as Row[];

  const broken: { id: string; artist: string; title: string; was: string; now: string | null }[] = [];
  let ok = 0, flaky = 0, unfixable = 0;

  for (let i = 0; i < rows.length; i++) {
    const rg = rows[i];
    const label = `  [${String(i + 1).padStart(4)}/${rows.length}] ${rg.artist_display.slice(0, 18).padEnd(18)} ${rg.title.slice(0, 26).padEnd(26)}`;
    let failures = 0;
    for (let a = 0; a < ATTEMPTS; a++) {
      if (await loads(rg.cover_url)) break;
      failures++;
      if (a < ATTEMPTS - 1) await sleep(RETRY_MS);
    }
    if (failures === 0) { ok++; continue; }
    if (failures < ATTEMPTS) { flaky++; console.log(`${label} flaky (${failures}/${ATTEMPTS} failed) — left alone`); continue; }

    const replacement = await replacementFor(rg);
    broken.push({ id: rg.id, artist: rg.artist_display, title: rg.title, was: rg.cover_url, now: replacement });
    if (!replacement) { unfixable++; console.log(`${label} DEAD, no replacement found`); continue; }
    console.log(`${label} DEAD -> ${replacement.slice(0, 48)}...`);
    if (APPLY) {
      const { error: upErr } = await db.from('release_groups')
        .update({ cover_url: replacement }).eq('id', rg.id).eq('cover_url', rg.cover_url);
      if (upErr) console.log(`      ! update failed: ${upErr.message}`);
    }
  }

  const fixable = broken.filter((b) => b.now).length;
  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  checked:            ${rows.length}`);
  console.log(`  loaded first try:   ${ok}`);
  console.log(`  flaky (recovered):  ${flaky}   <- transient; deliberately NOT rewritten`);
  console.log(`  dead:               ${broken.length}   (${fixable} replaceable, ${unfixable} with no source)`);
  if (APPLY) console.log(`  REPOINTED ${fixable} cover(s)`);

  try { mkdirSync(JSON_OUT.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  writeFileSync(JSON_OUT, JSON.stringify({ checked: rows.length, ok, flaky, broken }, null, 1));
  console.log(`  report -> ${JSON_OUT}`);
  console.log(APPLY ? '' : '  (report only - re-run with --apply to repoint dead covers)');
}

main().catch((e) => { console.error(e); process.exit(1); });
