/**
 * Write path for the credit-stub iTunes reporter (resolve-stub-itunes.ts).
 *
 * Reads that reporter's JSON and ingests ONLY what it marked safe:
 *   • verdict === 'CORROBORATED'      — identity proven by credit-anchor evidence, never a name guess
 *   • album.primary === true          — iTunes files it under THIS artist, not a guest spot on
 *                                       someone else's release (writing those would duplicate the
 *                                       other artist's album under ours)
 *   • album.collides === null         — title already exists in release_groups; withheld, not merged
 * Everything else in the report is ignored. This script does no resolution and no identity work of
 * its own; it is a dumb applier of an already-reviewed decision, which is why the review step is a
 * separate program.
 *
 * TITLES. It writes `displayTitle`, not `title`. iTunes returns "APGU essential - EP" / "HEAVEN -
 * Single", and the catalog already carries 2,126 rows with that suffix baked in ("Hug Me - Single"
 * by South Club) — redundant, since release_group_type already says single/ep, and it corrupts the
 * dedup key. 91% of the rows this lane would add carry the suffix, so writing the raw title would
 * nearly quadruple that mess.
 *
 * ARTIST IDENTITY. The stub row already exists with an MBID, so this does NOT call
 * findOrCreateArtist (which resolves/creates by iTunes id and could fork a second entity for an
 * artist we already have). It writes against the artist uuid the report carries, and records the
 * iTunes id in artist_external_ids so re-runs and later lanes resolve to the same row.
 *
 * CREDITS. release_group_artists gets a position-0 row per new group, because that is what the
 * artist page reads — primary_artist_id alone is not enough for the release to surface.
 *
 * DRY RUN BY DEFAULT. --write is required to touch the database. Default scope is a single artist.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-stub-itunes.ts --name=nowimyoung
 *   npx tsx --env-file=.env.local scripts/ingest-stub-itunes.ts --name=nowimyoung --write
 *   npx tsx --env-file=.env.local scripts/ingest-stub-itunes.ts --report=scripts/data/stub-itunes-report.json --limit=5
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getDB, createIngestContext, findOrCreateReleaseGroup, ingestEdition,
  detectLanguage, artworkUrl, type DB, type IngestContext, type AlbumInput, type TrackInput,
} from './itunes-ingest-core';
import { fetchAlbumTracks } from './itunes-client';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const WRITE = process.argv.includes('--write');
const NO_TRACKS = process.argv.includes('--no-tracks');
const REPORT = arg('--report') ?? 'scripts/data/nowimyoung-report.json';
const NAME = arg('--name');
const ONLY_ID = arg('--id');
const LIMIT = Number(arg('--limit') ?? (NAME || ONLY_ID ? Infinity : 1));

interface ReportAlbum {
  collectionId: number; title: string; displayTitle: string; date: string | null;
  trackCount: number; type: string; primary: boolean; creditedAs: string;
  artworkUrl?: string | null;   // absent in reports generated before 2026-09-20; fetched on demand
  flags: string[]; collides: unknown | null;
}
interface ReportRow {
  id: string; name: string; verdict: string; itunesArtistId: number | null;
  itunesArtistName: string | null; store: string | null; newAlbums: ReportAlbum[];
}

function ingestable(row: ReportRow): ReportAlbum[] {
  return row.newAlbums.filter(a => a.primary && !a.collides);
}

/**
 * Cover art. The reporter now carries artworkUrl straight off the discography lookup it already
 * made, so normally this costs nothing. Older reports predate that field, so fall back to a single
 * `lookup?id=<collectionId>` per album — which is exactly why the field was added: at 5,807 albums
 * the fallback would be ~10h of extra requests.
 *
 * A release group with no cover renders as a blank tile, and the first write of nowimyoung's eight
 * albums shipped exactly that because this was passed as null.
 */
