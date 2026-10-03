/**
 * MEASURE what the iTunes KR storefront would add, before anything is written.
 *
 *   npx tsx --env-file=.env.local scripts/audit-itunes-kr-storefront.ts --limit 120
 *
 * THE GAP THIS SIZES. 5,849 of 14,844 KR-country artists have no `name_native`, so a Korean user
 * searching 와비사비룸 or 우희준 finds nothing while we hold the artist under a romanization. Three
 * backfills already chase this (MusicBrainz aliases, Korean Wikipedia langlinks, Deezer) and none of
 * them reads iTunes.
 *
 * WHY ITUNES WAS NEVER ASKED, despite being integrated. itunes-client.ts DOES know the KR storefront -
 * LANG_TO_STORES maps ko -> ['KR'] - but that rotation exists for AVAILABILITY, not localization: its
 * own comment says "song lookups need the album to exist in the queried store". Both searchAlbum and
 * fetchAlbumTracks iterate [null, ...orderedStores(lang)] and return on the FIRST match, so a Korean
 * release that exists in the US store is found there and KR is never consulted - and the US storefront
 * answers with the romanization. Measured on one album id: US says "Wavisabiroom", KR says "와비사비룸".
 *
 * WHAT THIS DOES NOT FIX, and the reason this is an audit rather than a backfill. The storefront
 * localizes the ARTIST name reliably; it only localizes an ALBUM title when the label registered a
 * Korean one. h3hyeon's "A STORY GOES ON AND ON" reads identically in both storefronts even though its
 * Korean title (꼬리에 꼬리를 무는 이야기) is what Korean listeners know it by. So this measures the
 * artist-name yield honestly instead of assuming a title fix comes with it.
 *
 * REPORT ONLY. Writes nothing. Run it, read the yield, then decide whether a backfill is worth it.
 */
import { getDB } from './itunes-ingest-core';

const argv = process.argv.slice(2);
const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '120'), 10);

const db = getDB();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const hasHangul = (s: string) => /[가-힣]/.test(s ?? '');

interface Row { artist_id: string; external_id: string; name: string }

async function lookup(id: string, country: string): Promise<{ artistName?: string } | null> {
  // Apple throttles hard; one request per ~1.2s has been the sustainable rate for this project.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&country=${country}`);
      if (r.status === 403) { await sleep(5000); continue; }
      if (!r.ok) return null;
      const d = await r.json() as { results?: { artistName?: string }[] };
      return d.results?.[0] ?? null;
    } catch { await sleep(1500); }
  }
  return null;
}

async function main() {
  console.log(`\n  iTunes KR storefront — what would it add? (sample of ${LIMIT}, report only)\n`);

  // Artists we hold only under a romanization, that iTunes already knows about.
  const { data: rows, error: err } = await db
    .from('artist_external_ids')
    .select('artist_id, external_id, artists!inner(name, name_native, country)')
    .eq('source', 'itunes')
    .is('artists.name_native', null)
    .eq('artists.country', 'KR')
    .limit(LIMIT);
  if (err) { console.error('DB error:', err.message); process.exit(1); }

  const list = (rows ?? []).map((r: any) => ({ artist_id: r.artist_id, external_id: r.external_id, name: r.artists.name })) as Row[];
  console.log(`  ${list.length} KR artist(s) with an iTunes link and no native name\n`);

  let gained = 0, same = 0, missing = 0;
  const examples: string[] = [];
  for (const r of list) {
    const kr = await lookup(r.external_id, 'KR');
    await sleep(1200);
    if (!kr?.artistName) { missing++; continue; }
    if (hasHangul(kr.artistName) && kr.artistName !== r.name) {
      gained++;
      if (examples.length < 15) examples.push(`      ${r.name}  ->  ${kr.artistName}`);
    } else same++;
  }

  const checked = gained + same + missing;
  console.log('  ── RESULT ───────────────────────────');
  console.log(`  checked:                ${checked}`);
  console.log(`  would gain a Hangul name: ${gained}  (${checked ? Math.round((gained / checked) * 100) : 0}%)`);
  console.log(`  unchanged (already Latin in KR too): ${same}`);
  console.log(`  not in the KR store:    ${missing}`);
  if (examples.length) { console.log('\n  examples:'); for (const e of examples) console.log(e); }
  console.log(`\n  Extrapolated over the 1,040 KR artists with an iTunes link and no native name: ~${Math.round((gained / Math.max(1, checked)) * 1040)} recoverable.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
