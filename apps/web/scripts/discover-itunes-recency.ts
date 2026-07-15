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
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --artist="Simon Dominic"   # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --limit=30                  # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-itunes-recency.ts --artist="Simon Dominic" --ingest  # WRITES
 *
 * DEFAULT IS REPORT-ONLY. Writing requires the explicit --ingest flag.
 *
 * Safety model (see [[feedback_multisource_safety]] / SESSIONS 2026-07-15):
 *   • DEDUP GATE — an iTunes album counts as "missing" only if it matches NONE of the artist's
 *     existing release groups on: title-key vs our `title` OR our `native_title` (kills the
 *     romanized-vs-Hangul false "missing" that made a naive title-key report 30-of-31), AND has no
 *     exact release-date twin among our groups (a same-date release is almost certainly the same
 *     record under a different title rendering). Recency-scoped (release ≥ cutoff) so we bridge new
 *     releases, not backfill the whole discography.
 *   • NO DUP ARTIST — we pass the KNOWN owned-artist uuid straight to the release-group writer and
 *     never call findOrCreateArtist (which could mint a second artist row if its alias match missed).
 *   • BY THIS ARTIST ONLY — skip iTunes results whose primary artistId isn't the one we resolved
 *     (drops compilations / features that would mis-attribute).
 *   • PROVENANCE — tag the new rows source='itunes', mb_release_group_id left NULL, so the
 *     reconciliation pass (reconcile-itunes-mb.ts) can later merge them onto the MB row if/when MB
 *     catalogs the same release — the one dup risk this lane can't prevent at insert time.
 *
 * iTunes API facts: free-text search is broken (0 results for real releases) → enumerate via the
 * artist-id discography lookup; artist-entity search fails for KR → resolve artistId from an ALBUM
 * search of a known title; 0/783 KR artists have itunes_artist_id → resolve per-artist.
 */
import {
  getDB, releaseGroupKey, createIngestContext, findOrCreateReleaseGroup, ingestEdition,
  releaseType, artworkUrl, mapGenre, detectLanguage, type AlbumInput,
} from './itunes-ingest-core';
import { searchAlbum, fetchDiscography, fetchAlbumTracks } from './itunes-client';

const args = process.argv.slice(2);
const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const INGEST = args.includes('--ingest');          // default OFF → report only
const COUNTRY = arg('--country') ?? 'KR';
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : 30;
const ARTIST = arg('--artist') ?? null;
const SINCE_MONTHS = arg('--since-months') ? parseInt(arg('--since-months')!, 10) : 12;

