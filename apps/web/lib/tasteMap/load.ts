/**
 * Taste map loader (TASTE_MAP_PLAN.md Phase 0/1): DB → MapUserInput.
 *
 * Server-only (service-role or user Supabase client). The only impure stage of
 * the map pipeline; everything downstream (eras → features → layout) is a pure
 * function of what this returns.
 *
 * What it loads:
 *   1. The user's album ratings (`ratings`, Taste is albums only), paged by id.
 *      Score = the taste system's display score: `ratings.score`, else the Elo
 *      curve of `_rating_display_score()` while `ratings.elo_score` still exists.
 *   2. Each rated album's primary artist → name / native name / country /
 *      `artists.genre_evidence`.
 *   3. Every non-single catalog release group of those artists (primary artist),
 *      rated or not, so eras can split on the whole discography. Explicit
 *      bootlegs (`is_official = false`) are left out unless the user rated them.
 *      Rated albums are always included, whatever their type.
 *   4. jina-embeddings-v3 vectors from `release_groups.embedding` (1024-d; the
 *      live column — `releases.embedding` is the pre-renovation one), read in
 *      small id batches because each vector is ~12 KB of text over PostgREST.
 *   5. Similar artists from `artist_similar` (Phase 1 migration). Read
 *      defensively: when the table doesn't exist yet every artist gets `[]`.
 *
 * Micro-instance rules: every bulk read is batched (`in()` ≤ 200 ids, fewer
 * for embedding rows), paged with a stable ORDER BY past PostgREST's 1000-row
 * clamp, and run with bounded concurrency.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { yearOf } from '../taste/albumVector';
import type { MapAlbumInput, MapArtistInput, MapUserInput, SimilarArtist } from './types';

const PAGE = 1000;
const ID_CHUNK = 200;
/** Artists per catalog query; small so one prolific artist can't crowd out the rest. */
const ARTIST_CHUNK = 50;
/** Catalog pages read per artist chunk (a chunk larger than this is truncated). */
const CATALOG_PAGES = 8;
/** Embedding rows per request (~12 KB each as text). */
const EMBED_CHUNK = 100;
const CONCURRENCY = 4;
/** MusicBrainz "Various Artists" — never expand its catalog. */
const VARIOUS_ARTISTS = '89ad4ac3-39f7-470e-963a-56509c546377';

const RG_COLS = 'id, title, primary_artist_id, first_release_date, genres, title_language, cover_url, release_group_type, is_official';

interface RgRow {
  id: string;
  title: string;
  primary_artist_id: string | null;
  first_release_date: string | null;
  genres: string[] | null;
  title_language: string | null;
  cover_url: string | null;
  release_group_type: string | null;
  is_official: boolean | null;
}

interface RatingRow {
  id: string;
  score: number | string | null;
  elo_score?: number | string | null;
  release_groups: RgRow | null;
}

interface ArtistRow {
  id: string;
  name: string;
  name_native: string | null;
  country: string | null;
  genre_evidence: unknown;
}

/** Diagnostics the dump script prints; not part of the contract. */
export interface LoadStats {
  ratings: number;
  ratedAlbums: number;
  ratedWithoutArtist: number;
  /** Artist chunks whose catalog hit CATALOG_PAGES (some albums missing). */
  truncatedChunks: number;
  skippedArtists: string[];
  similarTableMissing: boolean;
  ms: number;
}

export interface LoadOptions {
  /** Skip the embedding read (much faster; every embedding is null). */
  embeddings?: boolean;
  onStats?: (s: LoadStats) => void;
}

/** Mirror of SQL `_rating_display_score(score, elo)` (20260712000009). */
export function displayScore(score: number | string | null | undefined, elo: number | string | null | undefined): number | null {
  if (score != null && score !== '') return Number(score);
  if (elo != null && elo !== '') {
    const s = 5 / (1 + Math.pow(10, (1500 - Number(elo)) / 250));
    return Math.round(Math.min(5, Math.max(0, s)) * 10) / 10;
  }
  return null;
}

/** pgvector over PostgREST comes back as the text "[0.1,0.2,…]"; accept arrays too. */
export function parseVector(v: unknown): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s.startsWith('[')) return null;
    try {
      const arr = JSON.parse(s) as unknown;
      return Array.isArray(arr) ? arr.map(Number) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Run `fn` over items with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === 'PGRST205' || err.code === '42P01' || /could not find the table|does not exist/i.test(err.message ?? '');
}

