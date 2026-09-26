/**
 * MusicBrainz resolution + mapping helpers (RENOVATION_PLAN §4).
 * Resolver + type mapping live here so the coverage gate and the (future) full
 * DB-writing ingest share identical logic. Full ingest is added after the §12.3 gate.
 */

import { randomUUID } from 'crypto';
import {
  searchArtists, getArtist, browseReleaseGroups, browseArtistReleases, browseArtistReleasesDetailed,
  countArtistReleaseGroups,
  type MbArtistCandidate, type MbArtistDetail, type MbReleaseGroup, type MbArtistRelease, type MbTrack,
  type MbCredit,
} from './mb-client';
import { getDB, normalizeStr, detectLanguage, type DB } from './itunes-ingest-core';
import { MB_ARTIST_OVERRIDES } from './mb-overrides';

export { detectLanguage, getDB };
export type { DB };

// MusicBrainz special-purpose "artists" — placeholders, NOT real people/groups. "Various
// Artists" alone carries 300k+ releases; resolving a queue name to one (e.g. "Ray" →
// Various Artists) makes the MB worker crawl a junk mega-catalog for hours and pollutes the
// catalog with compilations. Never resolve to, nor ingest, these MBIDs.
export const SPECIAL_MBIDS = new Set<string>([
  '89ad4ac3-39f7-470e-963a-56509c546377', // Various Artists
  '125ec42a-7229-4250-afc5-e057484327fe', // [unknown]
  'f731ccc4-e22a-43af-a747-64213329e088', // [anonymous]
  'eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61', // [no artist]
  '33cf029c-63b0-41a0-9855-be2a3665fb3b', // [data]
  '9be7f096-97ec-4615-8957-8d40b5dcbc41', // [traditional]
]);

// Set once if the release_group_artists table is absent (migration 20260630000001 not applied)
// so we stop attempting credit writes for the rest of the run instead of throwing per RG.
let creditsTableMissing = false;

// Above this many release-groups an artist is a composer/Various-Artists-tier entity (Mozart has
// thousands): ingesting them floods the catalog with classical comps and stalls the watchdog.
export const MAX_INGEST_RGS = 800;
export class HeavilyFeaturedError extends Error {
  constructor(message: string) { super(message); this.name = 'HeavilyFeaturedError'; }
}

// MB release-group primary/secondary types → our `release_group_type` enum.
export function mbTypeToGroupType(primaryType: string | null, secondaryTypes: string[]): string {
  const s = (secondaryTypes ?? []).map(x => x.toLowerCase());
  if (s.includes('soundtrack')) return 'soundtrack';
  if (s.includes('compilation')) return 'compilation';
  if (s.includes('live')) return 'live';
  switch ((primaryType ?? '').toLowerCase()) {
    case 'album':  return 'album';
    case 'ep':     return 'ep';
    case 'single': return 'single';
    default:       return 'other';
  }
}

// Rough script classifier for an alias (drives alias.script + native-title detection).
export function scriptOf(s: string): string {
  if (/[가-힣ᄀ-ᇿ]/.test(s)) return 'hangul';
  if (/[぀-ゟ゠-ヿ]/.test(s)) return 'kana';
  if (/[一-鿿]/.test(s)) return 'han';
  return 'latin';
}

export interface ResolveResult {
  best: MbArtistCandidate | null;
  needsReview: boolean;           // exists but couldn't confirm (generic name, wrong region) → don't false-merge
  ambiguous: boolean;             // 2+ near-tied candidates → review / save-all (e.g. two "Crush")
  candidates: MbArtistCandidate[];
}

/**
 * Resolve a discovered artist name → the best MB candidate (by MBID).
 * Order: exact normalized-name match → score≥90 → top-3. Region hint:
 *   - if region-matching candidates exist in the pool, restrict to them;
 *   - else if the pool is a *fallback* (non-exact name), refuse to guess →
 *     needsReview (avoids "Dean"→Dean Martin false-merges; missing > wrong);
 *   - else (exact-name pool, MB country often null) keep it as lower-confidence.
 */