const cutoff = new Date(Date.now() - SINCE_MONTHS * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const db = getDB();
  // dryRun mirrors report-only: the shared writers become no-ops, so the same code path reports
  // "would ingest" without writing a byte. withTracks: pull tracklists so ingested albums are whole.
  const ctx = createIngestContext(db, { dryRun: !INGEST, withTracks: true, skipSingles: false });

  let q = db.from('artists').select('id, name, name_native, native_language').eq('ingest_state', 'tracks_done');
  if (ARTIST) q = q.ilike('name', ARTIST);
  else q = q.eq('country', COUNTRY).order('id').limit(LIMIT);
  const { data: artists, error } = await q;
  if (error) throw new Error(error.message);
  if (!artists?.length) { console.log('No artists matched.'); return; }

  console.log(`${INGEST ? 'INGESTING' : 'REPORT-ONLY'} — ${artists.length} ${ARTIST ? '' : COUNTRY + ' '}artist(s), recent = release ≥ ${cutoff}\n`);

  let resolved = 0, unresolved = 0, ingested = 0, wouldIngest = 0;
  const hits: { artist: string; title: string; date: string }[] = [];

  for (const a of artists) {
    const nativeLang = (a.native_language as string | null) ?? (COUNTRY === 'KR' ? 'ko' : null);

    // Our catalog for this artist → the dedup signals: title-key set (title + native_title) + dates.
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
    if (!seedTitle) { unresolved++; continue; }

    // Resolve iTunes artistId from an ALBUM search of a known title (native-name term for KR).
    const seed = await searchAlbum(seedTitle, (a.name_native as string | null) ?? (a.name as string), nativeLang);
    if (!seed?.artistId) { unresolved++; console.log(`  ? ${a.name} — could not resolve on iTunes`); await sleep(250); continue; }
    resolved++;

    const albums = (await fetchDiscography(seed.artistId))
      .filter(al => al.artistId === seed.artistId);          // BY this artist only (drop comps/features)

    // DEDUP GATE: missing only if no title-key twin (title or native_title) AND no exact-date twin.
    const missingRecent = albums.filter(al => {
      const date = (al.releaseDate ?? '').slice(0, 10);
      if (!date || date < cutoff) return false;               // recency-scoped
      if (ourKeys.has(releaseGroupKey(al.collectionName))) return false;
      if (ourDates.has(date)) return false;                   // same-date release → we almost certainly have it
      return true;
    });

    if (!missingRecent.length) { await sleep(300); continue; }
    console.log(`  ★ ${a.name}${a.name_native ? ` (${a.name_native})` : ''} — ${missingRecent.length} confidently-missing recent`);

    for (const al of missingRecent.sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? ''))) {
      const date = (al.releaseDate ?? '').slice(0, 10);
      hits.push({ artist: a.name as string, title: al.collectionName, date });
      const rtype = releaseType(al.trackCount ?? 0, al.collectionName);
      const album: AlbumInput = {
        collectionId: al.collectionId, artistId: al.artistId, artistName: al.artistName,
        collectionName: al.collectionName, releaseDate: al.releaseDate, primaryGenreName: al.primaryGenreName,
        trackCount: al.trackCount, artworkUrl100: al.artworkUrl100, country: al.country,
      };
      // Attach to the KNOWN owned-artist uuid — never findOrCreateArtist (no dup-artist risk).
      const group = await findOrCreateReleaseGroup(ctx, {
        primaryArtistId: a.id as string, artistDisplay: al.artistName, title: al.collectionName,
        appReleaseType: rtype, firstReleaseDate: date || null,
        coverUrl: artworkUrl(al.artworkUrl100 ?? '') || null, genre: mapGenre(al.primaryGenreName ?? '') || null,
      });
      const tracks = INGEST ? await fetchAlbumTracks(al.collectionId, nativeLang) : [];
      const native = detectLanguage(al.collectionName)
        ? { titleNative: al.collectionName, artistNative: (a.name_native as string | null) ?? al.artistName, nativeLanguage: detectLanguage(al.collectionName)! }
        : null;
      const result = await ingestEdition(ctx, { album, primaryArtistId: a.id as string, group, native, tracks });

      if (INGEST && result === 'inserted') {
        // Provenance: tag exactly this new group + its editions; recordings are tagged per-artist
        // below (they carry no group id). Guarded is('source', null) never relabels MB rows.
        await db.from('release_groups').update({ source: 'itunes' }).eq('id', group.id).is('source', null);
        await db.from('releases').update({ source: 'itunes' }).eq('release_group_id', group.id).is('source', null);
        ingested++;
      } else if (!INGEST) { wouldIngest++; }
      console.log(`       ${date}  ${al.collectionName}  → ${INGEST ? result : 'would ingest'}`);
      await sleep(200);
    }
    if (INGEST) {
      // New recordings carry source=null; tag them for this artist (MB rows already say musicbrainz).
      await db.from('recordings').update({ source: 'itunes' }).eq('primary_artist_id', a.id).is('source', null);
    }
    await sleep(300);
  }

  console.log(`\n=== SUMMARY (${INGEST ? 'LIVE — wrote to catalog' : 'REPORT-ONLY — nothing written'}) ===`);
  console.log(`Artists: ${artists.length} (resolved ${resolved}, unresolved ${unresolved})`);
  console.log(INGEST ? `Ingested release groups: ${ingested}` : `Would ingest: ${wouldIngest}`);
  if (hits.length) {
    console.log(`\nRecent gaps:`);
    for (const h of hits.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)) console.log(`  ${h.date}  ${h.artist} — ${h.title}`);
  }
  if (!INGEST && wouldIngest) console.log(`\nRe-run with --ingest to write these. Then reconcile-itunes-mb.ts guards against MB-later duplicates.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
