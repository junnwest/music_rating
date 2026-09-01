/**
 * Recency lane, Spotify variant — same job as discover-itunes-recency.ts (bridge
 * MusicBrainz's cataloging lag on recent releases) but against Spotify instead of
 * iTunes/Apple Music.
 *
 * Why a second source alongside iTunes rather than replacing it: spot-checked 9
 * releases that were confirmed missing from BOTH MusicBrainz and iTunes (2026-09-02)
 * — Spotify had 6 of them, same-day. The two sources don't fully overlap, so this
 * runs as an independent lane, not a swap.
 *
 * Same "auto but safe" contract as the iTunes version: auto-ingest only a
 * confidently-missing release (multi-signal dedup gate — title-key match against
 * title OR native_title, or an exact release-date twin, either one kills the
 * "missing" verdict); anything uncertain is skipped, never ingested.
 *
 *   npx tsx --env-file=.env.local scripts/discover-spotify-recency.ts --artist="SUPERBEE"          # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-spotify-recency.ts --limit=30                    # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/discover-spotify-recency.ts --artist="SUPERBEE" --ingest  # WRITES
 *
 * DEFAULT IS REPORT-ONLY. Writing requires the explicit --ingest flag.
 */
import {
  getDB, releaseGroupKey, createSpotifyIngestContext, findOrCreateReleaseGroup, ingestEdition,
  detectLanguage, type SpotifyAlbumInput, type DB,
} from './spotify-ingest-core';
import { searchAlbum, fetchDiscography, fetchAlbumTracks, spotifyBlocked, SpotifyBlockedError } from './spotify-client';

export interface RecencyArtist { id: string; name: string; name_native: string | null }
export interface RecencyResult { resolved: boolean; ingested: number; gaps: { title: string; date: string }[] }

/**
 * Scan ONE owned artist against Spotify and (optionally) ingest confidently-missing
 * recent releases. Reused by both the CLI and the pipeline recencySpotifyLoop.
 */
export async function scanArtistRecencySpotify(
  db: DB, a: RecencyArtist, opts: { sinceMonths: number; ingest: boolean },
): Promise<RecencyResult> {
  const cutoff = new Date(Date.now() - opts.sinceMonths * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const ctx = createSpotifyIngestContext(db, { dryRun: !opts.ingest, withTracks: true });

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

  // Resolve the Spotify artist id from an ALBUM search of a known title — same
  // "seed from what we already have" strategy as the iTunes version, avoids the
  // ambiguity of a bare artist-name search matching the wrong same-named artist.
  const seed = await searchAlbum(seedTitle, a.name_native ?? a.name);
  const artistId = seed?.artists[0]?.id; // primary credited artist on the seed hit
  if (!seed || !artistId) return { resolved: false, ingested: 0, gaps: [] };

  const albums = (await fetchDiscography(artistId)).filter(al => al.artists.some(x => x.id === artistId));

  // DEDUP GATE: missing only if no title-key twin (title or native_title) AND no
  // exact-date twin.
  const missing = albums.filter(al => {
    const date = (al.release_date ?? '').slice(0, 10);
    if (!date || date < cutoff) return false;
    if (ourKeys.has(releaseGroupKey(al.name))) return false;
    if (ourDates.has(date)) return false;
    return true;
  });

  const gaps: { title: string; date: string }[] = [];
  let ingested = 0;
  for (const al of missing) {
    const date = (al.release_date ?? '').slice(0, 10);
    gaps.push({ title: al.name, date });
    const artistName = al.artists[0]?.name ?? a.name;
    const cover = al.images?.[0]?.url ?? null; // Spotify returns images sorted largest-first
    const album: SpotifyAlbumInput = {
      spotifyId: al.id, artistSpotifyId: artistId, artistName, name: al.name,
      releaseDate: al.release_date, albumType: al.album_type, totalTracks: al.total_tracks,
      coverUrl: cover, upc: al.external_ids?.upc ?? null,
    };
    const group = await findOrCreateReleaseGroup(ctx, {
      primaryArtistId: a.id, artistDisplay: artistName, title: al.name,
      appReleaseType: al.album_type === 'compilation' ? 'Compilation' : al.album_type === 'single' ? 'Single' : 'Album',
      firstReleaseDate: date || null, coverUrl: cover,
    });
    const tracks = opts.ingest ? await fetchAlbumTracks(al.id) : [];
    const native = detectLanguage(al.name)
      ? { titleNative: al.name, artistNative: a.name_native ?? artistName, nativeLanguage: detectLanguage(al.name)! }
      : null;
    const result = await ingestEdition(ctx, { album, primaryArtistId: a.id, group, native, tracks: tracks.map((t, i) => ({ ...t, position: t.position ?? i + 1 })) });
    if (opts.ingest && result === 'inserted') ingested++;
  }
  return { resolved: true, ingested, gaps };
}

// Re-export for the pipeline lane's shared block/error handling.
export { spotifyBlocked, SpotifyBlockedError };

// ── CLI ─────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const INGEST = args.includes('--ingest');
  const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : 30;
  const ARTIST = arg('--artist') ?? null;
  const SINCE_MONTHS = arg('--since-months') ? parseInt(arg('--since-months')!, 10) : 12;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const db = getDB();
  let q = db.from('artists').select('id, name, name_native').eq('ingest_state', 'tracks_done');
  if (ARTIST) q = q.ilike('name', ARTIST);
  else q = q.order('id').limit(LIMIT);
  const { data: artists, error } = await q;
  if (error) throw new Error(error.message);
  if (!artists?.length) { console.log('No artists matched.'); return; }

  console.log(`${INGEST ? 'INGESTING' : 'REPORT-ONLY'} — ${artists.length} artist(s), last ${SINCE_MONTHS}mo\n`);
  let resolved = 0, ingested = 0;
  const hits: { artist: string; title: string; date: string }[] = [];
  for (const a of artists) {
    const r = await scanArtistRecencySpotify(db, a as RecencyArtist, { sinceMonths: SINCE_MONTHS, ingest: INGEST });
    if (r.resolved) resolved++;
    ingested += r.ingested;
    for (const g of r.gaps) {
      hits.push({ artist: (a as any).name, ...g });
      console.log(`  ${INGEST ? 'ingested' : 'would ingest'}: ${g.date}  ${(a as any).name} — ${g.title}`);
    }
    await sleep(150);
  }
  console.log(`\n=== SUMMARY (${INGEST ? 'LIVE — wrote to catalog' : 'REPORT-ONLY'}) ===`);
  console.log(`Artists: ${artists.length} (resolved ${resolved}) · ${INGEST ? `ingested ${ingested}` : `would ingest ${hits.length}`}`);
  if (!INGEST && hits.length) console.log(`\nRe-run with --ingest to write.`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('discover-spotify-recency.ts')) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
