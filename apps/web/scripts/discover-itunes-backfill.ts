/**
 * Backfill lane — recovers an owned artist's OLD releases that MusicBrainz never cataloged but
 * iTunes/Apple Music has. Sibling of the RECENCY lane (discover-itunes-recency.ts): same source,
 * same writers, same provenance — but NOT recency-scoped. Recency bridges *new* releases MB lags on;
 * backfill reaches *back* over the whole discography for MB coverage gaps (esp. Korean underground:
 * e.g. P-Type — MB has 7 of his ~35 iTunes releases; "Soulfire" 2006 and "Hardboiled Café" 2022 are
 * full albums MB simply lacks).
 *
 * A whole-discography sweep is FAR more dangerous than a recent-window sweep, so this lane layers
 * SIX guards on top of the recency gate. Order matters: each is "missing > wrong" — when unsure we
 * SKIP (and surface for manual review), never ingest.
 *
 *   1. ARTIST-IDENTITY CONFIRMATION. iTunes has same-named artists (two "P-Type": hip-hop 306908092
 *      AND dance 1117474757). Resolving the wrong one would ingest a stranger's entire catalog under
 *      our artist. So: resolve candidate iTunes artistId(s) from several distinctive seed titles,
 *      fetch each discography, and require ≥2 of our existing release-group titles (and ≥25%) to
 *      appear in it. No confident identity → ABORT this artist, ingest nothing.
 *   2. PRIMARY-ARTIST ONLY. Skip iTunes collections whose primary artistId ≠ the confirmed one
 *      (guest features / VA comps), plus a "(feat. <ourArtist>)" title heuristic.
 *   3. STRONG DEDUP KEY. iTunes K-pop/HH titles carry release-TYPE suffixes MB omits ("... - Single",
 *      "... - The 3rd Mini Album - EP"); strip those too before keying, so cross-source titles match
 *      and we don't re-ingest what we already have under a cleaner MB title.
 *   4. WITHIN-iTUNES DEDUP. iTunes itself lists the same release twice ("Soulfire" AND
 *      "Soulfire - Single"); collapse candidates by key+near-date, keep the fullest edition.
 *   5. NEAR-DATE SUSPECT GUARD. A candidate whose date is within ±14d of one of our existing groups
 *      but whose title didn't key-match is the classic romanized-vs-Hangul SAME release. Flagged
 *      SUSPECT and NOT auto-ingested (surfaced for eyeballing) unless --ingest-suspects.
 *   6. ALBUMS/EPS BY DEFAULT. The actual gap is albums/EPs; singles flood the catalog and are the
 *      riskiest to dedup. Default classification = album/ep only; --include-singles to widen.
 *
 * Provenance identical to recency: new rows get source='itunes', mb_release_group_id NULL, attached
 * to the KNOWN owned-artist uuid (never findOrCreateArtist → no dup artist), so reconcile-itunes-mb.ts
 * links them onto MB once it catches up and the MB-later duplicate never forms.
 *
 *   npx tsx --env-file=.env.local scripts/discover-itunes-backfill.ts --artist="P-Type"        # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-itunes-backfill.ts --limit=20               # REPORT ONLY (KR)
 *   npx tsx --env-file=.env.local scripts/discover-itunes-backfill.ts --artist="P-Type" --include-singles
 *   npx tsx --env-file=.env.local scripts/discover-itunes-backfill.ts --artist="P-Type" --ingest   # WRITES
 *
 * DEFAULT IS REPORT-ONLY. Writing requires --ingest. Suspects need --ingest-suspects on top.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getDB, releaseGroupKey, stripEditionSuffix, normalizeStr, createIngestContext,
  findOrCreateReleaseGroup, ingestEdition, releaseType, artworkUrl, mapGenre, detectLanguage,
  type AlbumInput, type DB,
} from './itunes-ingest-core';
import {
  searchAlbum, searchArtist, fetchDiscography, fetchAlbumTracks, ItunesBlockedError, resetBlock,
  type ItunesAlbum,
} from './itunes-client';

// ── Strong key: releaseGroupKey (strips deluxe/remaster/…) PLUS iTunes release-type suffixes. ──
// "2 Years, Pt. 1 - Single" → "2 years pt 1"; "MY WORLD - The 3rd Mini Album - EP" → "my world".
export function backfillKey(title: string): string {
  const stripped = (title ?? '')
    .replace(/\s*[-–—]\s*the\s+\d+(st|nd|rd|th)\s+(full[- ]?length\s+|mini\s+|single\s+)?(album|ep|mixtape|lp)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(ep|single|lp|mixtape|mini album|album)\s*$/i, '');
  return releaseGroupKey(stripped);
}

const DAY = 86_400_000;
const daysApart = (a: string | null, b: string | null) =>
  (!a || !b) ? Infinity : Math.abs((Date.parse(a) - Date.parse(b)) / DAY);

export type Classification = 'album' | 'ep' | 'single';
function classify(trackCount: number, name: string): Classification {
  const t = releaseType(trackCount ?? 0, name);
  if (t === 'Single') return 'single';
  if (t === 'EP') return 'ep';
  return 'album'; // Album/Live/Compilation/Soundtrack all count as full releases for the gap
}

export type Decision =
  | 'ingest'            // confidently missing → ingest (or would, in report mode)
  | 'have'             // matches an existing group (title-key or exact date) → skip
  | 'skip-single'      // is a single and --include-singles off
  | 'skip-feature'     // primary artist ≠ our artist (guest feature / VA)
  | 'skip-noncore'     // live/remix/dj-mix — excluded to match the MB composition policy
  | 'skip-itunes-dup'  // duplicate of another iTunes candidate this run
  | 'suspect';         // near-date-but-different-title (possible same release) → manual review

// Match the MB composition filter (mb-ingest.ts shouldIngestRG / SKIP_SECONDARY): the catalog keeps
// album/ep/single (+compilation/soundtrack) but drops live & remix/dj-mix. iTunes gives no secondary
// types, so detect from the title (+ releaseType's own 'Live' classification). Errs toward exclusion.
const REMIX_RE = /\b(remix(?:es)?|dj[- ]?mix)\b/i;
// High-precision live markers — catches live releases releaseType() misses (a ≤6-track live EP is
// classified 'EP' before its 'Live' check runs, e.g. "BoA THE LIVE 2018 ... - EP"). Deliberately
// NOT a bare /\blive\b/ so studio titles like "Live Your Life" / "Live and Let Die" aren't excluded.
const LIVE_RE = /\bunplugged\b|[([]\s*live\s*[)\]]|\bthe\s+live\b|\blive\s+(?:at|in|on|tour|concert|\d{4})\b|[-–—]\s*live\b|\blive\s*[-–—]\s*(?:ep|album|single)\b|\blive\s*$/i;
// Karaoke/altered-audio noise editions (dup versions of a real release). Mirrors itunes-client's
// NOISE_RE but applies at ANY track count — a multi-track "... [Sped Up Pack]" slips its ≤3-track
// gate. NOT full-word "instrumental" on purpose: legit instrumental beat albums exist (esp. KR hip-hop).
// "MR"/"inst" (Korean karaoke markers) only in bracketed/suffixed form, so "Mr. Brightside" (Mister)
// and "Instinct" aren't caught. sped-up/slowed/karaoke/off-vocal are unambiguous → matched broadly.
const NOISE_RE = /\bsped[- ]?up\b|\bslowed\b|\bkaraoke\b|\boff[- ]?vocal\b|[([]\s*(?:mr|inst\.?)\s*[)\]]|[-–—]\s*(?:mr|inst\.?)\b|\b(?:mr|inst\.?)\s+(?:ver\.?|version)\b/i;
function isNonCore(trackCount: number, name: string): boolean {
  const n = name ?? '';
  return releaseType(trackCount ?? 0, n) === 'Live' || REMIX_RE.test(n) || LIVE_RE.test(n) || NOISE_RE.test(n);
}

export interface BackfillCandidate {
  collectionId: number;
  title: string;
  date: string;
  trackCount: number;
  classification: Classification;
  key: string;
  isPrimary: boolean;
  decision: Decision;
  reason: string;
}

export interface BackfillResult {
  resolved: boolean;              // resolved an iTunes artistId at all
  identityConfirmed: boolean;     // overlap gate passed
  resolvedArtistId: number | null;
  ourCount: number;
  overlap: number;                // how many of our titles appear in the resolved discography
  candidates: BackfillCandidate[];
  ingested: number;
  abortReason?: string;
}

export interface BackfillArtist { id: string; name: string; name_native: string | null; native_language: string | null }

export interface BackfillOpts {
  ingest: boolean;
  includeSingles: boolean;
  ingestSuspects: boolean;
  country?: string;
  minOverlap?: number;            // absolute floor of matching titles (default 2)
  suspectDays?: number;           // near-date window for the suspect guard (default 14)
}

// Seeds resolve the iTunes artistId via album search (needed for KR-native-name artists whose
// artist-entity search is broken). Generic titles (tour/collection/"Nth mini album") match poorly,
// so prefer DISTINCTIVE real album titles; fall back to generic only if nothing else exists.
const GENERIC_SEED_RE = /\b(collection|collections|best|greatest|tour|in japan|in korea|global|repackage|mini album|full album|\d+(st|nd|rd|th)|vol\.?\s*\d)\b/i;
function seedTitles(ours: { title: string; native_title: string | null }[]): string[] {
  const cand = new Set<string>();
  for (const r of ours) {
    if (r.native_title) cand.add(r.native_title);
    if (r.title) cand.add(r.title);
  }
  const all = [...cand].filter(t => t && t.trim().length >= 2);
  const distinctive = all.filter(t => !GENERIC_SEED_RE.test(t));
  const generic = all.filter(t => GENERIC_SEED_RE.test(t));
  // Distinctive first, shorter-and-cleaner before very long (long titles are usually tour/edition
  // names). Generic titles appended as a last resort.
  return [...distinctive.sort((a, b) => a.length - b.length), ...generic].slice(0, 5);
}

/**
 * Scan ONE owned artist's whole iTunes discography and (optionally) ingest confidently-missing
 * albums/EPs. Pure-ish: in report mode (ingest:false) writes nothing. Returns a full per-candidate
 * decision trace so the test harness / CLI can eyeball every call.
 */
