/**
 * REPORT-ONLY reporter for the "credit stub with no discography" residual (2026-09-20).
 *
 * THE POPULATION. Every MB ingest writes a `credit_stub` artist row for each collaborator credited
 * on the release it ingested (mb-ingest.ts `findOrCreateArtistStub`). That row is `ingest_state =
 * 'resolved'` and, in its own words, *inert*: only 'tracks_done' artists are claimed by the
 * freshness/QC lanes, so nothing ever comes back to fetch the stub's own catalog. 35,271 artists
 * (51.8% of the catalog) sit in that state; 35,248 of them are credited on someone else's release
 * and only 11 are primary on anything. `queue:stubs` exists to drain them but is a one-shot manual
 * script, not a lane — and every ingest creates the NEXT generation of stubs, so the population
 * regenerates. It was last drained 2026-07-18.
 *
 * WHY iTUNES AND NOT MUSICBRAINZ. Draining stubs through MB recovers a lot (a 20-artist sample:
 * 12 had their own releases in MB, avg 2.8 release-groups). But it structurally cannot fix the
 * case this project cares most about — a niche Korean artist MB *has an entity for* but no
 * discography. nowimyoung is the worked example: MB knows 2 release-groups for him, both other
 * people's albums; iTunes has 15 (5 albums, 3 EPs, 7 singles) and Deezer 14. No MB-side fix
 * reaches those.
 *
 * WHY THE EXISTING LANES CAN'T. Each needs an already-OWNED release to establish identity, which
 * is exactly what a stub never has:
 *   • discover-itunes-backfill  → aborts on 'no owned release-groups' (identity = title overlap)
 *   • discover-itunes-recency   → needs a seed title to resolve the streaming artist id
 *   • resolve-thin-artists      → needs >=1 MB feature credit as a corroboration anchor
 *   • mb-deezer-fallback        → only reads queue rows MB left `skipped`; a stub HAS an MBID
 *
 * THE SIGNAL THIS TESTS: **credit anchors**. A stub has no owned release but always has a CREDIT,
 * and a credit is just as good an anchor. If a title we already hold them credited on also appears
 * in a candidate's iTunes discography, that is concrete corroboration this is our artist — not a
 * name guess. (nowimyoung: 2000 TAPE is in our catalog with him credited AND in iTunes artist
 * 1628983181's discography. Hard link.) A 14-artist manual probe corroborated 7, refused the one
 * genuinely ambiguous case ("Faith", 6 exact-name namesakes, 0 anchor hits), and left 5 unmatched.
 *
 * THE DUPLICATE HAZARD, and why the anchor set is also the skip set. `findOrCreateReleaseGroup`
 * (itunes-ingest-core.ts) dedups on primary_artist_id + normalized title + type. Our 2000 TAPE row
 * has primary_artist_id = HAON, so ingesting it again under nowimyoung would NOT match and would
 * create a cross-source duplicate — precisely what the multi-source rule exists to prevent, and
 * NOT something reconcile-itunes-mb.ts covers (it handles the opposite direction and is
 * artist-scoped). The anchors are by definition titles we already hold, so a write path ingests
 * only the NON-anchor albums. This reporter additionally flags any non-anchor album whose title
 * already exists in `release_groups` under some other artist (COLLIDES), since those are the
 * residual case the anchor rule alone doesn't catch.
 *
 * THIS SCRIPT WRITES NOTHING. There is deliberately no --write flag. It answers "what WOULD we
 * ingest, and how confident are we" so the answer can be reviewed before any lane is built —
 * same discipline as resolve-thin-artists.ts / audit-empty-artists.ts.
 *
 *   npx tsx --env-file=.env.local scripts/resolve-stub-itunes.ts --limit=40
 *   npx tsx --env-file=.env.local scripts/resolve-stub-itunes.ts --name=nowimyoung
 *   npx tsx --env-file=.env.local scripts/resolve-stub-itunes.ts --ids-file=scripts/data/kr-adjacent-stubs.json
 *
 * The default id list is the 652 stubs credited alongside a KR/ko artist. Stub rows carry no
 * country or native_language of their own (the stub writer only has an MBID + a name), so
 * credit-adjacency is the only cheap way to find the Korean ones. Regenerate it with:
 *
 *   select distinct s.id from artists s
 *     join release_group_artists rga  on rga.artist_id = s.id
 *     join release_group_artists rga2 on rga2.release_group_id = rga.release_group_id
 *     join artists p on p.id = rga2.artist_id
 *    where s.ingest_state = 'resolved' and s.source_status = 'mb_verified'
 *      and (p.country = 'KR' or p.native_language = 'ko');
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDB, normalizeStr, stripEditionSuffix, releaseType, type DB } from './itunes-ingest-core';
import { makeItunesGet, pool } from './itunes-fetch';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(arg('--limit') ?? Infinity);
const NAME = arg('--name');
const IDS_FILE = arg('--ids-file') ?? 'scripts/data/kr-adjacent-stubs.json';
const OUT = arg('--out') ?? 'scripts/data/stub-itunes-report.json';
// Fall back to non-exact-name iTunes candidates, identity decided by anchor evidence alone.
const ALLOW_FUZZY = process.argv.includes('--fuzzy');
// Widen past credit stubs to already-ingested artists whose MB discography is simply incomplete.
const ANY_STATE = process.argv.includes('--any-state');

// A lookup that returns the 200-row cap is a prolific/compilation entity (three of fourteen in the
// manual probe). Ingesting one would dump hundreds of rows; MB's own ingest refuses the same shape
// via HeavilyFeaturedError / MAX_INGEST_RGS. Flag and refuse rather than truncate silently.
const DISCOGRAPHY_CAP = 200;
// More than this many exact-name candidates means the name is too common to be worth the calls even
// with anchors (we'd still refuse most of them).
const MAX_CANDIDATES = 4;
const CONCURRENCY = 1;

const itunesGet = makeItunesGet({ perMin: Number(arg('--per-min') ?? 40), userAgent: 'sillajuku-stub-report/1.0' });

// ── title keys ────────────────────────────────────────────────────────────────
// releaseGroupKey() alone is not enough to compare an iTunes title to an MB one: iTunes appends
// " - EP" / " - Single" to the collection name and carries "(feat. X)" in it, neither of which is
// an EDITION_KW, so stripEditionSuffix leaves them and the keys never match. Strip both first, then
// hand to the shared key so edition/remaster handling stays in one place.
const FORMAT_SUFFIX_RE = /\s*[-–—]\s*(ep|single|maxi[- ]single)\s*$/i;
const FEAT_PAREN_RE = /\s*[([](?:feat\.?|featuring|with|prod\.?(?: by)?)\s[^)\]]*[)\]]/gi;

// Deliberately NOT normalizeStr(). That helper whitelists \w (ASCII) + Hangul + Kana + CJK, so
// EVERY other script — Cyrillic, Greek, Thai, Devanagari, Arabic — normalizes to the empty string:
//   releaseGroupKey('Береги') === releaseGroupKey('Пара ангелов') === ''
// which made every Cyrillic title match every other one and produced a false CORROBORATED in the
// first sample run (Женя Моисеев: 1 anchor, 9 "hits"). Unicode letter/number classes instead, so
// the key is script-agnostic. The shared helper needs the same fix before ANY write path uses it
// for dedup — it is the key in findOrCreateReleaseGroup and reconcile-itunes-mb — and it currently
// leaves 1,221 artist_aliases rows with alias_norm = ''. Flagged, not fixed here: out of scope.
function unicodeNorm(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFKC')
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleKey(title: string): string {
  let t = (title ?? '').replace(FEAT_PAREN_RE, '');
  for (let i = 0; i < 3; i++) {
    const next = t.replace(FORMAT_SUFFIX_RE, '');
    if (next === t) break;
    t = next;
  }
  // stripEditionSuffix owns remaster/deluxe handling and is worth reusing; normalizeStr is NOT.
  // Routing through releaseGroupKey (= normalizeStr . stripEditionSuffix) silently DELETES every
  // character outside ASCII \w + Hangul/Kana/CJK, so a Unicode Roman numeral vanishes:
  //   "P.O.E.M. Ⅲ" -> "p o e m"  ==  "P.O.E.M." -> "p o e m"
  // which made Owen Ovadoz's P.O.E.M. III register as an anchor we already hold and drop out of the
  // ingest set entirely. A prior guard only fell back when the shared key came back EMPTY; here it
  // came back plausible-but-wrong, so the guard never fired. unicodeNorm NFKC-folds Ⅲ to "iii"
  // and keeps every script, so it is the primary normalizer now and the shared one is not used.
  const stripped = stripEditionSuffix(t.trim() || title);
  return unicodeNorm(stripped);
}

// iTunes packs a collaboration credit into one string: "HAON, nowimyoung, JMIN & KC". Split it into
// the individual credited names so a credit match is a WHOLE-name match — a substring test would
// let "Bien" match "Bienvenido" and hand back a confident wrong artist.
function creditNames(artistName: string | null | undefined): string[] {
  return (artistName ?? '').split(/\s*(?:,|&|feat\.?|featuring|with|\/|\bx\b|×)\s*/i)
    .map(unicodeNorm).filter(Boolean);
}

