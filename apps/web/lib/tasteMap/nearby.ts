/**
 * "What's here?" suggestions: unrated catalog albums that would sit at a point
 * of the user's map (GET /api/taste/map/nearby). The inverse of place.ts: there
 * an artist is given and we find its spot; here the spot is given (as the map
 * nodes around it, with the client's kernel weights) and we find albums.
 *
 *   1. Query. Each nearby node's tag vector is built the way features.ts builds
 *      the map's tags block (rated albums 1, unrated catalog albums 0.35, plus
 *      the artist prior at 0.3, language-qualified taxonomy closure), then the
 *      nodes are mixed by kernel weight. The same nodes' Last.fm / ListenBrainz
 *      similar-artist lists, mixed the same way, give a listener-graph affinity
 *      per catalog artist.
 *   2. Candidates (two cheap indexed reads, no vector math in Postgres):
 *      albums by the most-affine similar artists, and albums carrying the
 *      query's leading tags (restricted to that language's countries), both
 *      prestige-first. Albums/EPs with a cover only; rated albums excluded.
 *   3. Rank in Node: 0.55·tag cosine + 0.35·graph affinity + 0.10·prestige,
 *      artists already on the map ×0.4 (surface new artists), one album per
 *      artist. `why` names the nodes that pull hardest and the shared tags.
 *
 * Jina embeddings are deliberately not used: they embed "title by artist.
 * tags (year)" text (see get_taste_similar_releases' notes), so they add title
 * noise on top of the tags already used here, and a multi-seed HNSW lookup
 * costs seconds on the Micro instance.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { countriesOfLanguage, qualifiedInfo } from '../genres/language';
import { releasedFilter } from '../releaseWindow';
import { yearOf } from '../taste/albumVector';
import { synonymsOf } from '../taste/genreSynonyms';
import { albumLang, albumTagVector, chronological, countsForMap } from './eras';
import { ARTIST_EVIDENCE_WEIGHT, artistLang, evidenceVector, UNRATED_ALBUM_WEIGHT } from './features';
import { loadArtistInputs } from './load';
import type { MapAlbumInput, MapArtistInput, NodeKey } from './types';
import { isFiniteNumber, isNodeKey, type Validated } from './validate';

// ── contract ─────────────────────────────────────────────────────────────────

export interface NearbyAlbum {
  id: string; // release_groups.id → /album/<id>
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  /** "near Radiohead · Coldplay · Art Rock" */
  why: string;
  /** Map nodes (artist names) that pull hardest toward this album, strongest first. */
  near: string[];
  /** Shared genre labels, strongest first. */
  tags: string[];
}

export interface NearbyResponse {
  albums: NearbyAlbum[];
}

// ── knobs ────────────────────────────────────────────────────────────────────

export const NEARBY_MAX_KEYS = 12;
export const NEARBY_LIMIT = 6;
const W_TAG = 0.55;
const W_GRAPH = 0.35;
const W_PRESTIGE = 0.1;
/** Untagged candidates: neither a match nor a mismatch. */
const TAG_NEUTRAL = 0.3;
/** Artists the user already rated (on the map) are kept, but pushed down. */
export const ON_MAP_FACTOR = 0.4;
/** Graph affinity below this is treated as "weak graph" (no inflation by normalizing). */
const GRAPH_FLOOR = 0.3;
const GRAPH_ARTISTS = 40;
const GRAPH_POOL = 300;
const TAG_POOL = 150;
const POOL_TAGS = 4;
const POOL_LANGS = 2;
const NAMED_NODES = 2;
const NAMED_TAGS = 2;

// ── input validation ─────────────────────────────────────────────────────────

export interface NearbyNode {
  key: NodeKey;
  /** Normalized: the query's weights sum to 1. */
  w: number;
}

/**
 * `keys=k1,k2&w=0.5,0.2`: node keys and their non-negative kernel weights, same
 * length, ≤ NEARBY_MAX_KEYS, at least one positive weight. Duplicates are
 * summed. Returns nodes sorted by key (stable cache key), weights summing to 1.
 */
