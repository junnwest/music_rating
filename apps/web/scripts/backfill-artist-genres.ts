/**
 * Backfill artists.genre_evidence — the artist prior for album placement
 * (lib/genres/placement.ts; migration 20260930000003; GENRE_AUDIT.md §8).
 *
 * Per artist, four sources:
 *   musicbrainz  /ws/2/artist/{mbid}?inc=genres        genres + vote counts (1 req/s, shared limiter)
 *   lastfm       artist.getinfo + artist.gettoptags by MB id (never by name — Last.fm's
 *                autocorrect turns "Ye" into the band Yes). When the bio says the page
 *                merges several same-named artists ("There are 3 artists named Loco…"),
 *                no tags are kept and lastfm_shared_name is set.
 *   wikidata     SPARQL P434 (MB id) → P136 (genre)     batched 50 artists per query
 *   itunes       US storefront search by name + native name; the iTunes artist is the
 *                one whose album titles match ours (exact name first, then most title
 *                hits); karaoke/fitness/children's catalogs are rejected. Stores the
 *                artist's store genre counts + our release group → its store genre.
 *                ~3 calls per artist at ≤ 20/min (the store's soft limit).
 * mb-ingest keeps `musicbrainz` fresh on every ingest / re-poll; this fills the
 * existing catalog and the outside sources.
 *
 * Order (most valuable first): artists with rated albums → artists outside the
 * English-speaking countries or with no country (where album tags are thinnest —
 * 70% of Korean albums have none) → the rest. Resumable through the stored
 * fetched_at: an artist whose sources were all fetched within --stale-days is skipped.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artist-genres.ts [--rated-only] [--only-thin] [--limit=N]
 *       [--stale-days=60] [--sources=musicbrainz,lastfm,wikidata,itunes] [--gap-ms=0] [--dry-run]
 *
 * --gap-ms adds a pause between artists on top of the MB limiter — raise it if this
 * machine shares an IP with the running pipeline (MB limits per IP).
 *
 * Two-pass use (iTunes is the slow source, ~20 calls/min): first everything but iTunes,
 *   npm run backfill:artist-genres -- --sources=musicbrainz,lastfm,wikidata
 * then iTunes only where that left the artist THIN — all three fetched, fewer than
 * --thin-tags (default 3) tags between them (a shared-name Last.fm page counts as none):
 *   npm run backfill:artist-genres -- --only-thin
 * (--only-thin implies --sources=itunes.) Stop any time with Ctrl+C; re-running resumes.
 */
import { getArtist } from './mb-client';
import { getDB } from './mb-ingest';
import { pgRetry } from '../lib/genres/pgRetry';
import {
  mergeArtistGenreEvidence,
  toStoredTags,
  type GenreEvidencePatch,
  type GenreSource,
  type StoredGenreEvidence,
  type StoredItunes,
  type StoredTag,
} from '../lib/genres/artistEvidence';

// A Last.fm bio that opens by saying the page covers several artists.
const N = String.raw`(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|a few|a number of|several|multiple|many|various|numerous|more than one)`;
const WHO = String.raw`(?:different\s+|distinct\s+|separate\s+)?(?:musical\s+)?(?:artists?|bands?|acts?|groups?|musicians?|projects?|singers?|rappers?|djs?|people|performers?|entities)`;
export const LASTFM_SHARED_PAGE = new RegExp(
  String.raw`^\s*(?:1[\).:]\s|there\s+(?:are|is|were|have\s+been)\s+(?:at\s+least\s+|over\s+|more\s+than\s+)?${N}\s+${WHO}|(?:this\s+name\s+)?refers\s+to\s+(?:at\s+least\s+)?${N}\b|.{0,60}?\bis\s+(?:the\s+name\s+of|a\s+name\s+(?:used|shared)\s+by)\s+(?:at\s+least\s+)?${N}\b)`,
  'i',
);

