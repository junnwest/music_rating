/**
 * MusicBrainz resolution + mapping helpers (RENOVATION_PLAN §4).
 * Resolver + type mapping live here so the coverage gate and the (future) full
 * DB-writing ingest share identical logic. Full ingest is added after the §12.3 gate.
 */

import { randomUUID } from 'crypto';
import {
  searchArtists, getArtist, browseReleaseGroups, browseArtistReleases,
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
  const best = pool[0];
  const ambiguous = pool.length > 1 && pool[1].score >= best.score - 3;
  return { best, needsReview: false, ambiguous, candidates };
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
  const primary = cjk.find(a => a.primary);
  if (primary) return primary.name;
  if (cjk.length) return cjk[0].name;
  if (scriptOf(detail.name) !== 'latin') return detail.name;
  return detail.aliases.find(a => scriptOf(a.name) !== 'latin')?.name ?? null;
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
  if (existing?.artist_id) return { id: existing.artist_id as string, isNew: false };

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
  const coverUrl = rep.coverFront ? `https://coverartarchive.org/release/${rep.id}/front-500` : null;

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
    total_tracks: rep.trackCount || null,
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
export function shouldIngestRG(rg: MbReleaseGroup, artistMbid: string): boolean {
  if (rg.primaryArtistMbid && rg.primaryArtistMbid !== artistMbid) return false; // guest feature / various artists
  const sec = (rg.secondaryTypes ?? []).map(s => s.toLowerCase());
  if (sec.some(s => SKIP_SECONDARY.has(s))) return false;
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

export async function ingestArtist(db: DB, mbid: string): Promise<{ artistId: string; isNew: boolean; rgCount: number; recCount: number }> {
  // Belt-and-suspenders for the ListenBrainz path (carries an MBID directly, bypassing the
  // resolver's candidate filter): never ingest a special-purpose placeholder.
  if (SPECIAL_MBIDS.has(mbid)) throw new Error(`refusing special-purpose MBID ${mbid} (Various Artists / [unknown] / …)`);
  const detail = await getArtist(mbid);
  if (!detail) throw new Error(`MB artist not found: ${mbid}`);
  const { id: artistId, isNew } = await findOrCreateArtistByMbid(db, detail);

  const rgs = await browseReleaseGroups(mbid);

  // Bulk-fetch ALL editions WITH tracks in pages of 100, then group by release-group —
  // replaces (browseReleases + getReleaseTracks) per RG. ~10–75× fewer MB calls.
  const editions = await browseArtistReleases(mbid);
  const byRg = new Map<string, MbArtistRelease[]>();
  for (const r of editions) {
    if (!r.rgId) continue;
    const arr = byRg.get(r.rgId);
    if (arr) arr.push(r); else byRg.set(r.rgId, [r]);
  }

  let recCount = 0, kept = 0;
  for (const rg of rgs) {
    if (!shouldIngestRG(rg, mbid)) continue;           // composition filter (trim to core)
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
  await db.from('artists')
    .update({ ingest_state: 'tracks_done', last_ingested_at: new Date().toISOString(), next_check_at: nextCheckAt(pr?.ingest_priority) })
    .eq('id', artistId);

  return { artistId, isNew, rgCount: kept, recCount };
}