export function parseNearbyQuery(keysParam: string | null, wParam: string | null): Validated<NearbyNode[]> {
  if (!keysParam) return { ok: false, error: 'keys is required' };
  const keys = keysParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (!keys.length) return { ok: false, error: 'keys is required' };
  if (keys.length > NEARBY_MAX_KEYS) return { ok: false, error: `at most ${NEARBY_MAX_KEYS} keys` };
  if (!keys.every(isNodeKey)) return { ok: false, error: 'keys must be map node keys' };
  let ws: number[];
  if (wParam == null || wParam === '') ws = keys.map(() => 1);
  else {
    const parts = wParam.split(',');
    if (parts.length !== keys.length) return { ok: false, error: 'w must have one weight per key' };
    ws = parts.map((s) => (s.trim() === '' ? NaN : Number(s)));
    if (!ws.every((x) => isFiniteNumber(x) && x >= 0 && x <= 1e6)) return { ok: false, error: 'weights must be finite and ≥ 0' };
  }
  const by = new Map<NodeKey, number>();
  keys.forEach((k, i) => by.set(k, (by.get(k) ?? 0) + ws[i]));
  const total = [...by.values()].reduce((s, x) => s + x, 0);
  if (!(total > 0)) return { ok: false, error: 'at least one weight must be positive' };
  const nodes = [...by]
    .filter(([, w]) => w > 0)
    .map(([key, w]) => ({ key, w: w / total }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { ok: true, value: nodes };
}

/** Stable cache-key fragment: keys with weights rounded to 2 decimals. */
export function nearbyQueryHash(nodes: NearbyNode[]): string {
  return nodes.map((n) => `${n.key}=${n.w.toFixed(2)}`).join(',');
}

export function artistIdOfKey(key: NodeKey): string {
  return key.split(':')[1];
}

// ── small vector helpers (sparse, Map-based) ─────────────────────────────────

type Sparse = Map<string, number>;

function unitSparse(v: Sparse): Sparse {
  let s = 0;
  for (const x of v.values()) s += x * x;
  const n = Math.sqrt(s);
  if (!(n > 1e-12)) return new Map();
  return new Map([...v].map(([k, x]) => [k, x / n]));
}

function dotSparse(a: Sparse, b: Sparse): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let s = 0;
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y) s += x * y;
  }
  return s;
}

function addInto(into: Sparse, v: Sparse, w: number): void {
  for (const [k, x] of v) into.set(k, (into.get(k) ?? 0) + w * x);
}

// ── query: node vectors ──────────────────────────────────────────────────────

/**
 * The albums behind a node. Whole-artist key: every album that counts for the
 * map. Era key `e:<artist>:<firstAlbum>`: chronological from that album up to
 * the next era start among `eraStarts` (the other era keys of the same artist
 * in the request); without it, to the end. Exact era bounds would need the
 * stored overrides and the embedding-based split, which this route avoids.
 */
export function nodeAlbums(artist: MapArtistInput, key: NodeKey, eraStarts: string[] = []): MapAlbumInput[] {
  const sorted = chronological(artist.albums.filter(countsForMap));
  if (!key.startsWith('e:')) return sorted;
  const first = key.split(':')[2];
  const from = sorted.findIndex((a) => a.id === first);
  if (from < 0) return sorted;
  const starts = new Set(eraStarts.filter((id) => id !== first));
  let to = sorted.length;
  for (let i = from + 1; i < sorted.length; i++)
    if (starts.has(sorted[i].id)) {
      to = i;
      break;
    }
  return sorted.slice(from, to);
}

/** A node's tag vector as features.ts pools it (before IDF), L2-normalized. */
export function nodeTagVector(artist: MapArtistInput, albums: MapAlbumInput[]): Sparse {
  const pool: Sparse = new Map();
  let wsum = 0;
  for (const a of albums) {
    const v = albumTagVector(a, albumLang(a, artist));
    if (!v.size) continue;
    const w = a.rated ? 1 : UNRATED_ALBUM_WEIGHT;
    wsum += w;
    addInto(pool, v, w);
  }
  if (wsum > 0) for (const [q, x] of pool) pool.set(q, x / wsum);
  const lang = artistLang(artist.albums.map((a) => albumLang(a, artist)));
  addInto(pool, evidenceVector(artist.genreEvidence, lang).vec, ARTIST_EVIDENCE_WEIGHT);
  return unitSparse(pool);
}

/** Similar-artist match per catalog artist id (max over sources). */
export function similarOf(artist: MapArtistInput): Map<string, number> {
  const out = new Map<string, number>();
  for (const src of artist.similar)
    for (const it of src.items) if (it.artistId && it.artistId !== artist.id && it.match > (out.get(it.artistId) ?? 0)) out.set(it.artistId, it.match);
  return out;
}

export interface QueryNode {
  key: NodeKey;
  w: number;
  label: string;
  artistId: string;
  tags: Sparse;
  similar: Map<string, number>;
}