async function loadRatings(db: SupabaseClient, userId: string): Promise<RatingRow[]> {
  const read = async (cols: string) => {
    const rows: RatingRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('ratings')
        .select(`id, ${cols}, release_groups(${RG_COLS})`)
        .eq('user_id', userId)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) return { rows, error };
      rows.push(...((data ?? []) as unknown as RatingRow[]));
      if ((data ?? []).length < PAGE) return { rows, error: null };
    }
  };
  // elo_score is dropped by 20260810010000_remove_instinct_mode; fall back once it's gone.
  let res = await read('score, elo_score');
  if (res.error && (res.error.code === '42703' || /elo_score/.test(res.error.message))) res = await read('score');
  if (res.error) throw new Error(`[tasteMap/load] ratings: ${res.error.message}`);
  return res.rows;
}

async function loadArtists(db: SupabaseClient, ids: string[]): Promise<Map<string, ArtistRow>> {
  const out = new Map<string, ArtistRow>();
  await pool(chunks(ids, ID_CHUNK), CONCURRENCY, async (chunk) => {
    const { data, error } = await db.from('artists').select('id, name, name_native, country, genre_evidence').in('id', chunk);
    if (error) throw new Error(`[tasteMap/load] artists: ${error.message}`);
    for (const r of (data ?? []) as ArtistRow[]) out.set(r.id, r);
  });
  return out;
}

async function loadCatalog(db: SupabaseClient, artistIds: string[], stats: LoadStats): Promise<RgRow[]> {
  const rows: RgRow[] = [];
  await pool(chunks(artistIds, ARTIST_CHUNK), CONCURRENCY, async (chunk) => {
    for (let page = 0; page < CATALOG_PAGES; page++) {
      const { data, error } = await db
        .from('release_groups')
        .select(RG_COLS)
        .in('primary_artist_id', chunk)
        .or('release_group_type.is.null,release_group_type.neq.single')
        .order('id')
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(`[tasteMap/load] catalog: ${error.message}`);
      rows.push(...((data ?? []) as RgRow[]));
      if ((data ?? []).length < PAGE) return;
    }
    stats.truncatedChunks += 1;
  });
  return rows;
}

async function loadEmbeddings(db: SupabaseClient, rgIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  await pool(chunks(rgIds, EMBED_CHUNK), CONCURRENCY, async (chunk) => {
    const { data, error } = await db.from('release_groups').select('id, embedding').in('id', chunk).not('embedding', 'is', null);
    if (error) throw new Error(`[tasteMap/load] embeddings: ${error.message}`);
    for (const r of (data ?? []) as { id: string; embedding: unknown }[]) {
      const v = parseVector(r.embedding);
      if (v && v.length > 0) out.set(r.id, v);
    }
  });
  return out;
}

type SimilarBySource = MapArtistInput['similar'];

/**
 * `artist_similar.similar` is written by scripts/backfill-artist-similar.ts. Accept
 * an array of items, or `{ items: [...] }` / `{ similar: [...] }`, with
 * snake_case or camelCase keys and a string or numeric match.
 */
function parseSimilarItems(raw: unknown): SimilarArtist[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).items ?? (raw as Record<string, unknown>).similar ?? (raw as Record<string, unknown>).artists)
      : null;
  if (!Array.isArray(list)) return [];
  const out: SimilarArtist[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : null;
    if (!name) continue;
    const mbid = typeof o.mbid === 'string' && o.mbid ? o.mbid : typeof o.artist_mbid === 'string' && o.artist_mbid ? o.artist_mbid : null;
    const artistId =
      typeof o.artistId === 'string' && o.artistId ? o.artistId : typeof o.artist_id === 'string' && o.artist_id ? o.artist_id : null;
    const m = Number(o.match ?? o.score ?? 0);
    out.push({ name, mbid, artistId, match: Number.isFinite(m) ? Math.max(0, Math.min(1, m)) : 0 });
  }
  return out;
}

