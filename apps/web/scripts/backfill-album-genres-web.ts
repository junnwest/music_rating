/**
 * Stopgap: per-album genres from store data for UNTAGGED albums of rated artists,
 * so the taste map (and the Taste tab) stop treating them as blanks. The sustainable
 * plan — asking the user to place / classify ambiguous artists — is the README TODO
 * "Taste map: missing genre data".
 *
 * Release groups in scope: every album of an artist someone has rated whose
 * displayed `release_groups.genres` is empty. Per album, first hit wins:
 *   itunes  the store genre already scraped into artists.genre_evidence.itunes.albums
 *           by backfill-artist-genres.ts (no network)
 *   deezer  Deezer's open API: the artist resolved by exact name (Latin or native),
 *           the album by exact normalized title, else a unique exact release date
 *           (the same guards as backfill-native-titles-deezer.ts), then its genre
 * Store genres are coarse and often generic (iTunes files E SENS's rap albums under
 * "K-Pop"), so a store genre is written only when its family agrees with the
 * artist's own MusicBrainz / Last.fm / Wikidata evidence. An artist with none of
 * that gets the store genre anyway (better than a blank) and is listed as
 * AMBIGUOUS at the end: the candidates for asking the user.
 *
 * Writes through lib/genres/sourceWriter.ts as source 'itunes' / 'deezer' (trust
 * 0.55 / 0.6 in the merge), so MB or manual tags arriving later outrank them and
 * re-running replaces only these rows.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-album-genres-web.ts --dry-run [--user=<username>] [--limit=N] [--no-deezer]
 */
import { getDB } from './itunes-ingest-core';
import { searchArtists, artistAlbums, albumWithTracks } from './deezer-client';
import { writeSourceGenres, type SourceGenreInput } from '../lib/genres/sourceWriter';
import { familiesOf, itunesTag, resolveEvidenceTag } from '../lib/genres/placement';

const db = getDB();
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DRY = process.argv.includes('--dry-run');
const NO_DEEZER = process.argv.includes('--no-deezer');
const USER = arg('user');
const LIMIT = Number(arg('limit') ?? Infinity);
const PAGE = 1000;

/** Deezer genre names → a tag we resolve, or null when it says nothing about sound. Unlisted names pass through. */
const DEEZER_GENRE: Record<string, string | null> = {
  'rap/hip hop': 'hip hop',
  electro: 'electronic',
  'r&b': 'r&b',
  'soul & funk': 'soul',
  'singer & songwriter': 'singer-songwriter',
  alternative: null,
  'asian music': null,
  'films/games': null,
  'film scores': null,
  kids: null,
  'latin music': 'latin',
  'indie pop/folk': 'indie folk',
};

const normTight = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const fullDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.endsWith('-01-01') ? d : null);

interface Artist {
  id: string;
  name: string;
  name_native: string | null;
  genre_evidence: {
    musicbrainz?: unknown[][];
    lastfm?: unknown[][];
    wikidata?: unknown[][];
    itunes?: { albums?: Record<string, string> };
  } | null;
}
interface RG {
  id: string;
  title: string;
  primary_artist_id: string;
  first_release_date: string | null;
  genres: string[] | null;
}

async function ratedArtistIds(): Promise<string[]> {
  let userId: string | null = null;
  if (USER) {
    const { data } = await db.from('profiles').select('id').eq('username', USER).single();
    if (!data) throw new Error(`no user ${USER}`);
    userId = data.id;
  }
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q = db.from('ratings').select('id, release_groups(primary_artist_id)').order('id').range(from, from + PAGE - 1);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as { release_groups: { primary_artist_id: string | null } | null }[]) {
      const a = r.release_groups?.primary_artist_id;
      if (a) ids.add(a);
    }
    if ((data ?? []).length < PAGE) break;
  }
  return [...ids].sort();
}

async function inChunks<T>(ids: string[], f: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await f(ids.slice(i, i + 200))));
  return out;
}

/** Families the artist's non-store sources point at. */
function evidenceFamilies(a: Artist): Set<string> {
  const fams = new Set<string>();
  const ev = a.genre_evidence ?? {};
  for (const src of [ev.musicbrainz, ev.lastfm, ev.wikidata]) {
    for (const t of src ?? []) {
      const id = typeof t?.[0] === 'string' ? resolveEvidenceTag(t[0]) : null;
      if (id) for (const f of familiesOf(id)) fams.add(f);
    }
  }
  return fams;
}

/** The store tag, or null; `agrees` = its family is one the artist's evidence names (true when it names none or the tag has none). */
function judge(tag: string | null, fams: Set<string>): { tag: string; agrees: boolean } | null {
  if (!tag) return null;
  const id = resolveEvidenceTag(tag);
  if (!id) return null;
  const own = familiesOf(id);
  // A family-less tag (singer-songwriter) can't contradict anything.
  if (!fams.size || !own.length) return { tag, agrees: true };
  return { tag, agrees: own.some((f) => fams.has(f)) };
}

