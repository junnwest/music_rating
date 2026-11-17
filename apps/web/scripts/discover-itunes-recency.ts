/**
 * Recency lane — bridges MusicBrainz's lag on recent releases from artists marginalized in the
 * Western catalog world (esp. Korean/underground acts). MB is MB-primary here, so a brand-new KR
 * release is structurally absent until MB catalogs it weeks–months later. iTunes/Apple Music has
 * it day-one. Example: Simon Dominic's "ONYX" (2026-05-14) — in iTunes, not in MB, so not in us.
 *
 * For each owned artist we enumerate their iTunes discography and ingest releases we're confidently
 * missing. "Auto but safe": auto-ingest only what passes a strict MULTI-SIGNAL dedup gate; anything
 * uncertain is SKIPPED, never ingested (missing > wrong — a duplicate is worse than a delay).
 *
 * Runs two ways from ONE implementation (scanArtistRecency):
 *   • as a scheduled pipeline lane (recencyLoop in pipeline.ts) — auto, bounded, gentle on iTunes;
 *   • as this CLI, for targeted runs / spot-checks.
 *
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --artist="Simon Dominic"   # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --limit=30                  # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --artist="Simon Dominic" --ingest  # WRITES
 *
 * DEFAULT IS REPORT-ONLY. Writing requires the explicit --ingest flag.
 *
 * Safety model (see [[feedback_multisource_safety]] / SESSIONS 2026-07-15):
 *   • DEDUP GATE — an iTunes album counts as "missing" only if it matches NONE of the artist's
 *     existing release groups on title-key vs our `title` OR `native_title` (kills the romanized-
 *     vs-Hangul false "missing" that made a naive title-key report 30-of-31), AND has no exact
 *     release-date twin. Recency-scoped (release ≥ cutoff) — we bridge new releases, not backfill.
 *   • NO DUP ARTIST — pass the KNOWN owned-artist uuid to the release-group writer; never
 *     findOrCreateArtist (which could mint a second artist row if its alias match missed).
 *   • BY THIS ARTIST ONLY — skip iTunes results whose primary artistId isn't the resolved one.
 *   • PROVENANCE — tag new rows source='itunes', mb_release_group_id NULL, so reconcile-itunes-mb.ts
 *     can later link them onto the MB row when MB catalogs the same release.
 *
 * iTunes API facts: free-text search is broken (0 results for real releases) → enumerate via the
 * artist-id discography lookup; artist-entity search fails for KR → resolve artistId from an ALBUM
 * search of a known title; 0/783 KR artists have itunes_artist_id → resolve per-artist.
 */
import {
  getDB, releaseGroupKey, createIngestContext, findOrCreateReleaseGroup, ingestEdition,
  releaseType, artworkUrl, mapGenre, detectLanguage, type AlbumInput, type DB,
} from './itunes-ingest-core';
import { searchAlbum, searchArtist, fetchRecentDiscography, lookupCollections, fetchAlbumTracks } from './itunes-client';

export interface RecencyArtist {
  id: string; name: string; name_native: string | null; native_language: string | null; country: string | null;
  itunes_artist_id?: number | null;
}

// ── Resolving the artist on Apple ──
// Until 2026-11-10 this was ONE album-title search on whichever release group the DB returned first.
// That failed silently for hot artists (기리보이's seed was "Sooljalee", 양홍원's "TEEN TITANS"; the search
// endpoint also returns empty under throttling), so their new releases (asdf 11-04, 오보 11-10) were never
// looked for. Now, in order, stopping at the first that works:
//   1. artists.itunes_artist_id (stored by an earlier resolve; the column was never populated before)
//   2. look up collection ids we ALREADY hold for this artist (releases.itunes_id): one lookup call, no
//      search, and the majority primary artistId among them is the artist. Deterministic.
//   3. album-title search over up to 2 seeds (proper albums first, newest first), 2 stores each
//   4. artist-name search (native name, then name), accepted ONLY if that Apple artist's discography
//      shares a title with ours (a name match alone could be a different act with the same name).
// A resolved id is written back to artists.itunes_artist_id (UNIQUE: a conflict is ignored, not forced).
const norm = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

