/**
 * Cover-art resolution for the Instagram "out now" pipeline. MusicBrainz release
 * groups (the detection source) don't carry cover art directly, so this fills
 * ig_detected_releases.cover_url for every 'new' row that's missing one.
 *
 * Order: iTunes (searchAlbum + artworkUrl upscale, reused from the existing
 * ingest pipeline) → Deezer (searchAlbums) → MusicBrainz Cover Art Archive as a
 * last resort (existence-checked with a HEAD request before being trusted, since
 * CAA 404s silently for release groups with no uploaded art).
 *
 *   npx tsx --env-file=.env.local scripts/fetch-ig-cover.ts
 *   npx tsx --env-file=.env.local scripts/fetch-ig-cover.ts --limit=20
 */
import { getDB, artworkUrl, detectLanguage, type DB } from './itunes-ingest-core';
import { searchAlbum as itunesSearchAlbum } from './itunes-client';
import { searchAlbums as deezerSearchAlbums } from './deezer-client';

const COUNTRY_TO_LANG: Record<string, string> = { KR: 'ko', JP: 'ja' };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function caaExists(mbid: string): Promise<string | null> {
  const url = `https://coverartarchive.org/release-group/${mbid}/front`;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok ? url : null;
  } catch { return null; }
}

async function resolveCover(row: { title: string; artist_credit: string; release_group_mbid: string; country: string | null }): Promise<{ url: string; via: string } | null> {
  const nativeLang = (row.country && COUNTRY_TO_LANG[row.country]) ?? detectLanguage(row.title);

  const itunes = await itunesSearchAlbum(row.title, row.artist_credit, nativeLang);
  if (itunes?.artworkUrl100) return { url: artworkUrl(itunes.artworkUrl100, 1200), via: 'itunes' };

  const deezer = await deezerSearchAlbums(row.artist_credit, row.title, 3);
  if (deezer[0]?.cover) return { url: deezer[0].cover, via: 'deezer' };

  const caa = await caaExists(row.release_group_mbid);
  if (caa) return { url: caa, via: 'coverartarchive' };

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 50);
  const db: DB = getDB();

  const { data: rows, error } = await db
    .from('ig_detected_releases')
    .select('id, title, artist_credit, release_group_mbid, ig_famous_artists(country)')
    .eq('status', 'new').is('cover_url', null).limit(LIMIT);
  if (error) throw new Error(error.message);
  if (!rows?.length) { console.log('No rows need cover art.'); return; }

  console.log(`Resolving covers for ${rows.length} release(s)…\n`);
  let found = 0, missed = 0;
  for (const r of rows as any[]) {
    const country = r.ig_famous_artists?.country ?? null;
    const hit = await resolveCover({ title: r.title, artist_credit: r.artist_credit, release_group_mbid: r.release_group_mbid, country });
    if (hit) {
      const { error: upErr } = await db.from('ig_detected_releases').update({ cover_url: hit.url }).eq('id', r.id);
      if (upErr) console.log(`  UPDATE FAILED ${r.artist_credit} — ${r.title}: ${upErr.message}`);
      else { found++; console.log(`  ✓ ${r.artist_credit} — ${r.title}  (${hit.via})`); }
    } else {
      missed++;
      console.log(`  ✗ ${r.artist_credit} — ${r.title}  (no cover found — leave for retry next run)`);
    }
    await sleep(250); // gentle on iTunes/Deezer
  }
  console.log(`\n=== SUMMARY === found ${found} · missed ${missed} (of ${rows.length})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
