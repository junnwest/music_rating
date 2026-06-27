/**
 * MusicBrainz resolution + mapping helpers (RENOVATION_PLAN §4).
 * Resolver + type mapping live here so the coverage gate and the (future) full
 * DB-writing ingest share identical logic. Full ingest is added after the §12.3 gate.
 */

import { randomUUID } from 'crypto';
import {
  searchArtists, getArtist, browseReleaseGroups, browseArtistReleases,
  type MbArtistCandidate, type MbArtistDetail, type MbReleaseGroup, type MbArtistRelease, type MbTrack,
} from './mb-client';
import { getDB, normalizeStr, detectLanguage, type DB } from './itunes-ingest-core';
import { MB_ARTIST_OVERRIDES } from './mb-overrides';

export { detectLanguage, getDB };
export type { DB };

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
      best: { id: override, name, score: 100, type: null, country: region, area: null, disambiguation: '(manual override)' },
      needsReview: false, ambiguous: false, candidates: [],
    };
  }

  const candidates = await searchArtists(name, 8);
  if (candidates.length === 0) return { best: null, needsReview: false, ambiguous: false, candidates: [] };

  const norm = normalizeStr(name);
  const exact = candidates.filter(c => normalizeStr(c.name) === norm);
  const fromExact = exact.length > 0;
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
    recCount += await ingestEditionFromPrefetched(db, rgId, rg, artistId, byRg.get(rg.id) ?? []);
  }

  // Schedule the next freshness re-poll from the artist's priority tier (default 'known').
  const { data: pr } = await db.from('artists').select('ingest_priority').eq('id', artistId).maybeSingle();
  await db.from('artists')
    .update({ ingest_state: 'tracks_done', last_ingested_at: new Date().toISOString(), next_check_at: nextCheckAt(pr?.ingest_priority) })
    .eq('id', artistId);

  return { artistId, isNew, rgCount: kept, recCount };
}