async function artworkFor(a: ReportAlbum): Promise<string | null> {
  if (a.artworkUrl !== undefined && a.artworkUrl !== null) return artworkUrl(a.artworkUrl, 600);
  const res = await fetch(`https://itunes.apple.com/lookup?id=${a.collectionId}`, {
    headers: { 'User-Agent': 'sillajuku-stub-ingest/1.0' },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const j = await res.json().catch(() => null) as { results?: Array<Record<string, unknown>> } | null;
  const coll = (j?.results ?? []).find(r => r.wrapperType === 'collection');
  const raw = coll?.artworkUrl100 as string | undefined;
  return raw ? artworkUrl(raw, 600) : null;
}

/** Idempotent link so a re-run resolves to the same artist row instead of forking a new entity. */
async function linkItunesId(db: DB, artistId: string, itunesArtistId: number) {
  await db.from('artist_external_ids').upsert(
    { source: 'itunes', external_id: String(itunesArtistId), artist_id: artistId },
    { onConflict: 'source,external_id', ignoreDuplicates: true },
  );
}

/**
 * The artist page reads release_group_artists; primary_artist_id alone does not surface a release.
 *
 * The PK here is (release_group_id, POSITION) — not (release_group_id, artist_id). Naming the wrong
 * conflict target makes Postgres answer "no unique or exclusion constraint matching the ON CONFLICT
 * specification", whose text contains the word "conflict", so a lenient /duplicate|conflict/ error
 * filter swallows it and the write silently does nothing. That exact combination cost this script
 * its first run: groups, editions and tracks all landed, credits did not, and the artist page was
 * unchanged. Errors are therefore matched on the real duplicate-key code (23505) and nothing else.
 */
async function writeCredit(db: DB, releaseGroupId: string, artistId: string, creditedAs: string) {
  // credited_as and join_phrase are both NOT NULL. credited_as is the name AS PRINTED on this
  // release (MB's ingest writes the artist-credit string, which can differ from artists.name);
  // join_phrase is what follows this credit in the printed line — empty for a sole position-0 credit.
  const { error } = await db.from('release_group_artists').insert({
    release_group_id: releaseGroupId, artist_id: artistId, position: 0,
    credited_as: creditedAs, join_phrase: '',
  });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error(`credit write ${releaseGroupId}: ${error.message}`);
  }
}

/**
 * findOrCreateReleaseGroup (itunes-ingest-core) does not set `source`, so rows land with source
 * NULL. The multi-source rule requires streaming-sourced rows be tagged so a later pass can
 * reconcile/promote them against MusicBrainz — reconcile-itunes-mb.ts selects on source='itunes'
 * and would never see them otherwise. Stamped here rather than by editing the shared helper.
 */
async function tagSource(db: DB, releaseGroupId: string) {
  const { error } = await db.from('release_groups')
    .update({ source: 'itunes' }).eq('id', releaseGroupId).is('source', null);
  if (error) throw new Error(`source tag ${releaseGroupId}: ${error.message}`);
}

async function ingestOne(ctx: IngestContext, row: ReportRow): Promise<{ groups: number; editions: number; tracks: number }> {
  const albums = ingestable(row);
  const stats = { groups: 0, editions: 0, tracks: 0 };
  if (!albums.length) return stats;

  console.log(`\n  ${row.name}  (artist ${row.id}, iTunes ${row.itunesArtistId})  — ${albums.length} album(s)`);
  if (WRITE && row.itunesArtistId) await linkItunesId(ctx.db, row.id, row.itunesArtistId);

  for (const a of albums) {
    const cover = await artworkFor(a);
    const album: AlbumInput = {
      artworkUrl100: a.artworkUrl ?? cover ?? undefined,
      collectionId: a.collectionId,
      artistId: row.itunesArtistId ?? 0,
      artistName: a.creditedAs || row.name,
      collectionName: a.displayTitle,   // suffix-stripped on purpose — see header
      releaseDate: a.date ?? undefined,
      trackCount: a.trackCount,
    };
    const group = await findOrCreateReleaseGroup(ctx, {
      primaryArtistId: row.id,
      artistDisplay: a.creditedAs || row.name,
      title: a.displayTitle,
      appReleaseType: a.type,
      firstReleaseDate: a.date,
      coverUrl: cover,
      genre: null,
    });
    stats.groups++;

    let tracks: TrackInput[] = [];
    if (!NO_TRACKS) {
      const t = await fetchAlbumTracks(a.collectionId, detectLanguage(row.name) ?? null);
      tracks = (t ?? []).map(x => ({ position: x.position, title: x.title, durationMs: x.durationMs, artists: x.artists }));
      stats.tracks += tracks.length;
    }

    const res = await ingestEdition(ctx, { album, primaryArtistId: row.id, group, tracks });
    if (res === 'inserted') stats.editions++;
    if (WRITE) {
      await writeCredit(ctx.db, group.id, row.id, row.name);
      await tagSource(ctx.db, group.id);
      // Groups created by the first (cover-less) run already exist, so findOrCreateReleaseGroup
      // returns them untouched — patch the cover in rather than leaving those tiles blank.
      if (cover) await ctx.db.from('release_groups').update({ cover_url: cover }).eq('id', group.id).is('cover_url', null);
    }

    console.log(`    ${res === 'inserted' ? '+' : '·'} ${(a.date ?? '????-??-??')}  ${a.type.padEnd(8)} ${a.displayTitle}` +
      (tracks.length ? `  (${tracks.length} tracks)` : '') +
      (a.flags.length ? `  [${a.flags.join(',')}]` : ''));
  }
  return stats;
}

async function main() {
  const file = path.resolve(process.cwd(), REPORT);
  if (!fs.existsSync(file)) throw new Error(`report not found: ${REPORT}`);
  const all: ReportRow[] = JSON.parse(fs.readFileSync(file, 'utf8'));

  let rows = all.filter(r => r.verdict === 'CORROBORATED' && ingestable(r).length > 0);
  if (NAME) rows = rows.filter(r => r.name.toLowerCase() === NAME.toLowerCase());
  if (ONLY_ID) rows = rows.filter(r => r.id === ONLY_ID);
  rows = rows.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  const planned = rows.reduce((n, r) => n + ingestable(r).length, 0);
  console.log(`[ingest-stub] ${rows.length} artist(s), ${planned} release group(s)  ${WRITE ? '*** WRITING ***' : '(dry run — pass --write to apply)'}`);
  if (!rows.length) { console.log('  nothing matched'); return; }

  const db = getDB();
  const ctx = createIngestContext(db, { dryRun: !WRITE, withTracks: !NO_TRACKS, skipSingles: false });

  const total = { groups: 0, editions: 0, tracks: 0 };
  for (const row of rows) {
    const s = await ingestOne(ctx, row);
    total.groups += s.groups; total.editions += s.editions; total.tracks += s.tracks;
  }

  console.log(`\n── ${WRITE ? 'written' : 'would write'} ──────────────────────`);
  console.log(`  release groups  ${total.groups}`);
  console.log(`  editions        ${total.editions}`);
  console.log(`  tracks          ${total.tracks}`);
  if (!WRITE) console.log('\n  dry run — nothing was written. Re-run with --write to apply.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