/**
 * All the shapes one release's title legitimately takes across sources, as normalized strings.
 * Two titles are "the same release" when their variant sets INTERSECT.
 *
 * Exact key equality was not enough and the cost was real: the 2026-09-22 sweep reported albums as
 * missing that the catalogue already held, because iTunes and MusicBrainz title the same record
 * differently. Measured false-positive rate 33% overall, 65% for artists past the old anchor cap:
 *
 *   iTunes "10cm The First EP"               MB "The First EP"        artist name prefixed
 *   iTunes "Starry Night - The 2nd Mini Album" MB "Starry Night"       ordinal-album suffix
 *   iTunes "YOUNHA 7th Album 'GROWTH THEORY'"  MB "GROWTH THEORY"      both, plus quotes
 *   iTunes "Spring Rain"                     MB "봄비 (Spring Rain)"   bilingual parenthetical
 *   iTunes "The 2nd"                         MB "The 2nd EP"          format tail
 *
 * Deliberately EQUALITY over a variant set, not substring containment. Containment over-matches --
 * it pairs "The Greatest" with "make a secret -The Greatest ver.-", which are different releases --
 * and a wrong merge silently hides a real album, which is the failure this whole pass exists to fix.
 */
const ORDINAL_ALBUM_RE = /\s*[-–—:]?\s*(the\s+)?\d+(\.\d+)?\s*(st|nd|rd|th)\s+(mini\s+|full\s+|repackage\s+)?(album|ep|single).*$/i;
const FORMAT_TAIL_RE   = /\s*[-–—:]?\s*(the\s+)?(mini\s+|full\s+)?(album|ep|single)\s*$/i;
// As ORDINAL_ALBUM_RE but WITHOUT the trailing `.*$`, so it removes only the ordinal phrase and
// leaves whatever follows it intact. Needed for "<Artist> <N>th Single <Title>", where the real
// title comes after the ordinal rather than before it.
// A repackage is its own release group, not an edition of the album it repackages (owner's call,
// 2026-09-22), so reductions must never strip this marker away. Covers the English word and the
// Korean 리패키지.
// A trailing group fenced by dashes -- "AGGRESSIVE -The Greatest ver.-" -- which J-pop and K-pop
// releases use where Western ones use parentheses. Non-greedy inner so it takes the LAST such
// group, and requires the closing dash at end-of-string so an ordinary hyphenated title
// ("Jekyll -and- Hyde" is not a thing, but "A - B" is) is not mistaken for one.
const DASH_GROUP_RE = /[-–—]\s*([^-–—]{2,}?)\s*[-–—]\s*$/;
const REPACKAGE_RE = /repackage|repack|리패키지/i;
const ORDINAL_INFIX_RE = /\s*[-–—:]?\s*(the\s+)?\d+(\.\d+)?\s*(st|nd|rd|th)\s+(mini\s+|full\s+|repackage\s+)?(album|ep|single)\b\s*/i;
const PAREN_GROUP_RE   = /[([]([^)\]]{2,})[)\]]/g;
// Descriptors, not titles. Never promote one of these to a standalone alternate title.
const GENERIC_PAREN_RE = /^\s*(original\s+)?(motion\s+picture\s+|television\s+|game\s+|broadway\s+|cast\s+)?(sound\s?track|ost|score|album|ep|single|deluxe|expanded|special|standard|remaster(ed)?|reissue|remix(es)?|instrumental(s)?|live|acoustic|version|edition|mix|explicit|clean|bonus|disc\s*\d+|vol\.?\s*\d+|pt\.?\s*\d+|part\s*\d+|feat\.?.*|with\s+.*|inst\.?)\s*\d*\s*$/i;