export async function resolveArtist(name: string, region: string | null = null): Promise<ResolveResult> {
  // Manual override for generic names the resolver can't disambiguate.
  const override = MB_ARTIST_OVERRIDES[normalizeStr(name)];
  if (override) {
    return {
      best: { id: override, name, score: 100, type: null, country: region, area: null, disambiguation: '(manual override)', aliases: [] },
      needsReview: false, ambiguous: false, candidates: [],
    };
  }

  const candidates = (await searchArtists(name, 8)).filter(c => !SPECIAL_MBIDS.has(c.id));
  if (candidates.length === 0) return { best: null, needsReview: false, ambiguous: false, candidates: [] };

  const norm = normalizeStr(name);
  // Exact match on the primary name OR any alias/sort-name. Critical for non-Latin
  // queries: a Korean name like "우디" never equals a candidate's romanized primary
  // ("Woody"), so a name-only check fell through to the fuzzy score≥90 branch and
  // grabbed a wrong higher-scored artist (e.g. "우디"→"Woodie Gochild"). An exact alias
  // hit is a far stronger signal than a fuzzy score on a *different* artist.
  const exact = candidates.filter(c =>
    normalizeStr(c.name) === norm || (c.aliases ?? []).some(a => normalizeStr(a) === norm),
  );
  const fromExact = exact.length > 0;

  // Short non-Latin guard: a 2–3 char Hangul/CJK query fuzzily substring-matches longer
  // artist names ("우디" ⊂ "우디 고차일드"), so MB returns the wrong artist at score 100
  // while the real one is lower-scored or unreachable (its match sits in disambiguation,
  // which the search query can't see). With no exact name/alias hit we can't trust the
  // fuzzy pick → flag for review (→ mb-overrides) rather than silently shadow a real
  // artist. Latin queries keep the old fuzzy behaviour (not prone to this collision).
  if (!fromExact) {
    const cjkLen = (name.match(/[가-힣぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
    if (cjkLen > 0 && cjkLen <= 3) {
      return { best: null, needsReview: true, ambiguous: false, candidates };
    }
  }

  let pool = exact;
  if (pool.length === 0) pool = candidates.filter(c => c.score >= 90);
  if (pool.length === 0) pool = candidates.slice(0, 3);

  if (region) {
    const regional = pool.filter(c => c.country === region);
    const unknown  = pool.filter(c => !c.country); // MB country often unfilled for Korean artists
    if (regional.length > 0) {
      pool = regional;
    } else if (unknown.length > 0) {
      pool = unknown;            // prefer unconfirmed-region over a confirmed-wrong-region match
    } else {
      // every candidate is a CONFIRMED different region → don't false-merge (e.g. Dean→Dean Martin)
      return { best: null, needsReview: true, ambiguous: false, candidates };
    }
  }

  pool.sort((a, b) => b.score - a.score);

  // SEVERAL CANDIDATES UNDER THE SAME NAME: ASK WHICH ONE HAS MUSIC.
  //
  // MB's `score` is a string-match score, so every candidate whose name equals the query scores 100
  // and the sort above leaves their order arbitrary. That is how a miss for "Jessie Ware" -- an
  // artist we already held with 47 release groups -- resolved to a DIFFERENT MusicBrainz "Jessie
  // Ware" with none, got queued, ingested as `0 groups, 0 recordings`, and added a second, empty
  // Jessie Ware to the catalogue. The Internet, Ken Carson, Lukas Graham and Ruel went the same way;
  // 42 such duplicates existed by 2026-09-26. Nothing in the pick asked the one question that
  // distinguishes a real artist from a stub entity, so ask it: one MB request per tied candidate
  // (limit=1, so it is a count and not a listing).
  //
  // This also turns the `ambiguous` bail-out from a dead end into an answer. Two entities named
  // "Crush" where one has 30 release groups and the other none are not genuinely ambiguous, and
  // refusing to choose left the artist absent. Ties are only declared when the probe cannot separate
  // them -- both at zero, or both holding music, which is the case that really does need review.
  if (pool.length > 1 && pool[1].score >= pool[0].score - 3) {
    const tied = pool.filter(c => c.score >= pool[0].score - 3).slice(0, 4);
    const counts = new Map<string, number>();
    for (const c of tied) counts.set(c.id, (await countArtistReleaseGroups(c.id)) ?? 0);
    const ranked = [...tied].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    const top = counts.get(ranked[0].id) ?? 0;
    const second = ranked.length > 1 ? (counts.get(ranked[1].id) ?? 0) : 0;
    // A clear winner: it has music and nothing else tied with it is close.
    if (top > 0 && top > second) return { best: ranked[0], needsReview: false, ambiguous: false, candidates };
    return { best: ranked[0], needsReview: false, ambiguous: true, candidates };
  }

  const best = pool[0];
  return { best, needsReview: false, ambiguous: false, candidates };
}

// ── DB-writing ingest (race-safe via the MBID UNIQUE constraints) ──────────────
// Every entity is found-or-created by its MBID: upsert(onConflict ignore) then
// select. Concurrent workers converge on one row (the UNIQUE constraint arbitrates),
// so no in-process locking is needed and re-runs are idempotent.

function padDate(d: string | null): string | null {
  if (!d) return null;
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  // MB emits partial dates with `??` placeholders for unknown components, e.g.
  // "1994-??-11" or "????-03-01". Postgres rejects those as a date → ingest crash.
  // Normalize: unknown month/day → 01; if a higher component is unknown, lower ones
  // collapse to 01; unknown year → unusable → null.
  const m = d.match(/^(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})$/);
  if (m) {
    const [, y, mo, da] = m;
    if (y === '????') return null;
    const month = mo !== '??' ? mo : '01';
    const day   = (mo !== '??' && da !== '??') ? da : '01';
    return `${y}-${month}-${day}`;
  }
  return d;
}

function pickNative(detail: MbArtistDetail): string | null {
  const cjk = detail.aliases.filter(a => a.locale && ['ko', 'ja', 'zh'].includes(a.locale.split('-')[0]));
  // Prefer a primary Korean alias specifically (this is a Korean-first product) before
  // falling back to a primary Japanese/Chinese one.
  const primary =
    cjk.find(a => a.primary && a.locale?.split('-')[0] === 'ko') ??
    cjk.find(a => a.primary);
  if (primary) return primary.name;
  // No alias explicitly marked primary for a CJK locale — don't guess. MusicBrainz sometimes
  // only has the artist's *legal* name tagged with a ko/ja/zh locale (not their stage name's
  // native-script transliteration), and displaying that instead of the real public name is
  // worse than just falling back to the Latin name (e.g. E SENS → wrongly "강민호" instead of
  // the correct "이센스", which MusicBrainz simply doesn't have on file for this artist).
  if (scriptOf(detail.name) !== 'latin') return detail.name;
  return null;
}

const rankCountry = (c: string | null) => (c === 'KR' ? 0 : c === 'JP' ? 1 : c === 'US' ? 2 : 3);

// Representative edition: Official → earliest date → region KR>JP>US → most complete.
type RepCandidate = { status: string | null; date: string | null; country: string | null; trackCount: number };
function pickRepresentative<T extends RepCandidate>(rs: T[]): T {
  const official = rs.filter(r => r.status === 'Official');
  const pool = official.length ? official : rs;
  return [...pool].sort((a, b) => {
    const da = a.date || '9999', db = b.date || '9999';
    if (da !== db) return da < db ? -1 : 1;
    const r = rankCountry(a.country) - rankCountry(b.country);
    if (r) return r;
    return (b.trackCount || 0) - (a.trackCount || 0);
  })[0];
}

const TITLE_TYPE: Record<string, string> = {
  album: 'Album', ep: 'EP', single: 'Single', compilation: 'Compilation',
  live: 'Live', soundtrack: 'Soundtrack', other: 'Album',
};

async function findOrCreateArtistByMbid(db: DB, detail: MbArtistDetail): Promise<{ id: string; isNew: boolean }> {
  // Fast path / idempotent re-run: already linked?
  const { data: existing } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'musicbrainz').eq('external_id', detail.id).maybeSingle();
  if (existing?.artist_id) {
    // Self-heal a drifted canonical name from MB's CURRENT primary (e.g. "Young B" →
    // "YANGHONGWON"). artists.name was captured once at creation and otherwise never
    // revisited, so a renamed artist silently stayed findable only under the stale name,
    // fully breaking search_artists() for the current one. The `.neq` guard means this is
    // a no-op write when the name is unchanged (no churn on re-polls). name_native/aliases
    // drift is a separate, rarer case left for a dedicated pass.
    if (detail.name) {
      await db.from('artists').update({ name: detail.name })
        .eq('id', existing.artist_id).neq('name', detail.name);
    }
    return { id: existing.artist_id as string, isNew: false };
  }

  // Create the artist row FIRST (artist_external_ids.artist_id has a FK to it), then
  // claim the MBID — PK(source, external_id) arbitrates concurrent claims.
  const id = randomUUID();
  const native = pickNative(detail);
  const { error: insErr } = await db.from('artists').insert({
    id,
    name: detail.name,
    name_native: native,
    native_language: native ? detectLanguage(native) : null,
    country: detail.country,
    disambiguation: detail.disambiguation,
    source_status: 'mb_verified',
    ingest_state: 'resolved',
    cached_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`artist insert "${detail.name}": ${insErr.message}`);

  await db.from('artist_external_ids').upsert(
    { source: 'musicbrainz', external_id: detail.id, artist_id: id },
    { onConflict: 'source,external_id', ignoreDuplicates: true },
  );
  const { data, error } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'musicbrainz').eq('external_id', detail.id).single();
  if (error) throw new Error(`artist external_id resolve ${detail.id}: ${error.message}`);
  const winner = data.artist_id as string;
  if (winner !== id) {
    await db.from('artists').delete().eq('id', id); // lost the race → remove our orphan row
    return { id: winner, isNew: false };
  }

  const seen = new Set<string>();
  const aliasRows = [{ name: detail.name, locale: null as string | null, primary: true }, ...detail.aliases]
    .filter(a => a.name && !seen.has(a.name) && seen.add(a.name))
    .map(a => ({
      artist_id: id, alias: a.name, alias_norm: normalizeStr(a.name),
      locale: a.locale ?? null, script: scriptOf(a.name),
      primary_for_locale: !!a.primary, source: 'musicbrainz',
    }));
  if (aliasRows.length) {
    await db.from('artist_aliases').upsert(aliasRows, { onConflict: 'artist_id,alias', ignoreDuplicates: true });
  }
  return { id, isNew: true };
}

async function findOrCreateReleaseGroup(db: DB, rg: MbReleaseGroup, primaryArtistId: string): Promise<string> {
  const id = randomUUID();
  const { error: upErr } = await db.from('release_groups').upsert({
    id,
    mb_release_group_id: rg.id,
    primary_artist_id: primaryArtistId,
    artist_display: rg.artistCredit || '(unknown)',
    title: rg.title || '(untitled)',
    native_title: scriptOf(rg.title) !== 'latin' ? rg.title : null,
    release_group_type: mbTypeToGroupType(rg.primaryType, rg.secondaryTypes),
    first_release_date: padDate(rg.firstReleaseDate),
    genres: rg.genres.length ? rg.genres : null,
    source: 'musicbrainz',
  }, { onConflict: 'mb_release_group_id', ignoreDuplicates: true });
  if (upErr) throw new Error(`release_group upsert "${rg.title}": ${upErr.message}`);
  const { data, error } = await db.from('release_groups').select('id').eq('mb_release_group_id', rg.id).single();
  if (error) throw new Error(`release_group resolve "${rg.title}": ${error.message}`);
  return data.id;
}

// Lightweight artist row for a CREDITED collaborator we only know by MBID + name (e.g. a feature
// on someone else's album). Returns the existing artist if already ingested, else a 'credit_stub'
// row — clickable, shows the albums it's credited on, and gets fully fleshed out if/when it's
// ingested for real. Returns null when the credit has no MBID (can't be linked).
async function findOrCreateArtistStub(db: DB, mbid: string | null, name: string): Promise<string | null> {
  if (!mbid || SPECIAL_MBIDS.has(mbid)) return null;
  const { data: existing } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'musicbrainz').eq('external_id', mbid).maybeSingle();
  if (existing?.artist_id) return existing.artist_id as string;

  const id = randomUUID();
  const native = scriptOf(name) !== 'latin' ? name : null;
  // 'resolved' = MBID known, discography not ingested. Inert: only 'tracks_done' artists are
  // claimed by the freshness/QC lanes, so a stub is never auto-ingested (queue it to flesh out).
  const { error: insErr } = await db.from('artists').insert({
    id, name, name_native: native, native_language: native ? detectLanguage(native) : null,
    source_status: 'mb_verified', ingest_state: 'resolved', cached_at: new Date().toISOString(),
  });
  if (insErr) throw new Error(`stub artist insert "${name}": ${insErr.message}`);
  await db.from('artist_external_ids').upsert(
    { source: 'musicbrainz', external_id: mbid, artist_id: id },
    { onConflict: 'source,external_id', ignoreDuplicates: true });
  const { data, error } = await db.from('artist_external_ids')
    .select('artist_id').eq('source', 'musicbrainz').eq('external_id', mbid).single();
  if (error) throw new Error(`stub external_id resolve ${mbid}: ${error.message}`);
  const winner = data.artist_id as string;
  if (winner !== id) { await db.from('artists').delete().eq('id', id); return winner; } // lost race
  await db.from('artist_aliases').upsert(
    { artist_id: id, alias: name, alias_norm: normalizeStr(name), script: scriptOf(name), source: 'musicbrainz' },
    { onConflict: 'artist_id,alias', ignoreDuplicates: true });
  return id;
}