const arg = (f: string) => process.argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(arg('--limit') ?? Infinity);
const STALE_DAYS = Number(arg('--stale-days') ?? 60);
const GAP_MS = Number(arg('--gap-ms') ?? 0);
const DRY = process.argv.includes('--dry-run');
const RATED_ONLY = process.argv.includes('--rated-only');
const ONLY_THIN = process.argv.includes('--only-thin');
const THIN_TAGS = Number(arg('--thin-tags') ?? 3);
const SOURCES = new Set(
  (arg('--sources') ?? (ONLY_THIN ? 'itunes' : 'musicbrainz,lastfm,wikidata,itunes')).split(',') as GenreSource[],
);
const ITUNES_GAP_MS = 3200;
const ENGLISH = new Set(['US', 'GB', 'CA', 'AU', 'IE', 'NZ']);
const UA = 'sillajuku-genre-backfill/1.0 (admin@sillajuku.com)';
const WIKIDATA_BATCH = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (SOURCES.has('lastfm') && !LASTFM_KEY) {
  console.error('LASTFM_API_KEY missing from environment (.env.local) — or pass --sources without lastfm');
  process.exit(1);
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

/** Last.fm tags, or { shared: true } when the page merges same-named artists. */
async function lastfm(mbid: string): Promise<{ tags: StoredTag[]; shared: boolean } | null> {
  const info = await fetchJson(
    `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&mbid=${mbid}&api_key=${LASTFM_KEY}&format=json`,
  );
  if (info?.error === 6) return { tags: [], shared: false }; // not on Last.fm under this id
  if (info?.error) throw new Error(`Last.fm ${info.error}: ${info.message}`);
  await sleep(200);
  if (LASTFM_SHARED_PAGE.test(String(info?.artist?.bio?.summary ?? ''))) return { tags: [], shared: true };
  const tags = await lastfmTags(mbid);
  return tags ? { tags, shared: false } : null;
}

async function lastfmTags(mbid: string): Promise<StoredTag[] | null> {
  const j = await fetchJson(
    `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&mbid=${mbid}&api_key=${LASTFM_KEY}&format=json`,
  );
  if (j?.error === 6) return []; // not on Last.fm under this id
  if (j?.error) throw new Error(`Last.fm ${j.error}: ${j.message}`);
  await sleep(200);
  return toStoredTags(
    ((j?.toptags?.tag ?? []) as { name: string; count: number }[])
      .map((t) => ({ tag: String(t.name).toLowerCase(), count: Number(t.count) }))
      .filter((t) => t.count > 0),
  );
}

/** MB id → Wikidata genre labels, for a batch of artists. */
async function wikidataGenres(mbids: string[]): Promise<Map<string, StoredTag[]>> {
  const q = `SELECT ?m ?gl WHERE { VALUES ?m { ${mbids.map((m) => `"${m}"`).join(' ')} }
    ?e wdt:P434 ?m. ?e wdt:P136 ?g. ?g rdfs:label ?gl FILTER(lang(?gl)="en") }`;
  const j = await fetchJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, {
    Accept: 'application/sparql-results+json',
  });
  const out = new Map<string, StoredTag[]>(mbids.map((m) => [m, []]));
  for (const b of j?.results?.bindings ?? []) {
    const list = out.get(b.m.value);
    const tag = String(b.gl.value).toLowerCase();
    if (list && list.length < 15 && !list.some(([t]) => t === tag)) list.push([tag]);
  }
  return out;
}

/** Title key for matching our release groups with iTunes collections. */
const titleKey = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/ - (single|ep)$/i, '')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
const JUNK_GENRE = /karaoke|fitness|children|soundtrack|holiday|christmas/i;

async function itunesSearch(term: string): Promise<any[]> {
  await sleep(ITUNES_GAP_MS);
  const j = await fetchJson(
    `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'album', country: 'us', limit: '200' })}`,
  );
  return j?.results ?? [];
}