export async function scanArtistBackfill(
  db: DB, a: BackfillArtist, opts: BackfillOpts,
): Promise<BackfillResult> {
  const minOverlap = opts.minOverlap ?? 2;
  const suspectDays = opts.suspectDays ?? 14;
  const nativeLang = a.native_language ?? (opts.country === 'KR' ? 'ko' : null);
  const empty: BackfillResult = { resolved: false, identityConfirmed: false, resolvedArtistId: null, ourCount: 0, overlap: 0, candidates: [], ingested: 0 };

  // Our catalog for this artist → dedup signals.
  const { data: oursRaw } = await db.from('release_groups')
    .select('title, native_title, first_release_date').eq('primary_artist_id', a.id);
  const ours = (oursRaw ?? []) as { title: string; native_title: string | null; first_release_date: string | null }[];
  if (ours.length === 0) return { ...empty, abortReason: 'no owned release-groups' };

  const ourKeys = new Set<string>();
  const ourDates: string[] = [];
  for (const r of ours) {
    if (r.title) ourKeys.add(backfillKey(r.title));
    if (r.native_title) ourKeys.add(backfillKey(r.native_title));
    if (r.first_release_date) ourDates.push(r.first_release_date);
  }

  // ── GUARD 1: resolve candidate iTunes artistId(s), then confirm identity by overlap ──
  // Two candidate sources (both still gated by the overlap check below, so an extra source only adds
  // RECALL, never risk):
  //   • direct artist search on each name form — resolves Latin-branded popular acts in one call
  //     (2NE1, nafla), which the old album-only path missed because it searched "{title} {native}".
  //   • album-title search × each name form — resolves KR-native-name artists whose artist-entity
  //     search is broken (recency memory), by finding a known album and reading its artistId.
  const nameForms = [a.name, a.name_native].filter((v): v is string => !!v && v.trim().length > 0);
  const candidateIds: number[] = [];
  const addId = (id?: number | null) => { if (id && !candidateIds.includes(id)) candidateIds.push(id); };

  for (const nm of nameForms) {
    if (candidateIds.length >= 3) break;
    const hit = await searchArtist(nm);
    addId(hit?.artistId);
  }
  const seeds = seedTitles(ours);
  for (const seed of seeds) {
    if (candidateIds.length >= 3) break;
    for (const nm of nameForms) {
      const hit = await searchAlbum(seed, nm, nativeLang);
      if (hit?.artistId) { addId(hit.artistId); break; }
    }
  }
  if (candidateIds.length === 0) return { ...empty, abortReason: 'could not resolve any iTunes artistId' };

  // Pick the candidate whose discography best overlaps our catalog. This is what stops a wrong
  // same-named artist: a mis-resolved id has ~0 overlap and loses / fails the gate.
  let best: { artistId: number; discography: ItunesAlbum[]; overlap: number } | null = null;
  for (const artistId of candidateIds) {
    const disc = (await fetchDiscography(artistId)).filter(al => al.artistId === artistId);
    const discKeys = new Set(disc.map(al => backfillKey(al.collectionName)));
    let overlap = 0;
    for (const k of ourKeys) if (discKeys.has(k)) overlap++;
    if (!best || overlap > best.overlap) best = { artistId, discography: disc, overlap };
    if (overlap >= Math.max(minOverlap, Math.ceil(ourKeys.size * 0.5))) break; // clearly right → stop
  }
  if (!best) return { ...empty, abortReason: 'could not resolve any iTunes artistId' };

  const ourKeyCount = ourKeys.size;
  const identityConfirmed = best.overlap >= minOverlap && best.overlap >= Math.ceil(Math.min(ourKeyCount, 6) * 0.25);
  const baseResult: BackfillResult = {
    resolved: true, identityConfirmed, resolvedArtistId: best.artistId,
    ourCount: ours.length, overlap: best.overlap, candidates: [], ingested: 0,
  };
  if (!identityConfirmed) {
    return { ...baseResult, abortReason: `identity unconfirmed (overlap ${best.overlap}/${ourKeyCount} of our titles; need ≥${minOverlap})` };
  }

  // ── Classify every discography item into a decision ──────────────────────────
  const ourArtistNorm = normalizeStr(a.name);
  const ourNativeNorm = a.name_native ? normalizeStr(a.name_native) : null;
  const candidates: BackfillCandidate[] = [];

  for (const al of best.discography) {
    const date = (al.releaseDate ?? '').slice(0, 10);
    const key = backfillKey(al.collectionName);
    const cls = classify(al.trackCount ?? 0, al.collectionName);
    const isPrimary = al.artistId === best.artistId;

    let decision: Decision = 'ingest';
    let reason = 'no title-key or date twin';

    // GUARD 2: features / non-primary. (Discography already filters to isPrimary, but keep the
    // title heuristic for "(feat. <ourArtist>)" collections iTunes still files under the artistId.)
    const nameNorm = normalizeStr(al.collectionName);
    const featOfUs = /\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(al.collectionName) &&
      (nameNorm.includes(ourArtistNorm) || (ourNativeNorm != null && nameNorm.includes(ourNativeNorm)));
    if (!isPrimary) { decision = 'skip-feature'; reason = 'primary artistId ≠ ours'; }
    else if (featOfUs) { decision = 'skip-feature'; reason = 'title credits us as a feature'; }
    // Already have it: strong title-key twin, OR exact release-date twin.
    else if (ourKeys.has(key)) { decision = 'have'; reason = 'title-key matches an existing group'; }
    else if (date && ourDates.includes(date)) { decision = 'have'; reason = `exact release-date twin (${date})`; }
    // Non-core (live/remix/dj-mix) — excluded to match the MB composition policy.
    else if (isNonCore(al.trackCount ?? 0, al.collectionName)) { decision = 'skip-noncore'; reason = 'live/remix/dj-mix (catalog policy excludes)'; }
    // GUARD 5: near-date-but-different-title → possible romanized/Hangul same release → suspect.
    else if (date && ourDates.some(d => daysApart(d, date) <= suspectDays)) {
      const near = ourDates.find(d => daysApart(d, date) <= suspectDays)!;
      decision = 'suspect'; reason = `date within ±${suspectDays}d of existing group (${near}) but title differs — possible same release`;
    }
    // GUARD 6: singles.
    else if (cls === 'single' && !opts.includeSingles) { decision = 'skip-single'; reason = 'single (use --include-singles)'; }

    candidates.push({ collectionId: al.collectionId, title: al.collectionName, date, trackCount: al.trackCount ?? 0, classification: cls, key, isPrimary, decision, reason });
  }

  // ── GUARD 4: within-iTunes dedup among the would-INGEST set. ──
  // iTunes lists the same release twice ("Soulfire" AND "Soulfire - Single"). Collapse candidates
  // sharing a key within ±suspectDays; keep the BEST edition, demote the rest to skip-itunes-dup.
  // "Best" = most tracks → cleanest title (no "- Single/EP/…" mislabel) → earliest date.
  const TYPE_SUFFIX_RE = /[-–—]\s*(single|ep|lp|album|mixtape|mini album)\s*$/i;
  const hasTypeSuffix = (t: string) => TYPE_SUFFIX_RE.test((t ?? '').trim());
  const better = (a: BackfillCandidate, b: BackfillCandidate): BackfillCandidate => {
    if (a.trackCount !== b.trackCount) return a.trackCount > b.trackCount ? a : b;      // fuller wins
    const aSfx = hasTypeSuffix(a.title), bSfx = hasTypeSuffix(b.title);
    if (aSfx !== bSfx) return aSfx ? b : a;                                             // cleaner title wins
    if (a.date !== b.date) return (a.date || '9999') < (b.date || '9999') ? a : b;      // earlier wins
    return a;
  };
  const kept: BackfillCandidate[] = [];
  for (const c of candidates.filter(c => c.decision === 'ingest')) {
    const twinIdx = kept.findIndex(k => k.key === c.key && daysApart(k.date, c.date) <= suspectDays);
    if (twinIdx === -1) { kept.push(c); continue; }
    const twin = kept[twinIdx];
    const winner = better(twin, c);
    const loser = winner === twin ? c : twin;
    loser.decision = 'skip-itunes-dup';
    loser.reason = `duplicate of "${winner.title}" (${winner.date}, ${winner.trackCount}t) in this run`;
    kept[twinIdx] = winner;
  }

  baseResult.candidates = candidates;

  // ── Ingest (only the survivors) ──────────────────────────────────────────────
  const toIngest = candidates.filter(c =>
    c.decision === 'ingest' || (opts.ingestSuspects && c.decision === 'suspect'));
  if (!opts.ingest || toIngest.length === 0) {
    baseResult.ingested = 0;
    return baseResult;
  }

  const ctx = createIngestContext(db, { dryRun: false, withTracks: true, skipSingles: false });
  let ingested = 0;
  for (const c of toIngest) {
    const al = best.discography.find(x => x.collectionId === c.collectionId)!;
    const rtype = releaseType(al.trackCount ?? 0, al.collectionName);
    const album: AlbumInput = {
      collectionId: al.collectionId, artistId: al.artistId, artistName: al.artistName,
      collectionName: al.collectionName, releaseDate: al.releaseDate, primaryGenreName: al.primaryGenreName,
      trackCount: al.trackCount, artworkUrl100: al.artworkUrl100, country: al.country,
    };
    const group = await findOrCreateReleaseGroup(ctx, {
      primaryArtistId: a.id, artistDisplay: al.artistName, title: al.collectionName,
      appReleaseType: rtype, firstReleaseDate: c.date || null,
      coverUrl: artworkUrl(al.artworkUrl100 ?? '') || null, genre: mapGenre(al.primaryGenreName ?? '') || null,
    });
    const tracks = await fetchAlbumTracks(al.collectionId, nativeLang);
    const native = detectLanguage(al.collectionName)
      ? { titleNative: al.collectionName, artistNative: a.name_native ?? al.artistName, nativeLanguage: detectLanguage(al.collectionName)! }
      : null;
    const result = await ingestEdition(ctx, { album, primaryArtistId: a.id, group, native, tracks });
    if (result === 'inserted') {
      // Provenance: tag new rows only (is('source', null) never relabels MB rows).
      await db.from('release_groups').update({ source: 'itunes' }).eq('id', group.id).is('source', null);
      await db.from('releases').update({ source: 'itunes' }).eq('release_group_id', group.id).is('source', null);
      ingested++;
    }
  }
  if (ingested > 0) {
    await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
  }
  baseResult.ingested = ingested;
  return baseResult;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
function fmtCand(c: BackfillCandidate): string {
  const tag = {
    ingest: '➕ INGEST     ', have: '✓ have       ', 'skip-single': '· single     ',
    'skip-feature': '· feature    ', 'skip-noncore': '· noncore    ',
    'skip-itunes-dup': '· itunes-dup ', suspect: '⚠ SUSPECT    ',
  }[c.decision];
  return `    ${tag} ${(c.date || '????-??-??').padEnd(10)} ${String(c.trackCount).padStart(2)}t ${c.classification.padEnd(6)} | ${c.title}\n                    ↳ ${c.reason}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const SWEEP_STATE = path.resolve('scripts/backfill-sweep-state.json');
const BLOCK_COOLDOWN_MS = 20 * 60 * 1000; // iTunes IP-block back-off (matches the recency/gapfill lanes)
const readCursor = (): string => { try { return JSON.parse(fs.readFileSync(SWEEP_STATE, 'utf8')).afterId ?? ''; } catch { return ''; } };
const saveCursor = (id: string) => { try { fs.writeFileSync(SWEEP_STATE, JSON.stringify({ afterId: id })); } catch { /* best-effort */ } };

// One-line-per-artist log for the sweep (keeps 800+ rows readable). Ingested titles inlined.
function logArtist(r: BackfillResult, name: string, ingest: boolean): void {
  if (!r.identityConfirmed) {
    console.log(`  ${name.padEnd(26)} ✗ ${r.abortReason ?? 'unresolved'}`);
    return;
  }
  const ing = r.candidates.filter(c => c.decision === 'ingest');
  const sus = r.candidates.filter(c => c.decision === 'suspect').length;
  const titles = ing.map(c => `${c.date} ${c.title}`).join('; ');
  const verb = ingest ? `+${r.ingested}` : `→${ing.length}`;
  console.log(`  ${name.padEnd(26)} ok ${String(r.overlap).padStart(2)}/${String(r.ourCount).padStart(2)} ${verb}${sus ? ` ~${sus}?` : ''}${titles ? '  ' + titles : ''}`);
}

async function runSingle(db: DB, artist: string, opts: BackfillOpts, ingest: boolean, includeSingles: boolean, ingestSuspects: boolean): Promise<void> {
  const { data: rows } = await db.from('artists').select('id, name, name_native, native_language')
    .eq('ingest_state', 'tracks_done').ilike('name', artist).limit(1);
  const a = rows?.[0] as BackfillArtist | undefined;
  if (!a) { console.log(`No tracks_done artist named "${artist}".`); return; }
  console.log(`${ingest ? '⚠ INGESTING (LIVE)' : 'REPORT-ONLY'} — ${a.name}`);
  console.log(`singles: ${includeSingles ? 'included' : 'excluded'} · suspects: ${ingestSuspects ? 'INGESTED' : 'review-only'}\n`);
  const r = await scanArtistBackfill(db, a, opts);
  if (!r.identityConfirmed) {
    console.log(`── ${a.name}  ✗ ABORT: ${r.abortReason ?? 'unresolved'}${r.resolvedArtistId ? ` (iTunes ${r.resolvedArtistId}, overlap ${r.overlap}/${r.ourCount})` : ''}`);
    return;
  }
  const wi = r.candidates.filter(c => c.decision === 'ingest').length;
  const sus = r.candidates.filter(c => c.decision === 'suspect').length;
  console.log(`── ${a.name}  ✓ identity ok (iTunes ${r.resolvedArtistId}, overlap ${r.overlap}/${r.ourCount}) — ${wi} to ingest, ${sus} suspect${ingest ? `, ${r.ingested} ingested` : ''}`);
  for (const c of r.candidates) {
    const quiet = c.decision === 'have' || c.decision === 'skip-single' || c.decision === 'skip-feature' || c.decision === 'skip-noncore' || c.decision === 'skip-itunes-dup';
    if (!quiet || process.env.VERBOSE) console.log(fmtCand(c));
  }
  console.log(`\n=== SUMMARY (${ingest ? 'LIVE — wrote' : 'REPORT-ONLY'}) === would-ingest ${wi} · suspects ${sus}${ingest ? ` · INGESTED ${r.ingested}` : ''}`);
}

// Resumable, self-throttling sweep over a whole country's tracks_done artists. One command chews
// through all of them over however long it takes: it advances a persisted id cursor per artist (a
// crash/kill resumes where it stopped), and on an iTunes IP-block it BACKS OFF and retries rather
// than dying. --limit caps THIS invocation (for a review batch); omit it to run to completion.
async function runSweep(
  db: DB, country: string, opts: BackfillOpts, ingest: boolean, includeSingles: boolean,
  ingestSuspects: boolean, limit: number | null, reset: boolean,
): Promise<void> {
  if (reset) { saveCursor(''); console.log('cursor reset.'); }
  const { count: total } = await db.from('artists').select('*', { count: 'exact', head: true })
    .eq('country', country).eq('ingest_state', 'tracks_done');
  const startAfter = readCursor();
  console.log(`${ingest ? '⚠ INGESTING (LIVE)' : 'REPORT-ONLY'} SWEEP — ${country} tracks_done (${total ?? '?'} total)${limit ? `, cap ${limit} this run` : ' — full sweep'}`);
  console.log(`resume cursor: ${startAfter ? startAfter.slice(0, 8) + '…' : '(start)'} · singles: ${includeSingles ? 'included' : 'excluded'} · suspects: ${ingestSuspects ? 'INGESTED' : 'review-only'}\n`);

  let processed = 0, confirmed = 0, aborted = 0, ingestedTot = 0, suspectsTot = 0, blocks = 0, errors = 0;
  for (;;) {
    if (limit !== null && processed >= limit) { console.log(`\n(reached --limit ${limit}; cursor saved, re-run to continue)`); break; }
    const after = readCursor();
    const batchSize = limit !== null ? Math.min(25, limit - processed) : 25;
    let q = db.from('artists').select('id, name, name_native, native_language')
      .eq('country', country).eq('ingest_state', 'tracks_done').order('id').limit(batchSize);
    if (after) q = q.gt('id', after); // empty cursor → start from the beginning (gt '' is an invalid uuid)
    const { data: batch, error } = await q;
    if (error) throw new Error(error.message);
    if (!batch?.length) { console.log('\n✓ sweep complete — whole set processed.'); saveCursor(''); break; }

    let blockedThisBatch = false;
    for (const a of batch) {
      if (limit !== null && processed >= limit) break;
      try {
        const r = await scanArtistBackfill(db, a as BackfillArtist, opts);
        logArtist(r, (a as any).name, ingest);
        if (r.identityConfirmed) { confirmed++; ingestedTot += r.ingested; suspectsTot += r.candidates.filter(c => c.decision === 'suspect').length; }
        else aborted++;
        saveCursor(a.id as string); // advance only after a clean scan
        processed++;
        await sleep(300);
      } catch (e) {
        if (e instanceof ItunesBlockedError) {
          blocks++; resetBlock();
          console.log(`  ⏸ iTunes IP-blocked (#${blocks}) — backing off ${BLOCK_COOLDOWN_MS / 60000}m, will retry ${(a as any).name}`);
          await sleep(BLOCK_COOLDOWN_MS);
          blockedThisBatch = true; // do NOT advance cursor — re-fetch from same point and retry
          break;
        }
        // Non-block error: log, skip this artist (advance so one bad row can't wedge the sweep).
        errors++;
        console.log(`  ! ${(a as any).name}: ${(e as Error).message.slice(0, 80)}`);
        saveCursor(a.id as string); processed++;
      }
    }
    if (blockedThisBatch) continue; // retry the same cursor position
  }

  console.log(`\n=== SWEEP SUMMARY (${ingest ? 'LIVE — wrote to catalog' : 'REPORT-ONLY'}) ===`);
  console.log(`Processed ${processed} · identity confirmed ${confirmed} · aborted ${aborted} · errors ${errors} · iTunes blocks ${blocks}`);
  console.log(`${ingest ? 'Ingested' : 'Would-ingest'} (albums/EPs${includeSingles ? '+singles' : ''}): ${ingestedTot} · suspects (review-only): ${suspectsTot}`);
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const INGEST = args.includes('--ingest');
  const INCLUDE_SINGLES = args.includes('--include-singles');
  const INGEST_SUSPECTS = args.includes('--ingest-suspects');
  const RESET = args.includes('--reset');
  const COUNTRY = arg('--country') ?? 'KR';
  const ARTIST = arg('--artist') ?? null;
  const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : null;

  const db = getDB();
  const opts: BackfillOpts = { ingest: INGEST, includeSingles: INCLUDE_SINGLES, ingestSuspects: INGEST_SUSPECTS, country: COUNTRY };

  if (ARTIST) await runSingle(db, ARTIST, opts, INGEST, INCLUDE_SINGLES, INGEST_SUSPECTS);
  else await runSweep(db, COUNTRY, opts, INGEST, INCLUDE_SINGLES, INGEST_SUSPECTS, LIMIT, RESET);
}

if (process.argv[1]?.endsWith('discover-itunes-backfill.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
