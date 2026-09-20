/**
 * Syncs the Instagram "out now" famous-artist watchlist into the REAL rating
 * catalog (artists/release_groups/releases) — not just the standalone ig_*
 * tracking tables. The catalog's Korean-underground focus is a resource
 * constraint, not a permanent exclusion: famous watchlist artists should be
 * genuinely ratable in the app.
 *
 * Reuses ingestArtist(db, mbid) (mb-ingest.ts) as-is — a complete, synchronous,
 * idempotent full-discography ingest already used standalone via
 * mb-ingest-one.ts. It's dedupe-safe by construction (checks
 * artist_external_ids first, upserts everything on mb_*_id with
 * ignoreDuplicates), so it's equally safe whether the artist is brand new to
 * the catalog or already partially present — no separate branching needed.
 *
 *   npx tsx --env-file=.env.local scripts/sync-ig-artists-to-catalog.ts          # incremental
 *   npx tsx --env-file=.env.local scripts/sync-ig-artists-to-catalog.ts --all    # full backfill, every watchlist artist
 *
 * Incremental mode (default): only artists with an ig_detected_releases row
 * where catalog_synced=false get re-ingested, then those rows are marked
 * synced. Since ingestArtist pulls the artist's WHOLE current discography,
 * one call covers every pending detection for that artist at once.
 */
import { getDB, ingestArtist, HeavilyFeaturedError, type DB } from './mb-ingest';

async function artistsToSync(db: DB, all: boolean): Promise<{ id: string; name: string; mbid: string }[]> {
  if (all) {
    const { data, error } = await db.from('ig_famous_artists').select('id, name, mbid').not('mbid', 'is', null);
    if (error) throw new Error(error.message);
    return (data ?? []) as any;
  }
  const { data, error } = await db
    .from('ig_detected_releases')
    .select('famous_artist_id, ig_famous_artists(id, name, mbid)')
    .eq('catalog_synced', false);
  if (error) throw new Error(error.message);
  const byId = new Map<string, { id: string; name: string; mbid: string }>();
  for (const row of (data ?? []) as any[]) {
    const a = row.ig_famous_artists;
    if (a?.mbid) byId.set(a.id, { id: a.id, name: a.name, mbid: a.mbid });
  }
  return [...byId.values()];
}

async function main() {
  const ALL = process.argv.includes('--all');
  const db = getDB();
  const artists = await artistsToSync(db, ALL);

  if (!artists.length) { console.log(ALL ? 'No watchlist artists with an MBID.' : 'Nothing pending sync.'); return; }
  console.log(`${ALL ? 'FULL BACKFILL' : 'INCREMENTAL SYNC'} — ${artists.length} artist(s)\n`);

  let ok = 0, skipped = 0, failed = 0;
  for (const a of artists) {
    try {
      const res = await ingestArtist(db, a.mbid);
      console.log(`  ✓ ${a.name} (${res.isNew ? 'new' : 'existing'}) → ${res.rgCount} release-groups, ${res.recCount} recordings`);
      ok++;
      const { error: upErr } = await db.from('ig_detected_releases').update({ catalog_synced: true }).eq('famous_artist_id', a.id);
      if (upErr) console.log(`    (warning: couldn't mark synced: ${upErr.message})`);
    } catch (e) {
      if (e instanceof HeavilyFeaturedError) { console.log(`  ⚠ ${a.name}: skipped — ${e.message}`); skipped++; }
      else { console.log(`  ✗ ${a.name}: ${(e as Error).message}`); failed++; }
    }
  }
  console.log(`\n=== SUMMARY === synced ${ok} · skipped (heavily-featured) ${skipped} · failed ${failed} (of ${artists.length})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