/** The artist on iTunes, matched by album-title overlap with our catalog. */
async function itunesEvidence(
  names: string[],
  ours: { id: string; title: string | null; native_title: string | null }[],
): Promise<StoredItunes> {
  const ourKeys = new Map<string, string>(); // title key → our release group id
  for (const r of ours) for (const t of [r.title, r.native_title]) if (t && titleKey(t)) ourKeys.set(titleKey(t), r.id);
  const cands = new Map<number, { name: string; hits: number }>();
  for (const term of names) {
    for (const x of await itunesSearch(term)) {
      const c = cands.get(x.artistId) ?? { name: String(x.artistName ?? ''), hits: 0 };
      if (ourKeys.has(titleKey(x.collectionName))) c.hits++;
      cands.set(x.artistId, c);
    }
  }
  const wanted = new Set(names.map(titleKey));
  const best = [...cands.entries()]
    .filter(([, c]) => c.hits > 0)
    .sort(
      (x, y) =>
        Number(wanted.has(titleKey(y[1].name))) - Number(wanted.has(titleKey(x[1].name))) || y[1].hits - x[1].hits,
    )[0];
  const none: StoredItunes = { id: null, genres: [], albums: {} };
  if (!best) return none;
  await sleep(ITUNES_GAP_MS);
  const j = await fetchJson(`https://itunes.apple.com/lookup?id=${best[0]}&entity=album&limit=200&country=us`);
  const all = ((j?.results ?? []) as any[]).filter((x) => x.wrapperType === 'collection' && x.artistId === best[0]);
  // A karaoke / tribute catalog that happens to share titles is not the artist.
  if (all.length > 0 && all.filter((x) => /karaoke/i.test(x.primaryGenreName ?? '')).length > all.length / 2) return none;
  const albums = all.filter((x) => x.primaryGenreName && !JUNK_GENRE.test(x.primaryGenreName));
  const counts = new Map<string, number>();
  const mine: Record<string, string> = {};
  for (const x of albums) {
    counts.set(x.primaryGenreName, (counts.get(x.primaryGenreName) ?? 0) + 1);
    const ours = ourKeys.get(titleKey(x.collectionName));
    if (ours && !mine[ours]) mine[ours] = x.primaryGenreName;
  }
  return {
    id: best[0],
    genres: toStoredTags([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }))),
    albums: mine,
  };
}