async function resolveItunesArtist(
  db: DB, a: RecencyArtist, ours: { title: string; native_title: string | null; release_group_type?: string | null; first_release_date: string | null }[],
  ourKeys: Set<string>, nativeLang: string | null, cheapOnly = false,
): Promise<{ artistId: number; how: string } | null> {
  if (a.itunes_artist_id) return { artistId: Number(a.itunes_artist_id), how: 'stored' };

  const { data: held } = await db.from('releases')
    .select('itunes_id, release_groups!inner(primary_artist_id)')
    .eq('release_groups.primary_artist_id', a.id).not('itunes_id', 'is', null).limit(20);
  const ids = [...new Set((held ?? []).map((r: any) => Number(r.itunes_id)).filter(Boolean))];
  if (ids.length) {
    const cols = await lookupCollections(ids);
    const tally = new Map<number, number>();
    for (const c of cols) tally.set(c.artistId, (tally.get(c.artistId) ?? 0) + 1);
    const [best, n] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0] ?? [0, 0];
    if (best && n * 2 > cols.length) return { artistId: best, how: 'held-collections' };
  }

  if (cheapOnly) return null; // steps 3–4 hit Apple's search endpoint: slow (throttled retries), so callers can defer them
  const seeds = [...ours]
    .sort((x, y) => (Number(y.release_group_type === 'album') - Number(x.release_group_type === 'album'))
      || (y.first_release_date ?? '').localeCompare(x.first_release_date ?? ''))
    .slice(0, 2);
  for (const s of seeds) {
    const hit = await searchAlbum(s.title, a.name_native ?? a.name, nativeLang, 2);
    if (hit?.artistId) return { artistId: hit.artistId, how: 'album-search' };
  }

  for (const name of [...new Set([a.name_native, a.name].filter(Boolean) as string[])]) {
    const found = await searchArtist(name);
    if (!found) continue;
    const { albums } = await fetchRecentDiscography(found.artistId);
    if (albums.some(al => ourKeys.has(releaseGroupKey(al.collectionName)))) return { artistId: found.artistId, how: 'artist-search+verified' };
  }
  return null;
}

/** A joint credit ("Panda Gomm & Young B", "GIRIBOY, C JAMM & Black Nut") names this artist at top
 *  level. A feature ("EDENMATE (feat. Young B)" by RYUHAIF) does not, and is not this artist's release. */
function isJointCredit(collectionArtist: string, appleName: string | null): boolean {
  if (!appleName) return false;
  const me = norm(appleName);
  return (collectionArtist ?? '').split(/\s*(?:,|&|×|\band\b)\s*/i).some(part => norm(part) === me);
}
// ── Re-checking Apple artwork on releases we already hold ──
// An Apple cover was copied once at ingest and never looked at again. Around release day labels swap
// placeholder or pre-release art, so we kept the stale image: the 오보 single (양홍원 & Panda Gomm,
// ingested 2026-11-10) still showed art Apple had since replaced (reported 2026-11-16). The scan above
// already fetches this artist's recent discography, so re-checking costs no extra iTunes calls.
//
// Narrow on purpose: only releases from the last RECENT_ART_DAYS, matched by exact Apple collection
// id, and only while our stored cover is still an Apple image. A group cover is replaced only while
// it still equals the release's OLD Apple URL, so a hand-repointed cover (Deezer/CAA) is never touched.
const RECENT_ART_DAYS = 45;
async function refreshRecentArtwork(db: DB, albums: { collectionId: number; releaseDate?: string; artworkUrl100?: string }[]): Promise<void> {
  const since = new Date(Date.now() - RECENT_ART_DAYS * 86_400_000).toISOString().slice(0, 10);
  const fresh = new Map<number, string>();
  for (const al of albums) {
    const url = artworkUrl(al.artworkUrl100 ?? '');
    if (url && (al.releaseDate ?? '').slice(0, 10) >= since) fresh.set(al.collectionId, url);
  }
  if (!fresh.size) return;
  const { data: held } = await db.from('releases')
    .select('id, itunes_id, cover_url, release_group_id').in('itunes_id', [...fresh.keys()]);
  for (const r of (held ?? []) as { id: string; itunes_id: number; cover_url: string | null; release_group_id: string | null }[]) {
    const next = fresh.get(Number(r.itunes_id));
    const old = r.cover_url;
    // Same image is served from is1-ssl…is5-ssl; compare without the host so a host flip isn't a "change".
    const key = (u: string) => u.replace(/^https?:\/\/is\d+-ssl\./, '');
    if (!next || !old || key(old) === key(next) || !old.includes('mzstatic.com')) continue;
    await db.from('releases').update({ cover_url: next }).eq('id', r.id).eq('cover_url', old);
    if (r.release_group_id) {
      await db.from('release_groups').update({ cover_url: next }).eq('id', r.release_group_id).eq('cover_url', old);
    }
    console.log(`  [recency] artwork refreshed — itunes ${r.itunes_id}`);
  }
}

