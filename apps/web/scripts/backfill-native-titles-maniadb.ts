/**
 * Backfill release_groups.native_title from ManiaDB — the Korean long tail nothing else reaches.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-maniadb.ts --limit 50
 *   npx tsx --env-file=.env.local scripts/backfill-native-titles-maniadb.ts --limit 50 --apply
 *
 * WHY THIS SOURCE, after four others were measured and rejected. 42,770 of 49,465 release groups by KR
 * artists have no Korean title. MusicBrainz carries no alias for them, Deezer and iTunes hold them under
 * the romanized title, Discogs skews to physical releases (~0% yield on a 29-artist probe), and Wikidata
 * has 949 Korean-labelled albums in total. ManiaDB has the digital long tail: h3hyeon's
 * "A STORY GOES ON AND ON" is there as 꼬리에 꼬리를 무는 이야기, with the right release date, when no
 * other source knew the Korean title existed.
 *
 * KOREAN-INDEXED ONLY, which dictates the whole design. Searching "A STORY GOES ON AND ON" returns
 * total=0; searching 황세현 returns the artist's ten albums with dates. So this CANNOT bootstrap from a
 * romanized catalogue — it chains off `artists.name_native`. Every Korean artist name recovered by the
 * iTunes-KR and alias-promotion backfills unlocks that artist's entire discography here, which is why
 * those run first and this one second.
 *
 * MATCHING IS BY DATE WITHIN ONE RESOLVED ARTIST, the method backfill-native-titles-deezer.ts already
 * proved: our title is romanized and theirs is Korean, so the two strings cannot be compared at all.
 * Guards, in the order they reject:
 *   1. the artist must have a Korean name here (it is the search key)
 *   2. ManiaDB's release_title must start with exactly that Korean name + " - "
 *   3. release dates must match to the day
 *   4. exactly ONE of their albums may match that date — two is ambiguous, so the album is skipped
 *   5. the extracted title must contain Hangul and differ from what we hold
 * Nothing is written where native_title is already set.
 *
 * AN EMPTY RESPONSE IS NOT A MISS. ManiaDB throttles hard: a few quick requests and it answers 403 or
 * an empty body, recovering after a pause. Treating that as "no Korean title" would silently write off
 * thousands of albums that do have one, so a blank answer is retried and then left for the next run —
 * the artist is never marked done on a throttle. HTTPS and a browser User-Agent are required; plain
 * HTTP answers 403 whatever the key.
 *
 * PERMISSION AND CREDIT. ManiaDB's terms require contact before commercial use ("상업적 사용의 경우
 * 이메일로 연락 바랍니다"); sillajuku asked and was granted use. The data is CCL-licensed, so attribution
 * obligations travel with it, and ManiaDB notes its own content is part-crawled and may be withdrawn
 * without notice — `source` is recorded on every write so anything from here can be found and removed.
 */
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDB } from './itunes-ingest-core';

const argv = process.argv.slice(2);
const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIMIT = parseInt(arg('--limit', '50'), 10);
const APPLY = argv.includes('--apply');
const KEY = process.env.MANIADB_KEY ?? arg('--key', '');
const STATE = arg('--state', 'scripts/data/maniadb-titles.json');
const GAP_MS = parseInt(arg('--gap', '2500'), 10);
// --artist <uuid> fixes one reported artist instead of sweeping. The full pass is ~34 hours at
// ManiaDB's speed, which is the wrong tool for "염따's 살아숨셔 series has no Korean title".
const ONLY_ARTIST = arg('--artist', '');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HANGUL = /[가-힣]/;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const exec = promisify(execFile);
const db = getDB();

if (!KEY) { console.error('Set MANIADB_KEY (the registered contact address) or pass --key'); process.exit(1); }