export interface NearbyQueryVectors {
  nodes: QueryNode[];
  /** Kernel-weighted mix of the nodes' unit tag vectors, L2-normalized. */
  tags: Sparse;
  /** Catalog artist id → Σ w·match. */
  graph: Map<string, number>;
}

/** Nodes whose artist isn't in `artists` (not on the user's map) are dropped; weights are renormalized. */
export function buildQuery(nodes: NearbyNode[], artists: MapArtistInput[]): NearbyQueryVectors {
  const byId = new Map(artists.map((a) => [a.id, a]));
  const live = nodes.filter((n) => {
    const a = byId.get(artistIdOfKey(n.key));
    return !!a && a.albums.some((al) => al.rated);
  });
  const total = live.reduce((s, n) => s + n.w, 0) || 1;
  const eraStarts = new Map<string, string[]>();
  for (const n of live)
    if (n.key.startsWith('e:')) {
      const id = artistIdOfKey(n.key);
      eraStarts.set(id, [...(eraStarts.get(id) ?? []), n.key.split(':')[2]]);
    }
  const q: QueryNode[] = live.map((n) => {
    const artist = byId.get(artistIdOfKey(n.key))!;
    return {
      key: n.key,
      w: n.w / total,
      label: artist.name,
      artistId: artist.id,
      tags: nodeTagVector(artist, nodeAlbums(artist, n.key, eraStarts.get(artist.id))),
      similar: similarOf(artist),
    };
  });
  const tags: Sparse = new Map();
  const graph = new Map<string, number>();
  for (const n of q) {
    addInto(tags, n.tags, n.w);
    for (const [id, m] of n.similar) graph.set(id, (graph.get(id) ?? 0) + n.w * m);
  }
  return { nodes: q, tags: unitSparse(tags), graph };
}

// ── candidates ───────────────────────────────────────────────────────────────

export interface CandidateRow {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
  genres: string[] | null;
  title_language: string | null;
  prestige_score: number | null;
  primary_artist_id: string | null;
  is_official?: boolean | null;
  artists?: { name: string | null; name_native: string | null; country: string | null; genre_evidence: unknown } | null;
}

/** A candidate album's tag vector: its own tags + the artist prior, like a one-album node. */
export function candidateTagVector(row: CandidateRow): Sparse {
  const album: MapAlbumInput = {
    id: row.id,
    title: row.title,
    artistId: row.primary_artist_id ?? '',
    year: yearOf(row.first_release_date),
    genres: row.genres ?? [],
    titleLanguage: row.title_language,
    type: row.release_group_type,
    coverUrl: row.cover_url,
    embedding: null,
    score: null,
    rated: false,
  };
  const artist: MapArtistInput = {
    id: album.artistId,
    name: row.artists?.name ?? row.artist_display,
    nameNative: row.artists?.name_native ?? null,
    country: row.artists?.country ?? null,
    genreEvidence: row.artists?.genre_evidence ?? null,
    similar: [],
    albums: [album],
  };
  const lang = albumLang(album, artist);
  const v = albumTagVector(album, lang);
  addInto(v, evidenceVector(artist.genreEvidence, lang).vec, ARTIST_EVIDENCE_WEIGHT);
  return unitSparse(v);
}

function tagLabel(qid: string): string {
  return qualifiedInfo(qid)?.display.en ?? qid;
}

const LEVEL_RANK = { family: 0, genre: 1, subgenre: 2 } as const;
function specificity(qid: string): number {
  const level = qualifiedInfo(qid)?.level;
  return level ? LEVEL_RANK[level] : 0;
}

export interface RankArgs {
  query: NearbyQueryVectors;
  candidates: CandidateRow[];
  /** Album ids the user rated (never suggested). */
  ratedIds: Set<string>;
  /** Artist ids with ≥ 1 rated album (on the map): down-weighted. */
  onMapArtists: Set<string>;
  limit?: number;
}

export interface RankedCandidate extends NearbyAlbum {
  score: number;
}