// Populate release_group_artists from the ordered MB artist-credit. position 0 is the primary
// (the artist being ingested, for kept RGs). Each credit links to a real/stub artist by MBID;
// free-text credits with no MBID are skipped (their position is left out — gaps are fine).
export async function writeReleaseGroupCredits(
  db: DB, rgId: string, credits: MbCredit[], ingestMbid: string, primaryArtistId: string,
): Promise<void> {
  const rows: { release_group_id: string; artist_id: string; position: number; credited_as: string; join_phrase: string }[] = [];
  for (let i = 0; i < credits.length; i++) {
    const c = credits[i];
    const artistId = c.mbid === ingestMbid ? primaryArtistId : await findOrCreateArtistStub(db, c.mbid, c.name);
    if (!artistId) continue;
    rows.push({ release_group_id: rgId, artist_id: artistId, position: i, credited_as: c.name, join_phrase: c.joinphrase });
  }
  if (rows.length) {
    const { error } = await db.from('release_group_artists').upsert(rows, { onConflict: 'release_group_id,position' });
    if (error) throw new Error(error.message); // missing-table message contains 'release_group_artists' → guarded upstream
  }
}

async function findOrCreateRecording(db: DB, t: MbTrack, primaryArtistId: string): Promise<string> {
  const id = randomUUID();
  const { error: upErr } = await db.from('recordings').upsert({
    id,
    mb_recording_id: t.recordingId,
    primary_artist_id: primaryArtistId,
    artist_display: t.artistCredit || '(unknown)',
    title: t.recordingTitle || t.title || '(untitled)',
    isrc: t.isrcs[0] ?? null,   // first ISRC as a signal; not identity
    duration_ms: t.lengthMs,
    source: 'musicbrainz',
  }, { onConflict: 'mb_recording_id', ignoreDuplicates: true });
  if (upErr) throw new Error(`recording upsert ${t.recordingId}: ${upErr.message}`);
  const { data, error } = await db.from('recordings').select('id').eq('mb_recording_id', t.recordingId).single();
  if (error) throw new Error(`recording resolve ${t.recordingId}: ${error.message}`);
  return data.id;
}

