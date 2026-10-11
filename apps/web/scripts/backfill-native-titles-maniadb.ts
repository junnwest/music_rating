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
/* A COUNT IS NOT A RECORD. The first full sweep reported "ambiguous (same date): 1476" and kept no
   list, so the follow-up could not be targeted or resumed -- the candidates had to be reconstructed
   with SQL, and the per-artist detail (which ManiaDB rows collided) was gone for good. Skipped work
   is written out now, so a later pass can pick it up directly. */
const AMBIG_REPORT = arg('--ambiguous-out', 'scripts/data/maniadb-ambiguous.json');
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

interface MdbAlbum { id: string; title: string; date: string; image: string | null; tracks: number | null }

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
        const image = pick(raw, 'image');
        // track_count is what breaks a same-date tie; absent or 0 means "cannot tell", never "zero".
        const tc = Number(pick(raw, 'track_count') ?? '');
        const tracks = Number.isFinite(tc) && tc > 0 ? tc : null;
        if (id && title && precise) out.push({ id, title, date, image: image || null, tracks });
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

  let matched = 0, written = 0, throttled = 0, noAlbums = 0, ambiguous = 0, covers = 0, brokenByTracks = 0, idsSaved = 0;
  const ambiguousRows: { artist: string; artist_id: string; rg_id: string; our_title: string; date: string; candidates: { id: string; title: string; tracks: number | null }[]; reason: string }[] = [];
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
      .select('id, title, native_title, cover_url, first_release_date, maniadb_album_id')
      .eq('primary_artist_id', a.id)
      .or('native_title.is.null,cover_url.is.null')
      .not('first_release_date', 'is', null);

    // How many of OUR releases sit on each day, so a one-to-one match can be insisted on.
    const ourDates = new Map<string, number>();
    for (const rg of (ours ?? []) as any[]) {
      const d = String(rg.first_release_date).replace(/\D/g, '').slice(0, 8);
      if (d.length === 8) ourDates.set(d, (ourDates.get(d) ?? 0) + 1);
    }
    const usedTheirs = new Set<string>();

    /* OUR TRACK COUNT PER RELEASE GROUP — the second axis for a same-date tie.
       Date alone left 1,476 albums unmatched in the first full sweep: an idol act putting out two
       singles on one day is ordinary, and the run could not tell which Korean title belonged to
       which. ManiaDB ships <track_count>, so a 1-track single and a 12-track album on the same
       date are separable. A few DB reads per artist against ManiaDB's ~15s per artist is free.

       READ release_tracks, NOT tracks. The `tracks` table exists in the schema and is EMPTY — 0 rows
       against 837,310 release groups — so the first version of this silently computed nothing and
       broke zero ties while looking like it worked. Tracklists live in release_tracks (7.65M rows),
       joined release_id -> releases.release_group_id, which is the path dedup-by-duration.ts uses.

       MAX ACROSS EDITIONS, NOT SUM. A release group can hold several releases (original, reissue,
       deluxe); summing them would report a 12-track album as 36 tracks and never match anything. */
    const ourTracks = new Map<string, number>();
    {
      const rgIds = ((ours ?? []) as any[]).map(r => r.id);
      if (rgIds.length) {
        const { data: rels } = await db.from('releases').select('id, release_group_id').in('release_group_id', rgIds);
        const relToRg = new Map<string, string>();
        for (const r of (rels ?? []) as any[]) relToRg.set(r.id, r.release_group_id);
        const relIds = [...relToRg.keys()];
        const perRelease = new Map<string, number>();
        // Small chunks plus range paging: 7.65M rows and a 1,000-row cap mean a box set can fill a
        // page on its own, and a truncated page would understate a count and mispair a title.
        for (let i = 0; i < relIds.length; i += 40) {
          const chunk = relIds.slice(i, i + 40);
          for (let from = 0; ; from += 1000) {
            const { data: tks, error } = await db.from('release_tracks')
              .select('release_id').in('release_id', chunk).range(from, from + 999);
            if (error) { console.warn(`  ! release_tracks: ${error.message}`); break; }
            if (!tks?.length) break;
            for (const t of tks as { release_id: string }[]) {
              perRelease.set(t.release_id, (perRelease.get(t.release_id) ?? 0) + 1);
            }
            if (tks.length < 1000) break;
          }
        }
        for (const [relId, n] of perRelease) {
          const rgId = relToRg.get(relId);
          if (!rgId) continue;
          ourTracks.set(rgId, Math.max(ourTracks.get(rgId) ?? 0, n));
        }
      }
    }

    /* Resolve one of our albums against the same-date candidates, using track count only when the
       date is not already decisive. Strictness is unchanged: a pairing is accepted only when it is
       unique in BOTH directions, so an ambiguous day still yields nothing rather than a guess. */
    const resolveSameDay = (rgId: string, ymd: string, candidates: MdbAlbum[]): MdbAlbum | null => {
      if (candidates.length === 1 && ourDates.get(ymd) === 1) return candidates[0];
      const mine = ourTracks.get(rgId);
      if (!mine) return null;
      const fits = candidates.filter(c => c.tracks === mine);
      if (fits.length !== 1) return null;
      // …and no OTHER album of ours on this day has the same count, or both would claim this record.
      const rivals = ((ours ?? []) as any[]).filter(o =>
        o.id !== rgId
        && String(o.first_release_date).replace(/\D/g, '').slice(0, 8) === ymd
        && ourTracks.get(o.id) === mine);
      return rivals.length ? null : fits[0];
    };

    for (const rg of (ours ?? []) as any[]) {
      const ymd = String(rg.first_release_date).replace(/\D/g, '').slice(0, 8);
      if (ymd.length !== 8) continue;
      // Already Korean: there is nothing a native_title would add, and writing one risks replacing a
      // good title with ManiaDB's differently-punctuated version of the same thing.
      if (HANGUL.test(rg.title ?? '')) continue;
      // Our side must be unambiguous too: two of our releases on one day cannot both be the single
      // ManiaDB record. A dry run matched one 거울 to both "MIRROR" and "Mirror (feat. …)" - the same
      // Korean title written onto two different albums, one of them necessarily wrong.
      const candidates = theirs.filter(t => t.date === ymd);
      if (!candidates.length) continue;
      const pick1 = resolveSameDay(rg.id, ymd, candidates);
      if (!pick1) {
        ambiguous++;
        ambiguousRows.push({
          artist: a.name_native, artist_id: a.id, rg_id: rg.id, our_title: rg.title ?? '', date: ymd,
          candidates: candidates.map(c => ({ id: c.id, title: c.title, tracks: c.tracks })),
          reason: candidates.length > 1 ? 'multiple same-date candidates' : 'our side has siblings on this date',
        });
        continue;
      }
      // A ManiaDB record may be spent once. Belt and braces alongside the check above.
      if (usedTheirs.has(pick1.id)) {
        ambiguous++;
        ambiguousRows.push({
          artist: a.name_native, artist_id: a.id, rg_id: rg.id, our_title: rg.title ?? '', date: ymd,
          candidates: [{ id: pick1.id, title: pick1.title, tracks: pick1.tracks }],
          reason: 'ManiaDB record already claimed by another of our releases',
        });
        continue;
      }
      usedTheirs.add(pick1.id);
      const sameDay = [pick1];
      if (candidates.length > 1 || (ourDates.get(ymd) ?? 0) > 1) brokenByTracks++;

      /* COVERS TOO, not just titles. 114,330 release groups have no cover at all and they skew
         Korean, which is exactly where ManiaDB is strong - it had art for every 황세현 release when
         CAA, Last.fm, Deezer and iTunes between them had none for the deluxe. The artist is already
         resolved and the album already matched on date, so the image costs no extra request.
         Its URLs are http-only (https answers 403); /api/img proxies them, which is why maniadb.com
         is on that allowlist. Only ever fills a NULL - an existing cover is never replaced. */
      if (!rg.cover_url && sameDay[0].image) {
        const { error: ce } = await db.from('release_groups')
          .update({ cover_url: sameDay[0].image }).eq('id', rg.id).is('cover_url', null);
        if (!ce) covers++;
      }

      /* KEEP THE MATCHED ManiaDB ID. The first sweep matched 2,451 albums and threw every id away,
         so filling SONG titles later -- which needs /api/album/[album_id]/ -- would have meant
         repeating the whole 8,163-artist search (~34h) just to recover ids we had already paid for.
         Written whenever we have a confident date match, independent of whether the TITLE turns out
         to be usable below: the id is just as valuable on an album whose ManiaDB title is romanized. */
      if (APPLY && !rg.maniadb_album_id && sameDay[0].id) {
        const { error: ide } = await db.from('release_groups')
          .update({ maniadb_album_id: sameDay[0].id }).eq('id', rg.id).is('maniadb_album_id', null);
        if (!ide) idsSaved++;
      }

      const korean = albumTitleFor(sameDay[0].title, a.name_native);
      if (!korean || !HANGUL.test(korean) || korean === rg.title || rg.native_title) continue;

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
  if (APPLY) console.log(`  covers filled:        ${covers}`);
  console.log(`  artist not in ManiaDB:${noAlbums}`);
  console.log(`  ambiguous (same date):${ambiguous}`);
  console.log(`  tie broken by tracks: ${brokenByTracks}`);
  console.log(`  maniadb ids saved:    ${idsSaved}`);
  if (ambiguousRows.length) {
    try {
      fs.mkdirSync(AMBIG_REPORT.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      fs.writeFileSync(AMBIG_REPORT, JSON.stringify(ambiguousRows, null, 2));
      console.log(`  ambiguous detail ->  ${AMBIG_REPORT}  (${ambiguousRows.length} row(s))`);
    } catch (e) {
      console.warn(`  ! could not write ${AMBIG_REPORT}: ${(e as Error).message}`);
    }
  }
  if (throttled) console.log(`  throttled, left for the next run: ${throttled}`);
  if (!APPLY) console.log('\n  (report only — re-run with --apply to write)');
}

main().catch((e) => { console.error(e); process.exit(1); });