/** Pure ranking (see the file comment). Deterministic: ties break by prestige, then id. */
export function rankNearby({ query, candidates, ratedIds, onMapArtists, limit = NEARBY_LIMIT }: RankArgs): RankedCandidate[] {
  const seen = new Set<string>();
  const usable = candidates.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    if (ratedIds.has(r.id) || !r.primary_artist_id) return false;
    if (r.is_official === false) return false;
    if (r.release_group_type !== 'album' && r.release_group_type !== 'ep') return false;
    return true;
  });
  if (!usable.length || !query.nodes.length) return [];

  const maxGraph = Math.max(GRAPH_FLOOR, ...usable.map((r) => query.graph.get(r.primary_artist_id!) ?? 0));
  // Prestige as a rank in the pool (scores aren't on a fixed scale).
  const byPrestige = [...usable].sort((a, b) => (b.prestige_score ?? -1) - (a.prestige_score ?? -1));
  const prestigeRank = new Map(byPrestige.map((r, i) => [r.id, usable.length > 1 ? 1 - i / (usable.length - 1) : 1]));

  const scored = usable.map((r) => {
    const artistId = r.primary_artist_id!;
    const vec = candidateTagVector(r);
    const tagSim = vec.size ? Math.max(0, dotSparse(vec, query.tags)) : TAG_NEUTRAL;
    const graphSim = Math.min(1, (query.graph.get(artistId) ?? 0) / maxGraph);
    let score = W_TAG * tagSim + W_GRAPH * graphSim + W_PRESTIGE * (r.prestige_score != null ? prestigeRank.get(r.id)! : 0);
    if (onMapArtists.has(artistId)) score *= ON_MAP_FACTOR;
    return { r, vec, score };
  });
  scored.sort(
    (a, b) => b.score - a.score || (b.r.prestige_score ?? -1) - (a.r.prestige_score ?? -1) || (a.r.id < b.r.id ? -1 : 1),
  );

  const out: RankedCandidate[] = [];
  const artistsUsed = new Set<string>();
  for (const { r, vec, score } of scored) {
    if (out.length >= limit) break;
    if (!(score > 0)) break;
    const artistId = r.primary_artist_id!;
    if (artistsUsed.has(artistId)) continue;
    artistsUsed.add(artistId);

    // Which nodes pull hardest toward it: each node's own tag + graph term.
    const pulls = query.nodes
      .filter((n) => n.artistId !== artistId)
      .map((n) => ({
        label: n.label,
        v: n.w * (W_TAG * Math.max(0, dotSparse(vec, n.tags)) + W_GRAPH * Math.min(1, (n.similar.get(artistId) ?? 0) / maxGraph)),
      }))
      .filter((p) => p.v > 1e-6)
      .sort((a, b) => b.v - a.v);
    const near: string[] = [];
    for (const p of pulls) if (!near.includes(p.label) && near.length < NAMED_NODES) near.push(p.label);
    // Shared tags: among the strong ones (≥ 20% of the strongest), the most
    // specific first, so "Alternative Rock" is named rather than its ancestor "Rock".
    const sharedAll = [...vec].map(([q, x]) => ({ q, v: x * (query.tags.get(q) ?? 0) })).filter((s) => s.v > 0);
    const strongest = Math.max(0, ...sharedAll.map((s) => s.v));
    const shared = sharedAll
      .filter((s) => s.v >= 0.2 * strongest)
      .sort((a, b) => specificity(b.q) - specificity(a.q) || b.v - a.v || (a.q < b.q ? -1 : 1));
    const tags: string[] = [];
    for (const s of shared) {
      const l = tagLabel(s.q);
      if (!tags.includes(l) && tags.length < NAMED_TAGS) tags.push(l);
    }
    const parts = [near.length ? `near ${near.join(' · ')}` : '', tags.join(', ')].filter(Boolean);
    out.push({
      id: r.id,
      title: r.title,
      artist: r.artist_display,
      year: yearOf(r.first_release_date),
      coverUrl: r.cover_url,
      why: parts.join(' · '),
      near,
      tags,
      score: Math.round(score * 1000) / 1000,
    });
  }
  return out;
}

/**
 * The tag pools to read: the query's leading tags (≥ 25% of the top one, at most
 * POOL_TAGS), grouped by language (at most POOL_LANGS groups, heaviest first),
 * each as DB spellings plus the countries to restrict to.
 */
export function tagPools(tags: Sparse): { lang: string | null; spellings: string[]; countries: string[] }[] {
  const top = [...tags].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!top.length) return [];
  const lead = top.filter(([, x]) => x >= 0.25 * top[0][1]).slice(0, POOL_TAGS);
  const groups = new Map<string, { lang: string | null; weight: number; spellings: Set<string> }>();
  for (const [qid, x] of lead) {
    const info = qualifiedInfo(qid);
    const lang = info?.lang ?? null;
    const g = groups.get(lang ?? '') ?? { lang, weight: 0, spellings: new Set<string>() };
    g.weight += x;
    for (const id of new Set([info?.base, info && !qid.includes('@') ? qid : null]))
      if (id && !id.includes('@')) for (const sp of synonymsOf(id)) g.spellings.add(sp);
    groups.set(lang ?? '', g);
  }
  return [...groups.values()]
    .filter((g) => g.spellings.size > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, POOL_LANGS)
    .map((g) => ({ lang: g.lang, spellings: [...g.spellings].sort(), countries: countriesOfLanguage(g.lang) }));
}