// Insert the representative edition + its recordings/release_tracks from PRE-FETCHED
// editions (no per-RG MB calls — tracks already came with the bulk artist-releases fetch).
async function ingestEditionFromPrefetched(
  db: DB, rgId: string, rg: MbReleaseGroup, primaryArtistId: string, editions: MbArtistRelease[],
): Promise<number> {
  if (editions.length === 0) return 0;
  const rep = pickRepresentative(editions);
  // Cover Art Archive front art (hotlink, never cached). MB's flag tells us if it exists.
  //
  // RELEASE-GROUP, not release. /release/{id} returns the art of THAT ONE PRESSING — a Japanese
  // edition, a vinyl reissue, a deluxe variant — whichever pickRepresentative happened to choose.
  // /release-group/{id} returns the cover MusicBrainz editors DESIGNATED as representing the album,
  // i.e. the one people recognise. Using the per-release endpoint is why the catalog is full of
  // alternative covers: 347,614 rows (77.7% of all cover art) came in this way, and a 30-album
  // sample found 15 of them resolve to a different image than the release-group cover.
  // Sampled 30/30 release-group lookups returned 200. It CAN 404 when a group has no designated
  // front even though an edition does; HEAD-checking here would add a ~1.5s CAA redirect per
  // release group and is not worth it inside the ingest loop, so repairing that residue is the
  // covers backfill's job (it already HEAD-checks) rather than ingest's.
  const coverUrl = rep.coverFront
    ? `https://coverartarchive.org/release-group/${rg.id}/front-500`
    : null;

  const releaseId = randomUUID();
  const { error: upErr } = await db.from('releases').upsert({
    id: releaseId,
    mb_release_id: rep.id,
    release_group_id: rgId,
    is_canonical: true,
    region: rep.country,
    title: rg.title || '(untitled)',
    artist: rg.artistCredit || '(unknown)',
    release_date: padDate(rep.date),
    release_type: TITLE_TYPE[mbTypeToGroupType(rg.primaryType, rg.secondaryTypes)] ?? 'Album',
    // Persisted now rather than discarded, so the official-edition decision is auditable later
    // and the cleanup pass can find what earlier ingests let through. See migration 20260922000001.
    status: rep.status ?? null,
    // rep.trackCount is MB's raw media count (includes video tracks); rep.tracks is
    // already filtered to audio-only by parseMedia(), so use its length to keep
    // total_tracks consistent with what's actually written to release_tracks below.
    total_tracks: rep.tracks.length || null,
    cover_url: coverUrl,
    cover_source: coverUrl ? 'coverartarchive' : null,
    source: 'musicbrainz',
    cached_at: new Date().toISOString(),
  }, { onConflict: 'mb_release_id', ignoreDuplicates: true });
  if (upErr) throw new Error(`release upsert ${rep.id}: ${upErr.message}`);
  const { data: relRow, error } = await db.from('releases').select('id').eq('mb_release_id', rep.id).single();
  if (error) throw new Error(`release resolve ${rep.id}: ${error.message}`);
  const releaseDbId = relRow.id;

  // Guarantee exactly one canonical edition per group (idempotent across re-ingests /
  // a changed representative pick): demote any other canonical edition in this group.
  await db.from('releases').update({ is_canonical: false })
    .eq('release_group_id', rgId).eq('is_canonical', true).neq('id', releaseDbId);

  // The group's display cover = its canonical edition's cover.
  if (coverUrl) await db.from('release_groups').update({ cover_url: coverUrl }).eq('id', rgId);

  const tracks = rep.tracks;           // already fetched in the bulk artist-releases call
  const seenRec = new Set<string>();   // a recording appears once per release (UNIQUE(release_id, recording_id))
  let n = 0;
  for (const t of tracks) {
    if (!t.recordingId || seenRec.has(t.recordingId)) continue;
    seenRec.add(t.recordingId);
    const recId = await findOrCreateRecording(db, t, primaryArtistId);
    await db.from('release_tracks').upsert(
      { release_id: releaseDbId, recording_id: recId, position: t.position, disc_number: t.discNumber },
      { onConflict: 'release_id,disc_number,position', ignoreDuplicates: true },
    );
    n++;
  }
  return n;
}

