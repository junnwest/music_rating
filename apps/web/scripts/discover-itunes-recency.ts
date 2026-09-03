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
import { searchAlbum, fetchDiscography, fetchAlbumTracks } from './itunes-client';

export interface RecencyArtist { id: string; name: string; name_native: string | null; native_language: string | null; country: string | null }
export interface RecencyResult { resolved: boolean; ingested: number; gaps: { title: string; date: string }[] }

/**
 * Scan ONE owned artist against iTunes and (optionally) ingest confidently-missing recent releases.
 * Reused by both the CLI and the pipeline recencyLoop. May throw ItunesBlockedError (from
 * itunes-client) — callers handle the back-off. Creates its own ingest context (dryRun mirrors
 * !ingest, so report mode writes nothing).
 */
export async function scanArtistRecency(
  db: DB, a: RecencyArtist, opts: { sinceMonths: number; ingest: boolean; country?: string },
): Promise<RecencyResult> {
  const cutoff = new Date(Date.now() - opts.sinceMonths * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const nativeLang = a.native_language ?? (opts.country === 'KR' ? 'ko' : null);
  const ctx = createIngestContext(db, { dryRun: !opts.ingest, withTracks: true, skipSingles: false });

  // Our catalog for this artist → dedup signals: title-key set (title + native_title) + dates.
  const { data: ours } = await db.from('release_groups')
    .select('title, native_title, first_release_date').eq('primary_artist_id', a.id);
  const ourKeys = new Set<string>();
  const ourDates = new Set<string>();
  for (const r of ours ?? []) {
    if ((r as any).title) ourKeys.add(releaseGroupKey((r as any).title));
    if ((r as any).native_title) ourKeys.add(releaseGroupKey((r as any).native_title));
    if ((r as any).first_release_date) ourDates.add((r as any).first_release_date as string);
  }
  const seedTitle = (ours ?? [])[0]?.title as string | undefined;
  if (!seedTitle) return { resolved: false, ingested: 0, gaps: [] };

  // Resolve the iTunes artistId from an ALBUM search of a known title (native-name term for KR).
  const seed = await searchAlbum(seedTitle, a.name_native ?? a.name, nativeLang);
  if (!seed?.artistId) return { resolved: false, ingested: 0, gaps: [] };

  const albums = (await fetchDiscography(seed.artistId)).filter(al => al.artistId === seed.artistId);

  // DEDUP GATE: missing only if no title-key twin (title or native_title) AND no exact-date twin.
  const missing = albums.filter(al => {
    const date = (al.releaseDate ?? '').slice(0, 10);
    if (!date || date < cutoff) return false;
    if (ourKeys.has(releaseGroupKey(al.collectionName))) return false;
    if (ourDates.has(date)) return false;
    return true;
  });

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
  return { resolved: true, ingested, gaps };
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
  let q = db.from('artists').select('id, name, name_native, native_language, country').eq('ingest_state', 'tracks_done');
  if (ARTIST) q = q.ilike('name', ARTIST);
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