// ── DB (the only impure part) ────────────────────────────────────────────────

const CAND_COLS =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, genres, title_language, prestige_score, primary_artist_id, is_official';
const ARTIST_JOIN = 'artists!release_groups_primary_artist_id_fkey';
const ARTIST_COLS = 'name, name_native, country, genre_evidence';
const PAGE = 1000;

/** Every album id the user rated and their primary artists (paged past PostgREST's 1000-row clamp). */
export async function loadRatedSets(db: SupabaseClient, userId: string): Promise<{ ratedIds: Set<string>; onMapArtists: Set<string> }> {
  const ratedIds = new Set<string>();
  const onMapArtists = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('ratings')
      .select('id, release_group_id, release_groups(primary_artist_id)')
      .eq('user_id', userId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[tasteMap/nearby] ratings: ${error.message}`);
    const rows = (data ?? []) as unknown as { release_group_id: string; release_groups: { primary_artist_id: string | null } | null }[];
    for (const r of rows) {
      ratedIds.add(r.release_group_id);
      if (r.release_groups?.primary_artist_id) onMapArtists.add(r.release_groups.primary_artist_id);
    }
    if (rows.length < PAGE) break;
  }
  return { ratedIds, onMapArtists };
}

async function graphPool(db: SupabaseClient, graph: Map<string, number>): Promise<CandidateRow[]> {
  const ids = [...graph]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, GRAPH_ARTISTS)
    .map(([id]) => id);
  if (!ids.length) return [];
  const { data, error } = await db
    .from('release_groups')
    .select(`${CAND_COLS}, ${ARTIST_JOIN}(${ARTIST_COLS})`)
    .in('primary_artist_id', ids)
    .in('release_group_type', ['album', 'ep'])
    .not('cover_url', 'is', null)
    .or(releasedFilter())
    .order('prestige_score', { ascending: false, nullsFirst: false })
    .limit(GRAPH_POOL);
  if (error) {
    console.error('[tasteMap/nearby] graph pool:', error.message);
    return [];
  }
  return (data ?? []) as unknown as CandidateRow[];
}

async function tagPool(db: SupabaseClient, pool: ReturnType<typeof tagPools>[number]): Promise<CandidateRow[]> {
  const inner = pool.countries.length > 0 ? '!inner' : '';
  let q = db
    .from('release_groups')
    .select(`${CAND_COLS}, ${ARTIST_JOIN}${inner}(${ARTIST_COLS})`)
    .overlaps('genres', pool.spellings)
    .in('release_group_type', ['album', 'ep'])
    .not('cover_url', 'is', null)
    .or(releasedFilter());
  if (pool.countries.length > 0) q = q.in('artists.country', pool.countries);
  const { data, error } = await q.order('prestige_score', { ascending: false, nullsFirst: false }).limit(TAG_POOL);
  if (error) {
    console.error('[tasteMap/nearby] tag pool:', error.message);
    return [];
  }
  return (data ?? []) as unknown as CandidateRow[];
}

/**
 * Suggestions for the nodes around a point. `nodes` from parseNearbyQuery.
 * Read-only. Nodes whose artist the user hasn't rated are ignored; none left →
 * no albums.
 */
export async function suggestNearby(
  db: SupabaseClient,
  userId: string,
  nodes: NearbyNode[],
  { limit = NEARBY_LIMIT }: { limit?: number } = {},
): Promise<NearbyResponse> {
  const artistIds = [...new Set(nodes.map((n) => artistIdOfKey(n.key)))];
  const [artists, rated] = await Promise.all([
    loadArtistInputs(db, artistIds, { userId, embeddings: false }),
    loadRatedSets(db, userId),
  ]);
  const query = buildQuery(nodes, artists);
  if (!query.nodes.length) return { albums: [] };
  const pools = await Promise.all([graphPool(db, query.graph), ...tagPools(query.tags).map((p) => tagPool(db, p))]);
  const ranked = rankNearby({ query, candidates: pools.flat(), ratedIds: rated.ratedIds, onMapArtists: rated.onMapArtists, limit });
  return { albums: ranked.map(({ score: _score, ...a }) => a) };
}