async function loadSimilar(db: SupabaseClient, artistIds: string[], stats: LoadStats): Promise<Map<string, SimilarBySource>> {
  const out = new Map<string, SimilarBySource>();
  const probe = await db.from('artist_similar').select('artist_id').limit(1);
  if (probe.error) {
    if (isMissingRelation(probe.error)) {
      stats.similarTableMissing = true;
      return out;
    }
    throw new Error(`[tasteMap/load] artist_similar: ${probe.error.message}`);
  }
  await pool(chunks(artistIds, ID_CHUNK), CONCURRENCY, async (chunk) => {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('artist_similar')
        .select('artist_id, source, similar')
        .in('artist_id', chunk)
        .order('artist_id')
        .order('source')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`[tasteMap/load] artist_similar: ${error.message}`);
      for (const r of (data ?? []) as { artist_id: string; source: string; similar: unknown }[]) {
        if (r.source !== 'lastfm' && r.source !== 'listenbrainz') continue;
        const list = out.get(r.artist_id) ?? [];
        list.push({ source: r.source, items: parseSimilarItems(r.similar) });
        out.set(r.artist_id, list);
      }
      if ((data ?? []).length < PAGE) break;
    }
  });

  // Resolve catalog ids for items that only carry an MBID. artists.id is a uuid
  // since the db renovation; the MBID lives in artist_external_ids.
  const unresolved = new Set<string>();
  for (const srcs of out.values()) for (const s of srcs) for (const it of s.items) if (!it.artistId && it.mbid) unresolved.add(it.mbid);
  if (unresolved.size > 0) {
    const byMbid = new Map<string, string>();
    await pool(chunks([...unresolved], ID_CHUNK), CONCURRENCY, async (chunk) => {
      const { data, error } = await db
        .from('artist_external_ids')
        .select('artist_id, external_id')
        .eq('source', 'musicbrainz')
        .in('external_id', chunk);
      if (error) return; // leave unresolved
      for (const r of (data ?? []) as { artist_id: string; external_id: string }[]) byMbid.set(r.external_id, r.artist_id);
    });
    for (const srcs of out.values())
      for (const s of srcs)
        for (const it of s.items) if (!it.artistId && it.mbid) it.artistId = byMbid.get(it.mbid) ?? null;
  }
  return out;
}

export async function loadMapUserInput(db: SupabaseClient, userId: string, opts: LoadOptions = {}): Promise<MapUserInput> {
  const t0 = Date.now();
  const stats: LoadStats = {
    ratings: 0,
    ratedAlbums: 0,
    ratedWithoutArtist: 0,
    truncatedChunks: 0,
    skippedArtists: [],
    similarTableMissing: false,
    ms: 0,
  };

  const [profileRes, ratings] = await Promise.all([
    db.from('profiles').select('username').eq('id', userId).maybeSingle(),
    loadRatings(db, userId),
  ]);
  if (profileRes.error) throw new Error(`[tasteMap/load] profile: ${profileRes.error.message}`);
  const username = (profileRes.data as { username: string | null } | null)?.username ?? '';
  stats.ratings = ratings.length;

  // Rated album → display score. A ratings row with no score still counts as rated.
  const rated = new Map<string, { rg: RgRow; score: number | null }>();
  for (const r of ratings) {
    const rg = r.release_groups;
    if (!rg) continue;
    if (!rg.primary_artist_id) {
      stats.ratedWithoutArtist += 1;
      continue;
    }
    rated.set(rg.id, { rg, score: displayScore(r.score, r.elo_score) });
  }
  stats.ratedAlbums = rated.size;

  const artistIds = [...new Set([...rated.values()].map((x) => x.rg.primary_artist_id!))];
  const expand = artistIds.filter((id) => id !== VARIOUS_ARTISTS);
  stats.skippedArtists = artistIds.filter((id) => id === VARIOUS_ARTISTS);

  const [artistRows, catalog, similar] = await Promise.all([
    loadArtists(db, artistIds),
    loadCatalog(db, expand, stats),
    loadSimilar(db, artistIds, stats),
  ]);

  // Catalog ∪ rated, deduped; bootlegs only when rated.
  const rgs = new Map<string, RgRow>();
  for (const rg of catalog) if (rg.is_official !== false && rg.primary_artist_id) rgs.set(rg.id, rg);
  for (const { rg } of rated.values()) rgs.set(rg.id, rg);

  const embeddings = opts.embeddings === false ? new Map<string, number[]>() : await loadEmbeddings(db, [...rgs.keys()]);

  const byArtist = new Map<string, MapAlbumInput[]>();
  for (const rg of rgs.values()) {
    const r = rated.get(rg.id);
    const album: MapAlbumInput = {
      id: rg.id,
      title: rg.title,
      artistId: rg.primary_artist_id!,
      year: yearOf(rg.first_release_date),
      genres: rg.genres ?? [],
      titleLanguage: rg.title_language,
      type: rg.release_group_type,
      coverUrl: rg.cover_url,
      embedding: embeddings.get(rg.id) ?? null,
      score: r?.score ?? null,
      rated: !!r,
    };
    const list = byArtist.get(album.artistId) ?? [];
    list.push(album);
    byArtist.set(album.artistId, list);
  }

  const artists: MapArtistInput[] = artistIds.map((id) => {
    const a = artistRows.get(id);
    const albums = (byArtist.get(id) ?? []).sort(
      (x, y) => (x.year ?? 9999) - (y.year ?? 9999) || x.title.localeCompare(y.title) || x.id.localeCompare(y.id),
    );
    return {
      id,
      name: a?.name ?? id,
      nameNative: a?.name_native ?? null,
      country: a?.country ?? null,
      genreEvidence: a?.genre_evidence ?? null,
      similar: similar.get(id) ?? [],
      albums,
    };
  });
  artists.sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));

  stats.ms = Date.now() - t0;
  opts.onStats?.(stats);
  return { userId, username, artists };
}