async function pageAll<T>(label: string, q: (from: number, to: number) => PromiseLike<any>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = (await pgRetry<T[]>(label, () => q(from, from + 999))) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

interface Link {
  artist_id: string;
  external_id: string;
  artists: {
    name: string;
    name_native: string | null;
    country: string | null;
    // Only the small parts of genre_evidence (not iTunes' per-album map) — read for every artist.
    fetched_at: StoredGenreEvidence['fetched_at'] | null;
    musicbrainz: StoredGenreEvidence['musicbrainz'] | null;
    lastfm: StoredGenreEvidence['lastfm'] | null;
    wikidata: StoredGenreEvidence['wikidata'] | null;
    lastfm_shared_name: boolean | null;
  } | null;
}

async function main() {
  const db = getDB();
  const rated = new Set(
    (
      await pageAll<{ release_groups: { primary_artist_id: string } | null }>('rated', (a, b) =>
        db.from('ratings').select('release_groups(primary_artist_id)').order('id').range(a, b),
      )
    ).map((r) => r.release_groups?.primary_artist_id),
  );
  const links = await pageAll<Link>('artists', (a, b) =>
    db
      .from('artist_external_ids')
      .select(
        'artist_id, external_id, artists(name, name_native, country, fetched_at:genre_evidence->fetched_at, ' +
          'musicbrainz:genre_evidence->musicbrainz, lastfm:genre_evidence->lastfm, wikidata:genre_evidence->wikidata, ' +
          'lastfm_shared_name:genre_evidence->lastfm_shared_name)',
      )
      .eq('source', 'musicbrainz')
      .order('artist_id')
      .range(a, b),
  );
  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  /** All three non-iTunes sources fetched, and they said (almost) nothing. */
  const thin = (l: Link) => {
    const ev = l.artists;
    const at = ev?.fetched_at ?? {};
    if (!at.musicbrainz || !at.lastfm || !at.wikidata) return false;
    const n =
      (ev?.musicbrainz?.length ?? 0) +
      (ev?.lastfm_shared_name ? 0 : (ev?.lastfm?.length ?? 0)) +
      (ev?.wikidata?.length ?? 0);
    return n < THIN_TAGS;
  };
  const due = (l: Link) =>
    [...SOURCES].filter((s) => {
      const at = l.artists?.fetched_at?.[s];
      return !at || Date.parse(at) < cutoff;
    });
  const tier = (l: Link) => {
    if (rated.has(l.artist_id)) return 0;
    const c = l.artists?.country;
    return !c || !ENGLISH.has(c) ? 1 : 2;
  };
  const seen = new Set<string>();
  const queue = links
    .filter((l) => !seen.has(l.artist_id) && seen.add(l.artist_id))
    .filter((l) => due(l).length > 0 && (!RATED_ONLY || tier(l) === 0) && (!ONLY_THIN || thin(l)))
    .sort((x, y) => tier(x) - tier(y))
    .slice(0, LIMIT);
  console.log(
    `${links.length} MB artists · ${queue.length} due (rated ${queue.filter((l) => tier(l) === 0).length}, ` +
      `non-English/unknown ${queue.filter((l) => tier(l) === 1).length}, English ${queue.filter((l) => tier(l) === 2).length})` +
      ` · sources ${[...SOURCES].join(',')}${ONLY_THIN ? ` · only thin (< ${THIN_TAGS} tags)` : ''}${DRY ? ' · DRY RUN' : ''}`,
  );

  const started = Date.now();
  let n = 0;
  let changed = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i += WIKIDATA_BATCH) {
    const batch = queue.slice(i, i + WIKIDATA_BATCH);
    let wd: Map<string, StoredTag[]> | null = null;
    if (SOURCES.has('wikidata')) {
      try {
        wd = await wikidataGenres(batch.map((l) => l.external_id));
      } catch (e) {
        console.warn(`\n  wikidata batch failed: ${(e as Error).message}`);
      }
    }
    for (const l of batch) {
      n++;
      const want = due(l);
      const patch: GenreEvidencePatch = {};
      try {
        if (want.includes('musicbrainz')) {
          const detail = await getArtist(l.external_id);
          if (detail) patch.musicbrainz = toStoredTags(detail.genreVotes.map((v) => ({ tag: v.name, count: v.count })));
        }
        if (want.includes('lastfm')) {
          const lf = await lastfm(l.external_id);
          if (lf) {
            patch.lastfm = lf.tags;
            patch.lastfm_shared_name = lf.shared;
          }
        }
        if (want.includes('itunes')) {
          const ours =
            (await pgRetry<{ id: string; title: string | null; native_title: string | null }[]>('titles', () =>
              db.from('release_groups').select('id, title, native_title').eq('primary_artist_id', l.artist_id),
            )) ?? [];
          const names = [...new Set([l.artists?.name, l.artists?.name_native].filter((x): x is string => !!x))];
          if (ours.length > 0 && names.length > 0) patch.itunes = await itunesEvidence(names, ours);
        }
        if (want.includes('wikidata') && wd) patch.wikidata = wd.get(l.external_id) ?? [];
        if (Object.keys(patch).length > 0) {
          if (DRY) {
            if (n <= 10) console.log(`\n  ${l.artists?.name}: ${JSON.stringify(patch).slice(0, 300)}`);
          } else if (await mergeArtistGenreEvidence(db, l.artist_id, patch)) changed++;
        }
      } catch (e) {
        failed++;
        console.warn(`\n  skip ${l.artists?.name ?? l.external_id}: ${(e as Error).message}`);
      }
      if (n % 10 === 0 || n === queue.length) {
        const rate = n / ((Date.now() - started) / 3_600_000);
        process.stdout.write(
          `\r  ${n}/${queue.length} artists · tier ${tier(l)} · ${changed} changed · ${failed} failed · ~${Math.round(rate)}/hr   `,
        );
      }
      if (GAP_MS > 0) await sleep(GAP_MS);
    }
  }
  console.log(`\ndone: ${n} artists · ${changed} changed · ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