/**
 * Is this parenthetical a real alternate TITLE, or just an aside?
 * Generic descriptors are excluded by GENERIC_PAREN_RE, but so must short filler words be: Sagisu's
 * "...EVANGELION 2.0 YOU CAN (NOT) ADVANCE." and "...3.0 you can (not) redo" are different films
 * that matched purely because "(NOT)" became a shared variant on both sides.
 */
function isAlternateTitle(inner: string): boolean {
  const t = inner.trim();
  if (t.length < 4) return false;                       // "NOT", "ver", "pt2"
  if (GENERIC_PAREN_RE.test(t)) return false;           // "Original Motion Picture Soundtrack"
  if (/^[A-Za-z]+$/.test(t) && t.length < 6) return false; // a single short latin word is filler
  return true;
}

export function titleVariants(raw: string, artistNames: string[] = []): Set<string> {
  const out = new Set<string>();
  const add = (v: string) => { const n = unicodeNorm(v); if (n.length >= 2) out.add(n); };
  const base = (raw ?? '').replace(FEAT_PAREN_RE, '').trim();
  if (!base) return out;

  // A repackage is its own release group (owner's call, 2026-09-22), so NO reduction anywhere in
  // this function may quietly turn one into the album it repackages. Re-attach the marker whenever
  // a reduction drops it. This has to wrap the SEED reductions as well as the ones in reduce():
  // guarding only the latter left "&TWICE - Repackage -" reducing, at seed time, to "&TWICE" and
  // matching the base album we have held since 2019 — the policy violated by the very rule added to
  // enforce it.
  const keepRepack = (from: string, reduced: string): string =>
    REPACKAGE_RE.test(from) && !REPACKAGE_RE.test(reduced) ? `${reduced.trim()} repackage` : reduced;

  const seeds = new Set<string>([base, keepRepack(base, stripEditionSuffix(base))]);

  // Quoted inner title: "YOUNHA 7th Album 'GROWTH THEORY'" -> GROWTH THEORY
  for (const m of base.matchAll(/['"“”‘’「『]([^'"“”‘’」』]{2,})['"“”‘’」』]/g)) seeds.add(m[1]);

  // Parenthetical alternates, both directions: "봄비 (Spring Rain)" -> 봄비 AND Spring Rain.
  // But ONLY when the parenthetical is a real alternate title. A generic descriptor must never
  // become a standalone variant: promoting "(Original Motion Picture Soundtrack)" made every
  // soundtrack match every other one, which flagged Sagisu's "Attack on Titan (OST)" as a duplicate
  // of his "An Endless Sunday (OST)". Stripping it is still right -- it is only PROMOTION that is wrong.
  for (const m of base.matchAll(PAREN_GROUP_RE)) if (isAlternateTitle(m[1])) seeds.add(m[1]);
  seeds.add(keepRepack(base, base.replace(PAREN_GROUP_RE, ' ')));

  // Dash-delimited trailing group, the J-pop/K-pop equivalent of a parenthetical:
  // "AGGRESSIVE -The Greatest ver.-". Only the bracketed form was recognised, so the two spellings
  // of one release never met -- iTunes offered "AGGRESSIVE (The Greatest Version)", which reduces
  // to "aggressive", while the "AGGRESSIVE -The Greatest ver.-" already in the catalogue reduced to
  // nothing shorter than itself. It would have been written as a duplicate of a row we have held
  // since 2022. Handling the delimiter also makes the ver./Version spelling difference irrelevant,
  // which is why no abbreviation table is needed here.
  // STRIPPED, NEVER PROMOTED. Unlike a parenthetical -- which often carries a genuine alternate
  // title, "봄비 (Spring Rain)" -- a dash-fenced group in this convention is always an edition or
  // version marker. Promoting it to a standalone variant made every song in a reissue series match
  // every other: "AGGRESSIVE -The Greatest ver.-" matched "LISTEN TO MY HEART -The Greatest ver.-"
  // through the shared "the greatest ver". Same failure the generic-parenthetical guard exists to
  // prevent, so the same conclusion applies -- stripping is right, promotion is not.
  if (DASH_GROUP_RE.test(base)) seeds.add(keepRepack(base, base.replace(DASH_GROUP_RE, ' ')));

  // ONE REDUCTION STEP. Returns every shorter form of `t` reachable by removing one decoration.
  //
  // REPACKAGES STAY SEPARATE (owner's call, 2026-09-22). A K-pop repackage is the same album
  // reissued months later with extra tracks and new art -- "CLASS" then "CLASS ADDITION" -- and we
  // treat it as its own release group rather than pooling it with the original. They are rare
  // enough for that to be cheap: 27 of 491,157 release groups say "repackage", 25 of them Korean.
  //
  // That makes plain reduction wrong here. ORDINAL_ALBUM_RE ends in `.*$`, so "LOVE SHOT - The 5th
  // Album Repackage" reduced straight to "LOVE SHOT" and matched the original -- which, under this
  // policy, is a different album. So when the input carries a repackage marker, every reduction
  // that would drop it gets the marker re-attached instead of being discarded. Two spellings of the
  // SAME repackage still converge ("... - The 5th Album Repackage" and "... (Repackage)" both reach
  // "love shot repackage"), so this does not simply disable matching for them -- it only stops a
  // repackage from collapsing into the album it is a repackage OF.
  const reduce = (t: string): string[] => {
    const outs: string[] = [];
    const keep = (v: string) => {
      const trimmed = v.trim();
      if (trimmed) outs.push(keepRepack(t, trimmed));
    };
    // Drop an ordinal-album tail: "Starry Night - The 2nd Mini Album" -> "Starry Night"
    const noOrd = t.replace(ORDINAL_ALBUM_RE, '');
    if (noOrd.trim() && noOrd !== t) keep(noOrd);
    // Drop an ordinal phrase that sits MID-string, keeping what follows. ORDINAL_ALBUM_RE ends in
    // `.*$`, so on the very common Korean format "<Artist> <N>th Single <Title>" it swallowed the
    // real title: "Afterschool 3rd Single BANG" reduced to "afterschool" and therefore never
    // matched the "Bang!" already in the catalogue.
    const noOrdIn = t.replace(ORDINAL_INFIX_RE, ' ');
    if (noOrdIn.trim() && noOrdIn !== t) keep(noOrdIn);
    // Drop a bare format tail: "The 2nd EP" -> "The 2nd"
    const noFmt = t.replace(FORMAT_TAIL_RE, '');
    if (noFmt.trim() && noFmt !== t) keep(noFmt);
    // Drop a leading artist name: "10cm The First EP" -> "The First EP".
    // Compared with spaces removed, because the artist field and the title often disagree about
    // them -- the row is credited "After School" while the title reads "Afterschool".
    const tn = unicodeNorm(t);
    for (const an of artistNames) {
      const n = unicodeNorm(an);
      if (n.length < 2) continue;
      const nNo = n.replace(/\s+/g, '');
      let acc = '';
      for (let i = 0; i < tn.length; i++) {
        acc += tn[i];
        if (acc.replace(/\s+/g, '').length > nNo.length) break;
        if (acc.replace(/\s+/g, '') === nNo) {
          const rest = tn.slice(i + 1).trim();
          if (rest.length >= 2) keep(rest);
          break;
        }
      }
    }
    return outs;
  };

  // REDUCTIONS MUST COMPOSE. Each rule used to be applied once, to the seed only, so a title
  // carrying two decorations at once never reduced past the first one:
  // "NCT#127 LIMITLESS - The 2nd Mini Album" yielded "nct 127 limitless" (artist kept, tail
  // dropped) and "limitless the 2nd mini album" (artist dropped, tail kept) but never plain
  // "limitless" -- so it did not match the LIMITLESS we already hold, and would have been written
  // as a duplicate. Iterating to a fixed point produces the fully-stripped form as well. Four
  // rounds is far more than any real title needs and bounds the work.
  for (const seed of seeds) {
    add(seed);
    let frontier = [seed];
    for (let round = 0; round < 4 && frontier.length; round++) {
      const next: string[] = [];
      for (const t of frontier) {
        for (const r of reduce(t)) {
          const n = unicodeNorm(r);
          if (n.length >= 2 && !out.has(n)) { out.add(n); next.push(r); }
        }
      }
      frontier = next;
    }
  }
  return out;
}

