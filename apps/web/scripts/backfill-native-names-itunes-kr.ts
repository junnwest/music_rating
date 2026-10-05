/**
 * Recover Korean artist names from the iTunes KR storefront.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-names-itunes-kr.ts --limit 200
 *   npx tsx --env-file=.env.local scripts/backfill-native-names-itunes-kr.ts --limit 200 --apply
 *
 * THE GAP. 5,849 of 14,844 KR-country artists have no `name_native`, so a Korean user searching
 * 컨츄리 꼬꼬 finds nothing while we hold the act as "Country Kkokko". Three backfills already chase
 * this — MusicBrainz aliases, Korean Wikipedia langlinks, Deezer — and none of them reads iTunes.
 *
 * WHY ITUNES WAS NEVER ASKED, despite being integrated. itunes-client.ts knows the KR storefront
 * (LANG_TO_STORES maps ko -> ['KR']), but that rotation exists for AVAILABILITY, not localization: its
 * own comment says "song lookups need the album to exist in the queried store". searchAlbum and
 * fetchAlbumTracks iterate [null, ...orderedStores(lang)] and return on the FIRST match — which is the
 * US store, which answers with the romanization. Same album id, two storefronts: US "Wavisabiroom",
 * KR "와비사비룸".
 *
 * KNOW WHAT THIS IS WORTH BEFORE RUNNING IT. Measured by audit-itunes-kr-storefront.ts: the yield is
 * ~8% (5 of 60 sampled), roughly 87 artists of the 1,040 that have an iTunes link and no native name.
 * That is a small, cheap win, not a solution to the 5,849 — most Korean acts are registered under a
 * Latin name in the KR storefront too. Anything bigger needs a source with real Korean long-tail
 * coverage; Discogs and Wikidata were both measured and rejected (see that script's header).
 *
 * TITLES ARE NOT IN SCOPE. The storefront localizes the ARTIST reliably; it localizes an ALBUM title
 * only when the label registered a Korean one, which for the long tail it usually did not. h3hyeon's
 * "A STORY GOES ON AND ON" reads identically in both storefronts even though Korean listeners know it
 * as 꼬리에 꼬리를 무는 이야기. Writing titles from this source would be guesswork.
 *
 * WHAT IT WRITES, and why both. `artist_aliases` is what the search RPC reads, so without a row there
 * the Korean name is still unsearchable; `artists.name_native` is what the UI displays. A name that is
 * searchable but not shown — or shown but not findable — is half a fix, so it does both, and only when
 * `name_native` is still null so an existing value is never overwritten.
 *
 * GUARDS: the KR answer must contain Hangul, must differ from the name we hold, and must not already
 * exist as an alias. Resumable via a state file; report-only unless --apply.
 */
import * as fs from 'node:fs';
import { getDB } from './itunes-ingest-core';

const argv = process.argv.slice(2);
const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '200'), 10);
const APPLY = argv.includes('--apply');
const STATE = arg('--state', 'scripts/data/itunes-kr-names.json');

const HANGUL = /[가-힣]/;
const normAlias = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const db = getDB();

function loadState(): Set<string> {
  try { return new Set<string>(JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch { return new Set(); }
}
function saveState(done: Set<string>) {
  try { fs.mkdirSync(STATE.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(STATE, JSON.stringify([...done]));
}

/** One KR-storefront lookup. Apple throttles hard; 403 is a rate signal, not a miss. */
async function lookupKR(itunesArtistId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${itunesArtistId}&country=KR`);
      if (r.status === 403) { await sleep(5000); continue; }
      if (!r.ok) return null;
      const d = await r.json() as { results?: { artistName?: string }[] };
      return d.results?.[0]?.artistName ?? null;
    } catch { await sleep(1500); }
  }
  return null;
}

async function main() {
  console.log(`\n  iTunes KR → Korean artist names  (limit ${LIMIT})${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);
  const done = loadState();

  const { data: rows, error } = await db
    .from('artist_external_ids')
    .select('artist_id, external_id, artists!inner(name, name_native, country)')
    .eq('source', 'itunes')
    .is('artists.name_native', null)
    .eq('artists.country', 'KR')
    .limit(LIMIT * 3);
  if (error) { console.error('DB error:', error.message); process.exit(1); }

  const todo = ((rows ?? []) as any[])
    .map(r => ({ id: r.artist_id as string, itunes: r.external_id as string, name: r.artists.name as string }))
    .filter(r => !done.has(r.id))
    .slice(0, LIMIT);
  console.log(`  ${todo.length} artist(s) to check\n`);

  let found = 0, wroteAlias = 0, wroteNative = 0, none = 0, processed = 0;
  for (const r of todo) {
    const krName = await lookupKR(r.itunes);
    await sleep(1200);
    processed++;

    // Only a Hangul answer that differs from what we hold is new information.
    if (!krName || !HANGUL.test(krName) || krName === r.name) { none++; done.add(r.id); continue; }
    found++;

    if (!APPLY) {
      if (found <= 25) console.log(`  ${r.name}  ->  ${krName}`);
      done.add(r.id);
      continue;
    }

    // Searchable (the RPC reads artist_aliases) …
    const { error: aliasErr } = await db.from('artist_aliases').insert({
      artist_id: r.id, alias: krName, alias_norm: normAlias(krName),
      script: 'Hang', primary_for_locale: false, source: 'itunes-kr',
    });
    if (!aliasErr) wroteAlias++;
    else if (!/duplicate|unique/i.test(aliasErr.message)) console.warn(`  ! alias ${r.name}: ${aliasErr.message}`);

    // … and displayed. Guarded on null so a value from a better source is never overwritten.
    const { error: nameErr } = await db.from('artists')
      .update({ name_native: krName }).eq('id', r.id).is('name_native', null);
    if (!nameErr) wroteNative++;
    else console.warn(`  ! name_native ${r.name}: ${nameErr.message}`);

    done.add(r.id);
    if (processed % 50 === 0) { saveState(done); console.log(`  ${processed}/${todo.length} — ${found} found`); }
  }
  if (APPLY) saveState(done);

  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  checked:            ${processed}`);
  console.log(`  Korean name found:  ${found}  (${processed ? Math.round((found / processed) * 100) : 0}%)`);
  console.log(`  no new information: ${none}`);
  if (APPLY) console.log(`  aliases written:    ${wroteAlias}\n  name_native set:    ${wroteNative}`);
  else console.log('  (report only — re-run with --apply to write)');
}

main().catch((e) => { console.error(e); process.exit(1); });