const loadState = (): Set<string> => { try { return new Set(JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch { return new Set(); } };
const saveState = (d: Set<string>) => {
  try { fs.mkdirSync(STATE.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* exists */ }
  fs.writeFileSync(STATE, JSON.stringify([...d]));
};

const cdata = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
const pick = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? cdata(m[1]) : null;
};

interface MdbAlbum { id: string; title: string; date: string }

/** One artist's albums. `null` means "could not tell" (throttled) — never "none". */
async function albumsFor(koreanName: string): Promise<MdbAlbum[] | null> {
  const url = `https://www.maniadb.com/api/search/${encodeURIComponent(koreanName)}/`
    + `?sr=album&display=100&key=${encodeURIComponent(KEY)}&v=0.5`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      /* CURL, NOT fetch(). Same URL and same User-Agent: curl gets 200, node's fetch gets 403. The WAF
         fingerprints the client below the header level - undici's TLS signature and header order give
         it away - so no combination of headers makes fetch() work here. */
      const { stdout } = await exec('curl', ['-s', '-L', '--max-time', '30', '-A', UA, url], { maxBuffer: 8 << 20 });
      const body = stdout ?? '';
      if (!body.includes('<channel>')) { await sleep(6000 * (attempt + 1)); continue; }
      const total = Number(pick(body, 'total') ?? '0');
      if (!total) return [];                       // a real, parseable "no albums"
      const items = body.split(/<item\b/).slice(1);
      const out: MdbAlbum[] = [];
      for (const raw of items) {
        const id = raw.match(/^[^>]*id="(\d+)"/)?.[1] ?? '';
        const title = pick(raw, 'release_title') ?? pick(raw, 'title');
        const date = (pick(raw, 'release_date') ?? pick(raw, 'release') ?? '').replace(/\D/g, '');
        // ManiaDB zero-fills unknown precision: 19980000 is "sometime in 1998". Those can never be
        // matched to the day, and matching on the year alone would pair the wrong album whenever an
        // artist released twice in a year - which is common. Dropped rather than guessed.
        const precise = date.length === 8 && !date.endsWith('0000') && date.slice(4, 6) !== '00' && date.slice(6, 8) !== '00';
        if (id && title && precise) out.push({ id, title, date });
      }
      return out;
    } catch { await sleep(4000); }
  }
  return null;                                      // throttled or unreachable: try again next run
}

/** "황세현 - 꼬리에 꼬리를 무는 이야기" -> the album half, but only for this exact artist. */
function albumTitleFor(releaseTitle: string, koreanArtist: string): string | null {
  const prefix = `${koreanArtist} - `;
  if (!releaseTitle.startsWith(prefix)) return null;   // a different artist's record; do not guess
  let rest = releaseTitle.slice(prefix.length).trim();
  /* Strip ManiaDB's cataloguing annotations. Their titles carry format tags the catalogue must not
     inherit - a dry run proposed 거울 [digital single] and 어쌔신 더 비기닝 / digital single
     [digital single] as album names. Removed: a trailing "(2021, Label)", any trailing [..] tag, and a
     "/ digital single"-style format note. */
  rest = rest.replace(/\s*\((?:19|20)\d{2}[^)]*\)\s*$/, '');
  for (let i = 0; i < 3; i++) rest = rest.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  rest = rest.replace(/\s*\/\s*(digital\s+single|single|ep|album|mini\s*album)\s*$/i, '').trim();
  return rest || null;
}