async function deezerGenres(a: Artist, rgs: RG[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const names = new Set([normTight(a.name), normTight(a.name_native)].filter(Boolean));
  const hits = (await searchArtists(a.name_native || a.name, 5)).filter((d) => names.has(normTight(d.name)));
  if (hits.length !== 1) return out;
  const albums = await artistAlbums(hits[0].id, 200);
  for (const rg of rgs) {
    let match = albums.filter((d) => normTight(d.title) === normTight(rg.title));
    if (match.length !== 1) {
      const day = fullDate(rg.first_release_date);
      const sameDay = day ? albums.filter((d) => d.releaseDate === day) : [];
      match = sameDay.length === 1 ? sameDay : [];
    }
    if (match.length !== 1) continue;
    const detail = await albumWithTracks(match[0].id, false);
    const g = detail?.genre?.trim();
    if (!g) continue;
    const key = g.toLowerCase();
    const tag = key in DEEZER_GENRE ? DEEZER_GENRE[key] : g;
    if (tag) out.set(rg.id, tag);
  }
  return out;
}

async function main() {
  const artistIds = await ratedArtistIds();
  const artists = await inChunks(artistIds, async (c) => {
    const { data, error } = await db.from('artists').select('id, name, name_native, genre_evidence').in('id', c);
    if (error) throw new Error(error.message);
    return (data ?? []) as Artist[];
  });
  const rgs = await inChunks(artistIds, async (c) => {
    const out: RG[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('release_groups')
        .select('id, title, primary_artist_id, first_release_date, genres')
        .in('primary_artist_id', c)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...((data ?? []) as RG[]));
      if ((data ?? []).length < PAGE) break;
    }
    return out;
  });
  const empty = rgs.filter((r) => !r.genres?.length);
  const byArtist = new Map<string, RG[]>();
  for (const r of empty) byArtist.set(r.primary_artist_id, [...(byArtist.get(r.primary_artist_id) ?? []), r]);
  console.log(`${artists.length} rated artists · ${rgs.length} albums · ${empty.length} untagged · ${DRY ? 'DRY RUN' : 'WRITE'}`);

  const writes: Record<'itunes' | 'deezer', SourceGenreInput[]> = { itunes: [], deezer: [] };
  const ambiguous: string[] = [];
  let skipped = 0;
  let done = 0;
  for (const a of artists.sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const todo = byArtist.get(a.id);
    if (!todo?.length) continue;
    if (done++ >= LIMIT) break;
    const fams = evidenceFamilies(a);
    const stored = a.genre_evidence?.itunes?.albums ?? {};
    let rest: RG[] = [];
    const lines: string[] = [];
    for (const rg of todo) {
      const j = judge(itunesTag(stored[rg.id]), fams);
      if (j?.agrees) {
        writes.itunes.push({ releaseGroupId: rg.id, title: rg.title, tags: [{ tag: j.tag }] });
        lines.push(`${rg.title} ← itunes ${j.tag}`);
      } else {
        if (j) lines.push(`${rg.title} ✗ itunes ${j.tag} (disagrees)`);
        rest.push(rg);
      }
    }
    if (rest.length && !NO_DEEZER) {
      let dz = new Map<string, string>();
      try {
        dz = await deezerGenres(a, rest);
      } catch (e) {
        console.warn(`  ${a.name}: deezer failed (${(e as Error).message})`);
      }
      const left: RG[] = [];
      for (const rg of rest) {
        const j = judge(dz.get(rg.id) ?? null, fams);
        if (j?.agrees) {
          writes.deezer.push({ releaseGroupId: rg.id, title: rg.title, tags: [{ tag: j.tag }] });
          lines.push(`${rg.title} ← deezer ${j.tag}`);
        } else {
          if (j) lines.push(`${rg.title} ✗ deezer ${j.tag} (disagrees)`);
          left.push(rg);
        }
      }
      rest = left;
    }
    skipped += rest.length;
    const wrote = todo.length - rest.length;
    if (!fams.size && wrote) ambiguous.push(`${a.name} (${wrote} albums, store genres only)`);
    console.log(`${a.name}: ${wrote}/${todo.length} filled${fams.size ? '' : ' · no artist evidence'}`);
    for (const l of lines) console.log(`    ${l}`);
  }

  for (const source of ['itunes', 'deezer'] as const) {
    if (!writes[source].length) continue;
    const r = await writeSourceGenres(db, source, writes[source], { dryRun: DRY });
    console.log(`${source}: ${writes[source].length} albums · upserted ${r.upserted} · unchanged ${r.unchanged} · unmapped staged ${r.unmappedStaged}`);
  }
  console.log(`still untagged: ${skipped}`);
  if (ambiguous.length) console.log(`AMBIGUOUS (ask the user):\n  ${ambiguous.join('\n  ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