/** True when two titles are plausibly the same release, by variant-set intersection. */
export function titlesMatch(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

// A title distinctive enough that ONE match is real corroboration rather than a coincidence.
// "colors of the feather" yes; "goosebumps" no (Travis Scott and a dozen others). Mirrors the
// generic-name guard in resolve-thin-artists.ts, applied to the anchor instead of the name.
function isDistinctive(key: string): boolean {
  if (!key) return false;
  const tokens = key.split(' ').filter(Boolean);
  return key.length >= 14 || tokens.length >= 3;
}

type Verdict = 'CORROBORATED' | 'WEAK' | 'AMBIGUOUS' | 'NAME_ONLY' | 'NO_ITUNES_MATCH' | 'TOO_LARGE' | 'SOURCE_ERROR';
const VERDICTS: Verdict[] = ['CORROBORATED', 'WEAK', 'AMBIGUOUS', 'NAME_ONLY', 'NO_ITUNES_MATCH', 'TOO_LARGE', 'SOURCE_ERROR'];
// Verdicts that are a real finding about the artist. SOURCE_ERROR is not one -- it is a statement
// about iTunes' availability, so a resumed run retries it instead of treating it as settled.
const SETTLED = new Set<Verdict>(['CORROBORATED', 'WEAK', 'AMBIGUOUS', 'NAME_ONLY', 'NO_ITUNES_MATCH', 'TOO_LARGE']);

interface StubRow { id: string; name: string; name_native: string | null; native_language: string | null }
interface Anchor { title: string; date: string | null; via: string }
interface NewAlbum {
  collectionId: number; title: string; displayTitle: string; date: string | null; trackCount: number;
  // Carried through from the discography lookup we already made, so the write path never has to
  // re-request it: 5,807 albums would otherwise cost 5,807 extra iTunes calls (~10h at a safe rate)
  // purely to re-read a field we had in hand and threw away.
  artworkUrl: string | null;
  type: string; primary: boolean; creditedAs: string; flags: string[];
  collides: { title: string; artist: string; date: string | null } | null;
}
interface Report {
  id: string; name: string; verdict: Verdict; anchors: Anchor[];
  candidates: number; itunesArtistId: number | null; itunesArtistName: string | null;
  store: string | null; discographySize: number; anchorHits: string[];
  nameMatch?: 'exact' | 'fuzzy';
  corroboration?: { distinctHits: number; strongHits: number; creditHits: number };
  newAlbums: NewAlbum[]; note?: string;
}

// ── population ────────────────────────────────────────────────────────────────
async function loadStubs(db: DB): Promise<StubRow[]> {
  const sel = 'id, name, name_native, native_language';
  if (NAME) {
    // --any-state widens this beyond credit stubs to artists we HAVE ingested, because a complete
    // MusicBrainz ingest is not the same as a complete discography. Owen Ovadoz is tracks_done with
    // all 17 release groups MB knows about — and iTunes has 74 (~32 of them his own), including
    // P.O.E.M. III/IV, Cry, love is, REDRUM and POEMV. YANGHONGWON is the same shape: 8 of ~20.
    // For these the anchor signal is far STRONGER than for a stub, since they bring many owned
    // titles to corroborate against rather than a single credit, so the gate is unchanged.
    let q = db.from('artists').select(sel).ilike('name', NAME).limit(10);
    if (!ANY_STATE) q = q.eq('ingest_state', 'resolved').eq('source_status', 'mb_verified');
    const { data, error } = await q;
    if (error) throw new Error(`artist lookup: ${error.message}`);
    return (data ?? []) as StubRow[];
  }
  const file = path.resolve(process.cwd(), IDS_FILE);
  if (!fs.existsSync(file)) throw new Error(`ids file not found: ${IDS_FILE} (see the header for the SQL that builds it)`);
  const ids: string[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out: StubRow[] = [];
  // Keep the .in() list small — a few hundred UUIDs overflows the request URL and the query
  // silently returns nothing (the lesson queue-stubs.ts records).
  for (let i = 0; i < ids.length && out.length < LIMIT; i += 100) {
    const { data, error } = await db.from('artists').select(sel).in('id', ids.slice(i, i + 100));
    if (error) { console.error(`  ! stub batch ${i}: ${error.message}`); continue; }
    out.push(...((data ?? []) as StubRow[]));
  }
  return out.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
}

/** Every name we know this artist by — canonical, native, and all aliases MB gave us. */
async function knownNames(db: DB, stub: StubRow): Promise<string[]> {
  const { data } = await db.from('artist_aliases').select('alias').eq('artist_id', stub.id).limit(40);
  const all = [stub.name, stub.name_native, ...(data ?? []).map((r: any) => r.alias as string)];
  const seen = new Set<string>();
  return all.filter((n): n is string => !!n && !seen.has(normalizeStr(n)) && !!seen.add(normalizeStr(n)));
}

/** The releases we already hold this stub credited on. These are the identity anchors AND the skip set. */
async function creditAnchors(db: DB, stubId: string): Promise<Anchor[]> {
  const { data, error } = await db.from('release_group_artists')
    .select('release_groups!inner(title, first_release_date, artist_display)')
    // NO practical cap. This was .limit(60), written when the population was credit stubs, which
    // have one or two credits. --any-state later widened this script to fully-ingested artists, and
    // the limit silently came along: for anyone with more than 60 release groups the anchor set was
    // TRUNCATED, so everything past the cap looked absent and was reported as missing. Measured on
    // 2026-09-22: BoA holds 165 release groups but only 60 anchors loaded, and a 40-artist sample
    // came back 98% false positives -- titles like "I believe" and "Disturbance" that we already
    // hold verbatim. Same failure as the artist page's LIMIT 60: a cap written for one population
    // inherited by another. 1000 is above the largest discography in the catalogue (1,094) while
    // still bounding a runaway.
    .eq('artist_id', stubId).limit(1000);
  if (error) throw new Error(`anchors for ${stubId}: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    title: r.release_groups.title as string,
    date: (r.release_groups.first_release_date ?? null) as string | null,
    via: (r.release_groups.artist_display ?? '') as string,
  }));
}

// ── iTunes ────────────────────────────────────────────────────────────────────
function storesFor(stub: StubRow, names: string[]): (string | null)[] {
  const hangul = names.some(n => /[가-힣]/.test(n));
  return (stub.native_language === 'ko' || hangul) ? ['KR', null] : [null, 'KR'];
}

/**
 * makeItunesGet returns null for a FAILED request (network error, or a 429/403 that outlived its
 * retries) and a real object for a successful one — including a genuine `resultCount: 0`. Collapsing
 * those two with `data?.results ?? []` is what made the first full run untrustworthy: under an iTunes
 * IP-block, "we were refused an answer" was recorded as "iTunes has no such artist" (33 bogus
 * NO_ITUNES_MATCH verdicts in 171 stubs). Everything below tracks `blocked` so a refusal becomes
 * SOURCE_ERROR — retryable on the next run — and never a finding.
 */
let consecutiveFailures = 0;
const ABORT_AFTER_FAILURES = 20;
class SourceBlockedError extends Error {
  constructor(n: number) { super(`iTunes refused ${n} consecutive requests — aborting (state saved, re-run to resume)`); }
}
async function get(url: string): Promise<any | null> {
  const data = await itunesGet(url);
  if (data === null) {
    if (++consecutiveFailures >= ABORT_AFTER_FAILURES) throw new SourceBlockedError(consecutiveFailures);
    return null;
  }
  consecutiveFailures = 0;
  return data;
}

/**
 * Two tiers, because the exact-name gate alone loses the population this project cares most about.
 *
 * EXACT: the candidate's iTunes name equals one of ours (canonical / native / any MB alias).
 *
 * FUZZY: nothing matched exactly, so take the top search results as-is. The first full 652-stub run
 * returned NO_ITUNES_MATCH for 135 stubs, 73 of them Hangul-named; hand-checking ten showed SIX were
 * on iTunes all along under a romanized stage name we never tried — 택연 → TAECYEON, 범진 → BUMJIN,
 * 현철 → Hyun Cheol, DJ 해리 → DJ HARRY, 이츠 → It's. MusicBrainz gives us no Latin alias for any of
 * them (artist_aliases for 택연 is literally ["택연"]), and algorithmic Revised Romanization does not
 * reproduce Apple's spellings either (RR says Taegyeon, Apple says TAECYEON) — stage-name
 * romanization is idiosyncratic, so no transliteration table fixes this.
 *
 * The way out is to stop treating the NAME as the identity gate. We already hold a strictly stronger
 * signal: the credit anchor. So a fuzzy candidate is allowed in, and identity is decided entirely by
 * anchor evidence — under a STRICTER gate than exact candidates get (see the corroboration check).
 * Note iTunes found these itself: searching 택연 returns "TAECYEON / 2PM". We were discarding the
 * right answer before ever looking at its discography.
 */
async function findCandidates(names: string[], stores: (string | null)[], allowFuzzy: boolean) {
  const wanted = new Set(names.map(normalizeStr));
  let blocked = false;
  const byId = new Map<number, any>();
  for (const store of stores) {
    for (const name of names.slice(0, 3)) {
      const c = store ? `&country=${store}` : '';
      const data = await get(
        `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=10${c}`);
      if (data === null) { blocked = true; continue; }
      for (const a of (data.results ?? []).filter((r: any) => r.wrapperType === 'artist')) {
        const exact = wanted.has(normalizeStr(a.artistName ?? ''));
        const prev = byId.get(a.artistId);
        if (!prev) byId.set(a.artistId, { ...a, _exact: exact, _store: store });
        else if (exact) prev._exact = true;
      }
    }
    // One store round is enough once an exact-name candidate exists; otherwise try the next store.
    if ([...byId.values()].some(c => c._exact)) break;
  }
  const all = [...byId.values()];
  const exacts = all.filter(c => c._exact);
  const others = all.filter(c => !c._exact);
  // Exact-name candidates are RANKED first but no longer WIN outright, because an exact name is a
  // weaker signal than anchor evidence and this got it badly wrong: searching "Owen Ovadoz" returns
  //   976034588  "Owen"        (오왼)  — the real artist, 74 releases, FIRST result
  //   1539087817 "Owen Ovadoz"         — a near-empty duplicate with 1 release
  // The old code filtered to exact matches and returned immediately, so it locked onto the empty
  // duplicate and never even looked at the right artist. Now every candidate is scored against the
  // anchors and the evidence decides; the name only breaks ties. A winner that did NOT match by name
  // is still held to the stricter fuzzy gate.
  const cands = allowFuzzy ? [...exacts, ...others] : exacts;
  return {
    cands: cands.slice(0, MAX_CANDIDATES),
    store: cands[0]?._store ?? null,
    blocked: blocked && cands.length === 0,
  };
}

/**
 * Tracks the artist is credited on, INCLUDING guest/"feat." spots on other artists' releases, which
 * `entity=album` structurally cannot return. Used only for identity corroboration — never as the
 * ingest set, which always comes from the album lookup.
 */
async function songCredits(artistId: number, store: string | null): Promise<any[] | null> {
  const c = store ? `&country=${store}` : '';
  const data = await get(`https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=100${c}`);
  if (data === null) return null;
  return (data.results ?? []).filter((r: any) => r.wrapperType === 'track');
}

/** null = iTunes refused (retryable); [] = it answered and the artist genuinely has no albums. */
async function discography(artistId: number, store: string | null): Promise<any[] | null> {
  const c = store ? `&country=${store}` : '';
  const data = await get(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=${DISCOGRAPHY_CAP}${c}`);
  if (data === null) return null;
  return (data.results ?? []).filter((r: any) => r.wrapperType === 'collection');
}

/**
 * Residual duplicate check: a non-anchor album whose title already exists in release_groups under
 * SOME OTHER artist we have no credit link to. The anchor rule can't see these. Exact-title match
 * batched through .in(), then compared on the normalized key so edition suffixes don't hide a hit.
 */
const COLLISION_MAX_DAYS = 730;

/**
 * A shared title is NOT a duplicate. Withholding on title alone dropped Owen Ovadoz's "Cry" (2022,
 * 11-track album) because Michael Jackson has a 2001 single called "Cry" — as do John Klemmer,
 * Johnnie Ray, The Sundays, System F and Simple Minds. Common titles are common.
 *
 * A genuine cross-source duplicate is the SAME release reaching us twice, which means the existing
 * row's credit must actually involve this artist AND the dates must be close. Both are required:
 * artist overlap alone would flag a re-recording decades later, and date proximity alone would flag
 * two unrelated artists releasing "Cry" in the same year. This mirrors reconcile-itunes-mb's
 * daysApart guard rather than inventing a new rule.
 */
async function findCollisions(db: DB, titles: string[], ourNames: string[]) {
  const rows = new Map<string, { title: string; artist: string; date: string | null }[]>();
  for (let i = 0; i < titles.length; i += 50) {
    const { data } = await db.from('release_groups')
      .select('title, artist_display, first_release_date').in('title', titles.slice(i, i + 50));
    for (const r of (data ?? []) as any[]) {
      const k = titleKey(r.title);
      const list = rows.get(k);
      const row = { title: r.title, artist: r.artist_display ?? '', date: r.first_release_date ?? null };
      if (list) list.push(row); else rows.set(k, [row]);
    }
  }
  return (key: string, albumDate: string | null) => {
    for (const r of rows.get(key) ?? []) {
      const sharesArtist = creditNames(r.artist).some(c => ourNames.includes(c));
      if (!sharesArtist) continue;
      if (!albumDate || !r.date) return r;            // undated on either side → be conservative
      const days = Math.abs(Date.parse(albumDate) - Date.parse(r.date)) / 86_400_000;
      if (Number.isFinite(days) && days <= COLLISION_MAX_DAYS) return r;
    }
    return null;
  };
}

async function inspect(db: DB, stub: StubRow): Promise<Report> {
  const anchors = await creditAnchors(db, stub.id);
  const base: Report = {
    id: stub.id, name: stub.name, verdict: 'NO_ITUNES_MATCH', anchors,
    candidates: 0, itunesArtistId: null, itunesArtistName: null, store: null,
    discographySize: 0, anchorHits: [], newAlbums: [],
  };
  const names = await knownNames(db, stub);
  const { cands, store, blocked } = await findCandidates(names, storesFor(stub, names), ALLOW_FUZZY);
  base.candidates = cands.length;
  base.store = store;
  if (!cands.length) {
    // Never record "iTunes has no such artist" when iTunes simply refused to answer.
    if (blocked) { base.verdict = 'SOURCE_ERROR'; base.note = 'iTunes refused the search (throttled) — retry'; }
    return base;
  }

  // Union of every legitimate form of every title we already hold for this artist. `names` gives
  // titleVariants the artist name so an iTunes title that prefixes it ("10cm The First EP") reduces
  // to the bare title we store.
  const anchorKeys = new Set<string>();
  for (const a of anchors) for (const v of titleVariants(a.title, names)) anchorKeys.add(v);
  const matchesAnchor = (t: string) => titlesMatch(titleVariants(t, names), anchorKeys);
  let best: { cand: any; disc: any[]; hits: any[] } | null = null;
  let sawOversized = false;
  let discBlocked = false;
  for (const cand of cands.slice(0, MAX_CANDIDATES)) {
    const disc = await discography(cand.artistId, store);
    if (disc === null) { discBlocked = true; continue; }
    if (disc.length >= DISCOGRAPHY_CAP) { sawOversized = true; continue; }
    let hits = disc.filter((a: any) => matchesAnchor(a.collectionName));
    // FEATURE-CREDIT FALLBACK. `entity=album` only returns collections the artist is the COLLECTION
    // artist of, so a "feat." guest spot on someone else's single is invisible to it — and that is
    // the ONLY credit most of these stubs have (택연's sole anchor "Classic" is credited 박진영, 택연,
    // 우영, 수지 and files under 박진영). `entity=song` does return those tracks, which is the same
    // trick resolve-thin-artists.ts uses. Only pay for it when the album pass found nothing, so
    // already-corroborating artists cost no extra request.
    if (!hits.length) {
      const songs = await songCredits(cand.artistId, store);
      if (songs === null) discBlocked = true;
      else hits = songs.filter((t: any) =>
        matchesAnchor(t.trackName ?? '') || matchesAnchor(t.collectionName ?? ''));
    }
    if (!best || hits.length > best.hits.length) best = { cand, disc, hits };
  }
  if (!best && discBlocked) {
    base.verdict = 'SOURCE_ERROR';
    base.note = 'iTunes refused the discography lookup (throttled) — retry';
    return base;
  }
  if (!best) {
    base.verdict = 'TOO_LARGE';
    base.note = `all ${cands.length} candidate(s) returned the ${DISCOGRAPHY_CAP}-album lookup cap`;
    return base;
  }

  base.itunesArtistId = best.cand.artistId;
  base.itunesArtistName = best.cand.artistName;
  // Decided by which candidate WON on evidence, not by how the batch was gathered.
  const nameMatch: 'exact' | 'fuzzy' = best.cand._exact ? 'exact' : 'fuzzy';
  base.nameMatch = nameMatch;
  base.discographySize = best.disc.length;
  base.anchorHits = best.hits.map((h: any) => h.trackName ?? h.collectionName);
  if (sawOversized) base.note = 'one or more same-name candidates hit the lookup cap and were skipped';

  if (!best.hits.length) {
    base.verdict = cands.length > 1 ? 'AMBIGUOUS' : 'NAME_ONLY';
    return base;
  }

  // Strength of the corroboration, not just its existence. Several iTunes editions can match the
  // same anchor (Kaspa.: 7 anchors, 10 raw hits), so count DISTINCT anchor keys.
  // A hit may be an album (matched on collectionName) or, via the feature-credit fallback, a track
  // (matched on trackName). Key on whichever field actually matched an anchor, or the distinctness
  // and strength counts would be computed against the wrong string.
  const hitKeys = new Set<string>(best.hits.map((h: any) => {
    const tk = titleKey(h.trackName ?? '');
    return matchesAnchor(h.trackName ?? '') ? tk : titleKey(h.collectionName ?? '');
  }));
  const strongHits = [...hitKeys].filter(isDistinctive).length;
  // The hardest signal available: a matched album that iTunes files under SOMEONE ELSE yet whose
  // credit line names our artist — and which we independently hold with them credited. That is a
  // cross-source agreement on a collaboration, not a title coincidence. (nowimyoung: "2000 TAPE",
  // filed under HAON, credited "HAON, nowimyoung, JMIN & KC".) Only counts when the candidate is
  // NOT the primary — on their own album the credit line is just their name again, and says nothing.
  // Minimum length is script-dependent. Three chars is a sane floor for Latin (it stops "Kim"-style
  // fragments matching inside longer names), but a Hangul/Kana/CJK name packs a whole syllable into
  // each character, so 택연 / 범진 / 이츠 are COMPLETE two-character names. A flat >= 3 silently threw
  // away most Korean artist names before the credit check ever ran, which is why 택연 scored
  // creditHits=0 against a credit line that literally reads "박진영, 택연, 장우영 & 수지".
  const minLen = (n: string) => (/[가-힣぀-ヿㇰ-ㇿ一-鿿]/.test(n) ? 2 : 3);
  const ourNames = names.map(unicodeNorm).filter(n => n.length >= minLen(n));
  const creditHits = best.hits.filter((h: any) =>
    h.artistId !== best!.cand.artistId && creditNames(h.artistName).some(c => ourNames.includes(c))).length;
  base.corroboration = { distinctHits: hitKeys.size, strongHits, creditHits };

  // A FUZZY candidate has no name agreement at all, so the anchor must carry the whole identity
  // claim: two coincidental generic-title matches are not enough on their own the way they are when
  // the name already agrees. Require a credit match or a genuinely distinctive title.
  const passes = nameMatch === 'fuzzy'
    ? (creditHits >= 1 || strongHits >= 1)
    : (creditHits >= 1 || strongHits >= 1 || hitKeys.size >= 2);
  if (!passes) {
    base.verdict = 'WEAK';
    base.note = nameMatch === 'fuzzy'
      ? `fuzzy name match (${best.cand.artistName}) with only generic anchor hits (${[...hitKeys].join(', ')})`
      : `only ${hitKeys.size} generic anchor hit (${[...hitKeys].join(', ')}) across ${cands.length} same-name candidate(s)`;
    return base;
  }

  base.verdict = 'CORROBORATED';
  // The skip set. Anything matching ANY variant of a title we hold is already ours -- this is the
  // guard that stops the write pass creating "Starry Night - The 2nd Mini Album" beside "Starry
  // Night". Bias is deliberate: when unsure, treat as already-held. A missed album can be picked up
  // on a later run; a duplicate pollutes the catalogue and needs a manual merge.
  const fresh = best.disc.filter((a: any) => !matchesAnchor(a.collectionName));
  const collidesWith = await findCollisions(db, fresh.map((a: any) => a.collectionName), ourNames);
  base.newAlbums = fresh.map((a: any): NewAlbum => {
    const raw = (a.collectionName ?? '') as string;
    const type = releaseType(a.trackCount ?? 0, raw);
    const flags: string[] = [];
    // releaseType() matches 'live' as a SUBSTRING, so "NEON LIVES MATTER" classifies as Live.
    // Surface it rather than diverge from the shared helper a write path would use.
    if (type === 'Live' && !/\blive\b/i.test(raw)) flags.push('TYPE_SUSPECT');
    return {
      collectionId: a.collectionId,
      title: raw,
      displayTitle: raw.replace(FORMAT_SUFFIX_RE, '').trim() || raw,
      artworkUrl: (a.artworkUrl100 ?? null) as string | null,
      date: a.releaseDate ? String(a.releaseDate).slice(0, 10) : null,
      trackCount: a.trackCount ?? 0,
      type,
      // iTunes carries the primary credit as the collection's own artistId — the direct analogue of
      // MB's shouldIngestRG primary check. A collection filed under someone else is a guest feature:
      // it must NOT be written with this stub as primary_artist_id or it duplicates their album.
      primary: a.artistId === best!.cand.artistId,
      creditedAs: (a.artistName ?? '') as string,
      flags,
      collides: collidesWith(titleKey(raw), a.releaseDate ? String(a.releaseDate).slice(0, 10) : null),
    };
  });
  return base;
}

// ── main ──────────────────────────────────────────────────────────────────────
/** Reload a previous run's report so a resumed run re-does only what is not SETTLED. */
function loadPrevious(outFile: string): Map<string, Report> {
  const prior = new Map<string, Report>();
  if (process.argv.includes('--fresh') || !fs.existsSync(outFile)) return prior;
  try {
    for (const r of JSON.parse(fs.readFileSync(outFile, 'utf8')) as Report[]) {
      if (SETTLED.has(r.verdict)) prior.set(r.id, r);
    }
  } catch { /* unreadable/partial report — just start over */ }
  return prior;
}

async function main() {
  const db = getDB();
  const reportFile = path.resolve(process.cwd(), OUT);
  const population = await loadStubs(db);
  const prior = loadPrevious(reportFile);
  const stubs = population.filter(s => !prior.has(s.id));
  console.log(`[stub-itunes] ${population.length} stub artist(s); ${prior.size} already settled, ${stubs.length} to inspect`);
  console.log('              REPORT ONLY — nothing is written to the database\n');
  if (!stubs.length) { console.log('  nothing to do (pass --fresh to redo everything)'); return; }

  const reports: Report[] = [...prior.values()];
  const save = () => { fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2)); };
  let done = 0;
  let aborted = false;
  await pool(stubs, CONCURRENCY, async (stub) => {
    if (aborted) return;
    let r: Report;
    try {
      r = await inspect(db, stub);
    } catch (e) {
      // A sustained block is not a finding about this artist — stop cleanly, keep what we have, and
      // let the next run resume. Anything else is recorded against the artist as an error.
      if (e instanceof SourceBlockedError) {
        aborted = true;
        console.error(`\n  ! ${e.message}`);
        return;
      }
      r = {
        id: stub.id, name: stub.name, verdict: 'SOURCE_ERROR', anchors: [], candidates: 0,
        itunesArtistId: null, itunesArtistName: null, store: null, discographySize: 0,
        anchorHits: [], newAlbums: [], note: `ERROR: ${(e as Error).message}`,
      };
    }
    reports.push(r);
    done++;
    if (done % 20 === 0) save(); // checkpoint, so a kill -9 never costs more than 20 stubs
    const own = r.newAlbums.filter(a => a.primary && !a.collides).length;
    const feat = r.newAlbums.filter(a => !a.primary).length;
    const dup = r.newAlbums.filter(a => a.collides).length;
    console.log(
      `  ${String(done).padStart(4)}/${stubs.length}  ${r.verdict.padEnd(15)} ${r.name.slice(0, 26).padEnd(28)}` +
      `cands=${r.candidates} disc=${String(r.discographySize).padStart(3)} ` +
      `anchors=${r.anchors.length}/${r.anchorHits.length}hit own=${String(own).padStart(3)} feat=${String(feat).padStart(2)}` +
      (dup ? `  COLLIDES=${dup}` : '') + (r.note ? `  (${r.note})` : ''));
  });

  const by = (v: Verdict) => reports.filter(r => r.verdict === v);
  const corr = by('CORROBORATED');
  const all = corr.flatMap(r => r.newAlbums);
  const ownTotal = all.filter(a => a.primary && !a.collides).length;
  const featTotal = all.filter(a => !a.primary).length;
  const newTotal = all.length;
  const collideTotal = all.filter(a => a.collides).length;
  const suspect = all.filter(a => a.flags.includes('TYPE_SUSPECT')).length;

  console.log('\n── verdicts ─────────────────────────────────');
  for (const v of VERDICTS) {
    console.log(`  ${v.padEnd(18)} ${String(by(v).length).padStart(4)}`);
  }
  console.log('\n── what a write pass would add ──────────────');
  console.log(`  artists resolved          ${corr.length}`);
  console.log(`  non-anchor albums seen    ${newTotal}`);
  console.log(`    OWN (stub is primary)   ${ownTotal}   <- what a write pass should ingest`);
  console.log(`    guest features          ${featTotal}   withheld: filed under another artist`);
  console.log(`    title collisions        ${collideTotal}   withheld: title already in release_groups`);
  console.log(`  avg own per artist        ${corr.length ? (ownTotal / corr.length).toFixed(1) : '0'}`);
  console.log(`  refused (missing > wrong) ${reports.length - corr.length - by('NO_ITUNES_MATCH').length}`);
  if (suspect) console.log(`  TYPE_SUSPECT rows         ${suspect}   (releaseType() substring-matched 'live')`);

  const outFile = path.resolve(process.cwd(), OUT);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(reports, null, 2));
  console.log(`\n  full report → ${OUT}`);
}

// Only run when invoked directly. titleVariants/titlesMatch are exported so they can be tested
// against real data, and importing this file to reach them must not kick off a 5,000-artist sweep.
// Same guard mb-qc.ts uses.
if (process.argv[1] && process.argv[1].endsWith('resolve-stub-itunes.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