async function main() {
  console.log(`\n  ManiaDB → Korean album titles  (limit ${LIMIT})${APPLY ? '  *** APPLY ***' : '  (report only)'}\n`);
  const done = loadState();

  // Only artists we can search for: ManiaDB is Korean-indexed, so name_native IS the key.
  // PostgREST caps a response at 1,000 rows, so this pages. Without it a --limit above 1,000 silently
  // fetched the same first page forever and the other ~8,000 artists were unreachable.
  const artists: any[] = [];
  for (let from = 0; from < 40000; from += 1000) {
    const { data, error } = await db
      .from('artists')
      .select('id, name, name_native')
      .eq('country', 'KR')
      .not('name_native', 'is', null)
      .range(from, from + 999);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data?.length) break;
    artists.push(...data);
    if (data.length < 1000) break;
  }

  const todo = artists
    .filter((a: any) => (ONLY_ARTIST ? a.id === ONLY_ARTIST : !done.has(a.id)) && HANGUL.test(a.name_native ?? ''))
    .slice(0, LIMIT);
  console.log(`  ${todo.length} artist(s) to check\n`);

  let matched = 0, written = 0, throttled = 0, noAlbums = 0, ambiguous = 0;
  let n = 0;
  for (const a of todo as any[]) {
    // Printed per artist: with back-off this can idle for half a minute, which otherwise reads as a hang.
    process.stdout.write(`  [${++n}/${todo.length}] ${a.name_native} … `);
    const theirs = await albumsFor(a.name_native);
    console.log(theirs === null ? 'throttled' : `${theirs.length} album(s)`);
    await sleep(GAP_MS);
    if (theirs === null) { throttled++; continue; }          // deliberately NOT added to `done`
    if (!theirs.length) { noAlbums++; done.add(a.id); continue; }

    const { data: ours } = await db
      .from('release_groups')
      .select('id, title, native_title, first_release_date')
      .eq('primary_artist_id', a.id)
      .is('native_title', null)
      .not('first_release_date', 'is', null);

    // How many of OUR releases sit on each day, so a one-to-one match can be insisted on.
    const ourDates = new Map<string, number>();
    for (const rg of (ours ?? []) as any[]) {
      const d = String(rg.first_release_date).replace(/\D/g, '').slice(0, 8);
      if (d.length === 8) ourDates.set(d, (ourDates.get(d) ?? 0) + 1);
    }
    const usedTheirs = new Set<string>();

    for (const rg of (ours ?? []) as any[]) {
      const ymd = String(rg.first_release_date).replace(/\D/g, '').slice(0, 8);
      if (ymd.length !== 8) continue;
      // Already Korean: there is nothing a native_title would add, and writing one risks replacing a
      // good title with ManiaDB's differently-punctuated version of the same thing.
      if (HANGUL.test(rg.title ?? '')) continue;
      // Our side must be unambiguous too: two of our releases on one day cannot both be the single
      // ManiaDB record. A dry run matched one 거울 to both "MIRROR" and "Mirror (feat. …)" - the same
      // Korean title written onto two different albums, one of them necessarily wrong.
      if (ourDates.get(ymd) !== 1) { if ((ourDates.get(ymd) ?? 0) > 1) ambiguous++; continue; }
      const sameDay = theirs.filter(t => t.date === ymd);
      if (sameDay.length !== 1) { if (sameDay.length > 1) ambiguous++; continue; }
      // A ManiaDB record may be spent once. Belt and braces alongside the check above.
      if (usedTheirs.has(sameDay[0].id)) { ambiguous++; continue; }
      const korean = albumTitleFor(sameDay[0].title, a.name_native);
      if (!korean || !HANGUL.test(korean) || korean === rg.title) continue;
      usedTheirs.add(sameDay[0].id);

      matched++;
      if (!APPLY) { if (matched <= 25) console.log(`  ${a.name} — "${rg.title}"  ->  "${korean}"  (${ymd})`); continue; }
      const { error: e } = await db.from('release_groups')
        .update({ native_title: korean }).eq('id', rg.id).is('native_title', null);
      if (e) console.warn(`  ! ${rg.title}: ${e.message}`); else written++;
    }
    done.add(a.id);
    if (APPLY) saveState(done);
  }
  if (APPLY) saveState(done);

  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  artists checked:      ${todo.length - throttled}`);
  console.log(`  titles matched:       ${matched}`);
  if (APPLY) console.log(`  native_title written: ${written}`);
  console.log(`  artist not in ManiaDB:${noAlbums}`);
  console.log(`  ambiguous (same date):${ambiguous}`);
  if (throttled) console.log(`  throttled, left for the next run: ${throttled}`);
  if (!APPLY) console.log('\n  (report only — re-run with --apply to write)');
}

main().catch((e) => { console.error(e); process.exit(1); });