// Composition filter (decided 2026-06-26): trim to core types. Keep the artist's OWN
// album/EP/single (+ compilation/soundtrack, which carry primary-type Album); drop guest
// features (primary artist ≠ this artist) and live/remix/dj-mix/etc.
const SKIP_SECONDARY = new Set(['live', 'remix', 'dj-mix', 'interview', 'audiobook', 'spokenword', 'audio drama']);

/**
 * Release groups on a curated list that the `live` filter would otherwise refuse.
 *
 * Skipping live albums is right by default -- most are tour documents, not records people rate --
 * but it also excludes 43 canonical albums, several of them Rolling Stone 500 entries: At Folsom
 * Prison, Live at Leeds, MTV Unplugged in New York, Alive!, At Fillmore East, Frampton Comes
 * Alive!, Judy at Carnegie Hall, Live at the Regal, Amazing Grace. CATALOG_GAP_REPORT.md classes
 * these as "policy, not bugs" and recommends the rule implemented here: a live album earns its
 * place when a curated list already judged it canonical. Loaded once per ingest from
 * external_scores, so it costs one query rather than one per release group.
 */
let curatedLiveMbids: Set<string> | null = null;
export async function loadCuratedMbids(db: DB): Promise<Set<string>> {
  if (curatedLiveMbids) return curatedLiveMbids;
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('external_scores')
      .select('mb_release_group_id').not('mb_release_group_id', 'is', null)
      .order('mb_release_group_id').range(from, from + 999);
    if (error || !data?.length) break;
    for (const r of data as any[]) out.add(r.mb_release_group_id);
    if (data.length < 1000) break;
  }
  curatedLiveMbids = out;
  return out;
}