export interface RecencyResult { resolved: boolean; how?: string; artistId?: number; ingested: number; gaps: { title: string; date: string }[] }

/**
 * Scan ONE owned artist against iTunes and (optionally) ingest confidently-missing recent releases.
 * Reused by both the CLI and the pipeline recencyLoop. May throw ItunesBlockedError (from
 * itunes-client) — callers handle the back-off. Creates its own ingest context (dryRun mirrors
 * !ingest, so report mode writes nothing).
 */
export async function scanArtistRecency(
  db: DB, a: RecencyArtist, opts: { sinceMonths: number; ingest: boolean; country?: string; cheapResolveOnly?: boolean },
): Promise<RecencyResult> {
  const cutoff = new Date(Date.now() - opts.sinceMonths * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const nativeLang = a.native_language ?? (opts.country === 'KR' ? 'ko' : null);
  const ctx = createIngestContext(db, { dryRun: !opts.ingest, withTracks: true, skipSingles: false });

  // Our catalog for this artist → dedup signals: title-key set (title + native_title) + dates.
  const { data: ours } = await db.from('release_groups')
    .select('title, native_title, release_group_type, first_release_date').eq('primary_artist_id', a.id);
  const ourKeys = new Set<string>();
  const ourDates = new Set<string>();
  for (const r of ours ?? []) {
    if ((r as any).title) ourKeys.add(releaseGroupKey((r as any).title));
    if ((r as any).native_title) ourKeys.add(releaseGroupKey((r as any).native_title));
    if ((r as any).first_release_date) ourDates.add((r as any).first_release_date as string);
  }
  if (!ours?.length) return { resolved: false, ingested: 0, gaps: [] };

  const res = await resolveItunesArtist(db, a, ours as any, ourKeys, nativeLang, opts.cheapResolveOnly);
  if (!res) return { resolved: false, ingested: 0, gaps: [] };
  if (!a.itunes_artist_id && opts.ingest) {
    // Remember it. UNIQUE column: if another artist row already holds this id (a split catalog),
    // the update fails and we simply resolve again next time; never steal it.
    await db.from('artists').update({ itunes_artist_id: res.artistId }).eq('id', a.id).is('itunes_artist_id', null);
  }

  const disco = await fetchRecentDiscography(res.artistId);
  // This artist's releases: credited first, or named in a joint credit (see isJointCredit).
  const albums = disco.albums.filter(al => al.artistId === res.artistId || isJointCredit(al.artistName, disco.artistName));

  // DEDUP GATE: missing only if no title-key twin (title or native_title) AND no exact-date twin.
  const candidates = albums.filter(al => {
    const date = (al.releaseDate ?? '').slice(0, 10);
    if (!date || date < cutoff) return false;
    if (ourKeys.has(releaseGroupKey(al.collectionName))) return false;
    if (ourDates.has(date)) return false;
    return true;
  });
  // ...AND this exact Apple collection isn't already held under ANY artist. A joint release is listed
  // under each credited artist, so whichever co-artist is scanned first takes it; without this check the
  // others would create an empty release group (UNIQUE(itunes_id) refuses the edition, not the group).
  const heldIds = new Set<number>();
  if (candidates.length) {
    const { data: h } = await db.from('releases').select('itunes_id').in('itunes_id', candidates.map(c => c.collectionId));
    for (const r of h ?? []) heldIds.add(Number((r as any).itunes_id));
  }
  const missing = candidates.filter(al => !heldIds.has(al.collectionId));

  if (opts.ingest) await refreshRecentArtwork(db, albums);

  const gaps: { title: string; date: string }[] = [];
  let ingested = 0;
  for (const al of missing) {
    const date = (al.releaseDate ?? '').slice(0, 10);
    gaps.push({ title: al.collectionName, date });
    const rtype = releaseType(al.trackCount ?? 0, al.collectionName);
    const album: AlbumInput = {
      collectionId: al.collectionId, artistId: al.artistId, artistName: al.artistName,
      collectionName: al.collectionName, releaseDate: al.releaseDate, primaryGenreName: al.primaryGenreName,
      trackCount: al.trackCount, artworkUrl100: al.artworkUrl100, country: al.country,
    };
    const group = await findOrCreateReleaseGroup(ctx, {
      primaryArtistId: a.id, artistDisplay: al.artistName, title: al.collectionName,
      appReleaseType: rtype, firstReleaseDate: date || null,
      coverUrl: artworkUrl(al.artworkUrl100 ?? '') || null, genre: mapGenre(al.primaryGenreName ?? '') || null,
    });
    const tracks = opts.ingest ? await fetchAlbumTracks(al.collectionId, nativeLang) : [];
    const native = detectLanguage(al.collectionName)
      ? { titleNative: al.collectionName, artistNative: a.name_native ?? al.artistName, nativeLanguage: detectLanguage(al.collectionName)! }
      : null;
    const result = await ingestEdition(ctx, { album, primaryArtistId: a.id, group, native, tracks });
    if (opts.ingest && result === 'inserted') {
      // Provenance: tag this new group + its editions. is('source', null) never relabels MB rows.
      await db.from('release_groups').update({ source: 'itunes' }).eq('id', group.id).is('source', null);
      await db.from('releases').update({ source: 'itunes' }).eq('release_group_id', group.id).is('source', null);
      ingested++;
    }
  }
  if (opts.ingest && ingested > 0) {
    // New recordings carry source=null; tag them for this artist (MB rows already say musicbrainz).
    await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
  }
  return { resolved: true, how: res.how, artistId: res.artistId, ingested, gaps };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const INGEST = args.includes('--ingest');
  const COUNTRY = arg('--country') ?? 'KR';
  const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : 30;
  const ARTIST = arg('--artist') ?? null;
  const SINCE_MONTHS = arg('--since-months') ? parseInt(arg('--since-months')!, 10) : 12;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const db = getDB();
  let q = db.from('artists').select('id, name, name_native, native_language, country, itunes_artist_id').eq('ingest_state', 'tracks_done');
  if (ARTIST) q = q.or(`name.ilike.${ARTIST},name_native.ilike.${ARTIST}`);
  else q = q.eq('country', COUNTRY).order('id').limit(LIMIT);
  const { data: artists, error } = await q;
  if (error) throw new Error(error.message);
  if (!artists?.length) { console.log('No artists matched.'); return; }

  console.log(`${INGEST ? 'INGESTING' : 'REPORT-ONLY'} — ${artists.length} ${ARTIST ? '' : COUNTRY + ' '}artist(s), last ${SINCE_MONTHS}mo\n`);
  let resolved = 0, ingested = 0;
  const hits: { artist: string; title: string; date: string }[] = [];
  for (const a of artists) {
    const r = await scanArtistRecency(db, a as RecencyArtist, { sinceMonths: SINCE_MONTHS, ingest: INGEST, country: COUNTRY });
    if (r.resolved) resolved++;
    console.log(`  ${(a as any).name}: ${r.resolved ? `resolved (${r.how})` : 'NOT resolved on Apple'}`);
    ingested += r.ingested;
    for (const g of r.gaps) {
      hits.push({ artist: (a as any).name, ...g });
      console.log(`  ${INGEST ? 'ingested' : 'would ingest'}: ${g.date}  ${(a as any).name} — ${g.title}`);
    }
    await sleep(300); // gentle — iTunes IP-blocks on volume
  }
  console.log(`\n=== SUMMARY (${INGEST ? 'LIVE — wrote to catalog' : 'REPORT-ONLY'}) ===`);
  console.log(`Artists: ${artists.length} (resolved ${resolved}) · ${INGEST ? `ingested ${ingested}` : `would ingest ${hits.length}`}`);
  if (!INGEST && hits.length) console.log(`\nRe-run with --ingest to write. Then reconcile:itunes guards against MB-later duplicates.`);
}

// Only run the CLI when invoked directly (not when imported by the pipeline lane).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('discover-itunes-recency.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