// ── Per-artist loader (Phase 4: era editor, "Add artist" placement) ──────────

export interface ArtistLoadOptions {
  /** Mark the albums this user rated (rated + score), any release type, as loadMapUserInput does. Omit for an unrated candidate. */
  userId?: string;
  /** Skip the embedding read (every embedding is null). */
  embeddings?: boolean;
}

/** The user's ratings of release groups by these artists, joined like loadRatings. */
async function loadRatingsForArtists(
  db: SupabaseClient,
  userId: string,
  artistIds: string[],
): Promise<Map<string, { rg: RgRow; score: number | null }>> {
  const read = async (cols: string) => {
    const rows: RatingRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('ratings')
        .select(`id, ${cols}, release_groups!inner(${RG_COLS})`)
        .eq('user_id', userId)
        .in('release_groups.primary_artist_id', artistIds)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) return { rows, error };
      rows.push(...((data ?? []) as unknown as RatingRow[]));
      if ((data ?? []).length < PAGE) return { rows, error: null };
    }
  };
  let res = await read('score, elo_score');
  if (res.error && (res.error.code === '42703' || /elo_score/.test(res.error.message))) res = await read('score');
  if (res.error) throw new Error(`[tasteMap/load] ratings: ${res.error.message}`);
  const out = new Map<string, { rg: RgRow; score: number | null }>();
  for (const r of res.rows) {
    const rg = r.release_groups;
    if (rg?.primary_artist_id && artistIds.includes(rg.primary_artist_id)) out.set(rg.id, { rg, score: displayScore(r.score, r.elo_score) });
  }
  return out;
}

/**
 * Load specific artists as MapArtistInput, through the same queries as
 * loadMapUserInput (artists, catalog, artist_similar, embeddings): every
 * non-single official catalog album, chronological. With `userId`, the user's
 * rated albums of these artists are marked rated (with score) and included
 * whatever their type; without it every album is unrated (an "Add artist"
 * candidate). Unknown artist ids are left out of the result.
 */
export async function loadArtistInputs(
  db: SupabaseClient,
  artistIds: string[],
  opts: ArtistLoadOptions = {},
): Promise<MapArtistInput[]> {
  const ids = [...new Set(artistIds)];
  if (!ids.length) return [];
  const stats: LoadStats = {
    ratings: 0,
    ratedAlbums: 0,
    ratedWithoutArtist: 0,
    truncatedChunks: 0,
    skippedArtists: [],
    similarTableMissing: false,
    ms: 0,
  };
  const expand = ids.filter((id) => id !== VARIOUS_ARTISTS);
  const [artistRows, catalog, similar, rated] = await Promise.all([
    loadArtists(db, ids),
    loadCatalog(db, expand, stats),
    loadSimilar(db, ids, stats),
    opts.userId ? loadRatingsForArtists(db, opts.userId, ids) : Promise.resolve(new Map<string, { rg: RgRow; score: number | null }>()),
  ]);

  const rgs = new Map<string, RgRow>();
  for (const rg of catalog) if (rg.is_official !== false && rg.primary_artist_id) rgs.set(rg.id, rg);
  for (const { rg } of rated.values()) rgs.set(rg.id, rg);
  const embeddings = opts.embeddings === false ? new Map<string, number[]>() : await loadEmbeddings(db, [...rgs.keys()]);

  const byArtist = new Map<string, MapAlbumInput[]>();
  for (const rg of rgs.values()) {
    const r = rated.get(rg.id);
    const album: MapAlbumInput = {
      id: rg.id,
      title: rg.title,
      artistId: rg.primary_artist_id!,
      year: yearOf(rg.first_release_date),
      genres: rg.genres ?? [],
      titleLanguage: rg.title_language,
      type: rg.release_group_type,
      coverUrl: rg.cover_url,
      embedding: embeddings.get(rg.id) ?? null,
      score: r?.score ?? null,
      rated: !!r,
    };
    const list = byArtist.get(album.artistId) ?? [];
    list.push(album);
    byArtist.set(album.artistId, list);
  }

  return ids
    .filter((id) => artistRows.has(id))
    .map((id) => {
      const a = artistRows.get(id)!;
      const albums = (byArtist.get(id) ?? []).sort(
        (x, y) => (x.year ?? 9999) - (y.year ?? 9999) || x.title.localeCompare(y.title) || x.id.localeCompare(y.id),
      );
      return {
        id,
        name: a.name ?? id,
        nameNative: a.name_native ?? null,
        country: a.country ?? null,
        genreEvidence: a.genre_evidence ?? null,
        similar: similar.get(id) ?? [],
        albums,
      };
    });
}