export function shouldIngestRG(rg: MbReleaseGroup, artistMbid: string, curated?: Set<string>): boolean {
  if (rg.primaryArtistMbid && rg.primaryArtistMbid !== artistMbid) return false; // guest feature / various artists
  const sec = (rg.secondaryTypes ?? []).map(s => s.toLowerCase());
  // A curated-list album overrides the `live` skip only -- remix/interview/audiobook stay out.
  const curatedLive = !!curated?.has(rg.id) && sec.every(x => x === 'live' || !SKIP_SECONDARY.has(x));
  if (!curatedLive && sec.some(s => SKIP_SECONDARY.has(s))) return false;
  const pt = (rg.primaryType ?? '').toLowerCase();
  return pt === 'album' || pt === 'ep' || pt === 'single';
}

/** Full ingest of one MB artist → artists/aliases/external_ids → release_groups → releases → recordings/release_tracks. */
// ── FRESHNESS scheduling: how long until an artist is re-polled for new releases ──
// Drives `artists.next_check_at` (RENOVATION_PLAN §6 cadence tiers). The FRESHNESS lane
// (pipeline.ts) claims artists whose next_check_at has passed and re-ingests them.
export const FRESHNESS_DAYS: Record<string, number> = { hot: 1, active: 7, known: 30, dormant: 90 };
export function nextCheckAt(priority: string | null | undefined, from: Date = new Date()): string {
  const days = FRESHNESS_DAYS[priority ?? 'known'] ?? 30;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/**
 * `coreOnly` ingests ONLY official albums and EPs, skipping singles entirely.
 *
 * WHY IT EXISTS. MAX_INGEST_RGS refuses any artist with more than 800 release groups, because the
 * DB-write phase runs so long the watchdog mistakes it for a hang and restart-loops the queue. That
 * refusal is terminal, so 37 artists are permanently absent or frozen -- Frank Sinatra, Johnny
 * Cash, Grateful Dead, Ennio Morricone, most classical composers and orchestras sit as empty stubs,
 * while Bob Dylan, Bruce Springsteen, the Rolling Stones, U2, the Beatles and Elvis are frozen on a
 * partial June ingest (Springsteen missing 11 studio albums, Dylan missing Tempest and Rough and
 * Rowdy Ways, U2 re-scheduled to 2036). See CATALOG_GAP_REPORT.md cause 2.
 *
 * WHAT IT FILTERS, AND WHY DROPPING SINGLES WAS NOT ENOUGH. The first version of this kept every
 * release group whose primaryType was Album or EP, on the theory that the count is dominated by
 * singles. That holds for pop artists (the Rolling Stones: 677 rows against 491 MB-eligible) and is
 * flatly false for everyone else on the list -- classical composers and orchestras are release-group
 * counts made almost entirely of albums, so the filter removed nothing and every one of them was
 * refused a second time on the same cap: Prokofiev 1318 -> 1314, Handel 1722 -> 1715, Frank Sinatra
 * 1203 -> 925. So it also requires an EMPTY secondary-type list, i.e. studio albums only, which
 * drops the compilations, live albums, soundtracks and remix collections that make up the bulk of a
 * long-dead artist's release groups.
 *
 * AND WHY IT TRUNCATES INSTEAD OF REFUSING. For the composers and orchestras even studio-only can
 * exceed the cap -- there are genuinely thousands of recordings of Handel credited to Handel. The
 * cap exists to bound the DB-write phase so the watchdog does not mistake it for a hang, and a slice
 * bounds it exactly as well as a refusal does, without being terminal. In coreOnly mode the list is
 * therefore cut to MAX_INGEST_RGS oldest-first (the canonical recordings, not the reissue tail) and
 * logged as truncated. Ordinary ingest still refuses, unchanged.
 */
export async function ingestArtist(db: DB, mbid: string, coreOnly = false): Promise<{ artistId: string; isNew: boolean; rgCount: number; recCount: number; skippedUnofficial: number; skippedEmpty: number }> {
  // Belt-and-suspenders for the ListenBrainz path (carries an MBID directly, bypassing the
  // resolver's candidate filter): never ingest a special-purpose placeholder.
  if (SPECIAL_MBIDS.has(mbid)) throw new Error(`refusing special-purpose MBID ${mbid} (Various Artists / [unknown] / …)`);
  const detail = await getArtist(mbid);
  if (!detail) throw new Error(`MB artist not found: ${mbid}`);
  const { id: artistId, isNew } = await findOrCreateArtistByMbid(db, detail);

  let rgs = await browseReleaseGroups(mbid);

  // AN MB ENTITY WITH NO RELEASES MUST NOT BECOME A CATALOGUE ARTIST.
  //
  // MusicBrainz holds many same-named entities that carry no release groups at all, and the resolver
  // can land on one: a search miss for "Jessie Ware" resolved to a different MB "Jessie Ware" with
  // nothing, and the ingest created a SECOND, empty Jessie Ware beside the one holding 47 groups.
  // Kiss, Joji, Willow, Alex G, The Internet and Dean all acquired an empty twin the same way, and
  // those twins are exactly the "artists I have never heard of" that crowd search results.
  //
  // Now that mbGet throws instead of returning null (see MbUnavailableError), an empty list here is
  // a real answer from MusicBrainz rather than a failure wearing the same clothes, so it is safe to
  // act on. Only a row this call just created is removed -- an artist that already existed is left
  // alone, because something else put it there and may reference it.
  if (rgs.length === 0 && isNew) {
    await db.from('artists').delete().eq('id', artistId);
    return { artistId, isNew, rgCount: 0, recCount: 0, skippedUnofficial: 0, skippedEmpty: 0 };
  }

  // In coreOnly mode reduce to studio albums and EPs before the cap is measured. Dropping singles
  // alone is not enough -- see the note above; the secondary-type test is what actually brings a
  // composer or an orchestra down to a plausible discography.
  if (coreOnly) {
    const before = rgs.length;
    rgs = rgs.filter(rg =>
      (rg.primaryType === 'Album' || rg.primaryType === 'EP') && (rg.secondaryTypes ?? []).length === 0);
    console.log(`  [core] ${detail.name}: ${before} release groups -> ${rgs.length} studio album/EP only`);
  }

  // Hard-skip heavily-featured entities (classical composers like Mozart/Bach, prolific producers)
  // whose thousands of release-groups make the DB-write phase so long the watchdog mistakes it for
  // a hang, restart-loops, and blocks the whole queue. They're not core catalog artists anyway.
  if (rgs.length > MAX_INGEST_RGS) {
    if (!coreOnly) {
      throw new HeavilyFeaturedError(`heavily-featured (${rgs.length} release groups > ${MAX_INGEST_RGS}) — skipping ${detail.name}`);
    }
    // coreOnly is the deliberate rescue path for exactly these artists, so bound the work instead
    // of refusing it. Oldest-first keeps the canonical recordings and sheds the reissue tail.
    const before = rgs.length;
    rgs = [...rgs]
      .sort((a, b) => (a.firstReleaseDate ?? '9999').localeCompare(b.firstReleaseDate ?? '9999'))
      .slice(0, MAX_INGEST_RGS);
    console.log(`  [core] ${detail.name}: still over the cap at ${before} — truncated to ${rgs.length} oldest`);
  }

  // Bulk-fetch ALL editions WITH tracks in pages of 100, then group by release-group —
  // replaces (browseReleases + getReleaseTracks) per RG. ~10–75× fewer MB calls.
  const browsed = await browseArtistReleasesDetailed(mbid);
  const editions = browsed.releases;
  // TRUNCATION MAKES AN EMPTY EDITION LIST MEANINGLESS. browseArtistReleases stops at
  // MAX_RELEASE_PAGES, and /release?artist= returns everything the artist is CREDITED on, so a
  // prolific artist blows past it -- Taylor Swift has 2,506 releases and the listing truncates at
  // roughly 1,500. Any release group whose editions fall beyond the cap comes back with ZERO
  // editions, which the gate below then reads as "empty shell, drop it". That is how her
  // TORTURED POETS DEPARTMENT went missing despite having 25 Official releases on MusicBrainz, and
  // it is the "recent albums missing after a fresh re-poll" cause in CATALOG_GAP_REPORT.md.
  //
  // The same hazard was already identified and guarded in audit-unofficial-rgs.ts -- refusing to
  // conclude absence from a truncated list -- and simply not applied here. When the listing is
  // truncated, an empty edition list means UNKNOWN, not EMPTY, so the group is kept.
  const truncated = browsed.truncated;
  if (truncated) {
    console.warn(`  [ingest] ${mbid}: edition listing truncated at ${browsed.seen}/${browsed.total} — empty-edition groups will be KEPT, not dropped`);
  }
  const byRg = new Map<string, MbArtistRelease[]>();
  for (const r of editions) {
    if (!r.rgId) continue;
    const arr = byRg.get(r.rgId);
    if (arr) arr.push(r); else byRg.set(r.rgId, [r]);
  }

  const curated = await loadCuratedMbids(db);
  let recCount = 0, kept = 0, skippedUnofficial = 0, skippedEmpty = 0;
  for (const rg of rgs) {
    if (!shouldIngestRG(rg, mbid, curated)) continue;  // composition filter (trim to core)
    // OFFICIAL-EDITION GATE. MusicBrainz statuses each RELEASE (Official / Promotion / Bootleg /
    // Pseudo-Release / Cancelled / Withdrawn); release GROUPS carry no status, which is why this
    // cannot live in shouldIngestRG. We already hold every edition here from browseArtistReleases,
    // so the check is free.
    //
    // Without it a group whose editions are all bootlegs ingests as a normal album. Reported from
    // the app 2026-09-22: "Ye" showed 87 albums against MusicBrainz's own 13, because the MB site
    // filters to official and we did not filter at all. "YE LIVE IN MEXICO" is one Bootleg edition
    // typed `album` with no `live` secondary type, so SKIP_SECONDARY could never catch it -- a
    // type-based filter cannot see a status problem. Sampled rate: 13% of release groups for
    // prolific artists have no official edition (0% to 29% by artist).
    //
    // Conservative on unknowns: an EMPTY edition list is kept, because that means MB returned no
    // releases for the group rather than that we know they are unofficial.
    const eds = byRg.get(rg.id) ?? [];
    // No editions at all => nothing to ingest. Creating the group anyway leaves an EMPTY SHELL: it
    // renders on the artist page with no tracks, nothing to play and nothing to rate, and sits next
    // to the real record looking like a duplicate. Reported 2026-09-22: Ye's page showed "BULLY"
    // twice, and the second was this -- 0 editions, 0 tracks, against the real one's 13. 3,986 such
    // rows existed catalogue-wide (2,539 of them compilations).
    // Empty is only evidence of an empty shell when we actually saw the whole listing.
    if (eds.length === 0) {
      if (!truncated) { skippedEmpty++; continue; }
    } else if (!eds.some(e => e.status === 'Official')) { skippedUnofficial++; continue; }
    kept++;
    const rgId = await findOrCreateReleaseGroup(db, rg, artistId);
    // Multi-artist credits (Work Item A). Guarded: if the release_group_artists migration isn't
    // applied yet, skip silently so ingestion still succeeds.
    if (!creditsTableMissing) {
      try {
        await writeReleaseGroupCredits(db, rgId, rg.credits, mbid, artistId);
      } catch (e) {
        if (/release_group_artists/.test((e as Error).message)) {
          creditsTableMissing = true;
          console.warn('  [credits] release_group_artists missing — skipping credit writes (apply migration 20260630000001)');
        } else throw e;
      }
    }
    recCount += await ingestEditionFromPrefetched(db, rgId, rg, artistId, byRg.get(rg.id) ?? []);
  }

  // Schedule the next freshness re-poll from the artist's priority tier (default 'known').
  const { data: pr } = await db.from('artists').select('ingest_priority').eq('id', artistId).maybeSingle();
  // Record MusicBrainz's OWN release-group total while we have it for free. browseReleaseGroups
  // pages until offset >= release-group-count, so rgs.length is exactly that count -- unfiltered,
  // which is the point: the freshness lane compares MusicBrainz's previous answer to its current
  // one, and must not be given a number our official-edition gate has already shrunk. Writing it
  // here means every artist the drain touches gets a usable baseline immediately, instead of each
  // one having to burn a full re-poll before the cheap path can ever apply.
  await db.from('artists')
    .update({
      ingest_state: 'tracks_done',
      last_ingested_at: new Date().toISOString(),
      next_check_at: nextCheckAt(pr?.ingest_priority),
      mb_rg_count: rgs.length,
    })
    .eq('id', artistId);

  // skippedUnofficial is surfaced so the caller can log it: a silent filter is how the old
  // type-only filter hid the bootleg problem for months.
  return { artistId, isNew, rgCount: kept, recCount, skippedUnofficial, skippedEmpty };
}
