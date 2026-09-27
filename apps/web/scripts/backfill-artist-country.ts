/**
 * Fills `artists.country` from MusicBrainz for artists that have an MB id but no
 * country. 60k+ rows were created before MB had a country for them (or via a
 * path that never set one), and nothing revisited them — the Taste page's
 * country mix showed those as "Unknown". The pipeline now self-heals on each
 * re-poll (mb-ingest findOrCreateArtistByMbid); this catches up the backlog.
 *
 * Only ever fills a NULL; an existing country is never overwritten. Uses
 * mb-client's getArtist, so MB's rate limit and User-Agent are handled there,
 * and country falls back to the area's ISO code (artistCountry).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artist-country.ts --rated     # artists behind a rating first
 *   npx tsx --env-file=.env.local scripts/backfill-artist-country.ts --limit=500 # most-ingested artists first
 *   add --dry-run to report without writing
 */
import { getDB } from './itunes-ingest-core';
import { getArtist } from './mb-client';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const RATED = args.includes('--rated');
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1]) || Infinity;
const db = getDB();

async function ratedArtistIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('ratings')
      .select('release_groups(primary_artist_id)')
      .range(from, from + 999);
    if (error) throw new Error(`ratings: ${error.message}`);
    for (const r of (data as any[]) ?? []) {
      const id = r.release_groups?.primary_artist_id;
      if (id) ids.add(id);
    }
    if (!data || data.length < 1000) break;
  }
  return [...ids];
}

/** Null-country artist ids to process, in priority order. */
async function candidates(): Promise<string[]> {
  if (RATED) {
    const rated = await ratedArtistIds();
    const out: string[] = [];
    for (let i = 0; i < rated.length; i += 200) {
      const { data, error } = await db
        .from('artists')
        .select('id')
        .in('id', rated.slice(i, i + 200))
        .is('country', null);
      if (error) throw new Error(`artists: ${error.message}`);
      out.push(...((data as { id: string }[]) ?? []).map((r) => r.id));
    }
    return out;
  }
  const out: string[] = [];
  for (let from = 0; out.length < LIMIT; from += 1000) {
    const { data, error } = await db
      .from('artists')
      .select('id')
      .is('country', null)
      .order('mb_rg_count', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`artists: ${error.message}`);
    out.push(...((data as { id: string }[]) ?? []).map((r) => r.id));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const ids = (await candidates()).slice(0, LIMIT);
  console.log(`${ids.length} null-country artist(s) to check${DRY ? ' (dry run)' : ''}`);
  let filled = 0, noMbid = 0, mbHasNone = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data: links, error } = await db
      .from('artist_external_ids')
      .select('artist_id, external_id')
      .eq('source', 'musicbrainz')
      .in('artist_id', batch);
    if (error) throw new Error(`artist_external_ids: ${error.message}`);
    const mbidOf = new Map(((links as { artist_id: string; external_id: string }[]) ?? []).map((l) => [l.artist_id, l.external_id]));
    for (const id of batch) {
      const mbid = mbidOf.get(id);
      if (!mbid) { noMbid++; continue; }
      try {
        const detail = await getArtist(mbid);
        if (!detail?.country) { mbHasNone++; continue; }
        if (!DRY) {
          const { error: upErr } = await db.from('artists').update({ country: detail.country }).eq('id', id).is('country', null);
          if (upErr) throw new Error(upErr.message);
        }
        filled++;
        console.log(`  ${detail.country}  ${detail.name}`);
      } catch (e) {
        failed++;
        console.warn(`  ! ${id} (${mbid}): ${(e as Error).message}`);
      }
    }
    console.log(`[${Math.min(i + 100, ids.length)}/${ids.length}] filled ${filled} · MB has none ${mbHasNone} · no MB id ${noMbid} · failed ${failed}`);
  }
  console.log(`done: filled ${filled} · MB has none ${mbHasNone} · no MB id ${noMbid} · failed ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
