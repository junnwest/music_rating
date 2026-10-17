/**
 * The TASTE MAP, rebuilt on the taxonomy × language (2026-09-28).
 *
 * A "world" is a language-qualified sound family — Rock, J-Rock, Korean
 * Hip-Hop, Korean Rock, K-Pop, Jazz, French Pop — and its tiles are the
 * language-qualified genres the user rated inside it. Only the world (the
 * broadest genre) carries the language in its label; tiles inside it show the
 * plain genre name (J-Rock → Alternative Rock, Indie Rock …), while their ids
 * stay qualified so each tile focuses and recommends in its own language. Both
 * levels come straight from the taxonomy (lib/genres/taxonomy.ts) plus the
 * language axis (lib/genres/language.ts), replacing the old greedy embedding
 * clustering, whose worlds depended on visit order, had to be patched with
 * scene locks so J-Pop wouldn't merge into K-Pop, and put a Korean rock album
 * tagged only "rock" in the same world as a British one.
 *
 * Every rated album lives in exactly ONE world — its primary genre's family, in
 * the album's language — and contributes its in-world genres as tiles (primary
 * 1.0, co-tags 0.5, the same weighting as the ratings trigger). Worlds too small
 * to stand alone fold into a single "Other" world whose tiles are the folded
 * worlds, so no rating disappears from the map.
 *
 * Embeddings are used only where geometry is genuinely needed (a world's
 * centroid for ranking recommendations, and the similarity matrices the client
 * receives). A qualified genre with no vector of its own borrows its base
 * genre's vector pulled toward its language's anchor genre.
 *
 * Server-only (pulls in the embeddings artifact).
 */
import { cosine, genreVector } from './embeddings';
import { eraAffinity, sceneOf, type Scene } from './albumVector';
import {
  parseQualified,
  qualifiedInfo,
  qualify,
  qualifyAlbum,
  type LanguageSource,
} from '../genres/language';
import { chooseWorld, evidenceOf, familiesOf, type PlacementInput } from '../genres/placement';
import { primaryOf, resolveGenre } from '../genres/resolver';
import { NODE_BY_ID } from '../genres/taxonomy';

/**
 * Most named worlds on the map (plus at most one "Other"). Was 7, which folded
 * K-Pop / J-Pop / Korean R&B into "Other" for users with ten small worlds
 * (2026-10-17 audit, scripts/dump-taste-map.ts); nine still reads on the web
 * treemap and the iOS list.
 */
export const MAX_WORLDS = 9;
/** A world needs this share of the user's rated mass… */
export const MIN_WORLD_SHARE = 0.04;
/** …or this many albums to stand on its own. */
export const MIN_WORLD_ALBUMS = 2;
export const OTHER_WORLD = 'other';
/** Tiles per world the clients show (the route's sub-genre bubbles). */
export const WORLD_TILE_LIMIT = 8;
/**
 * Tiles an album's thumbnail shows under: its primary + one co-tag. An album
 * still adds mass to every in-world genre it carries; this only stops one cover
 * repeating across most of a world's tiles (OK Computer was under 9).
 */
export const MAX_ALBUM_TILES = 2;

/** Language → the genre whose vector stands for that language's scene. */
const LANG_ANCHOR: Record<string, string> = {
  ko: 'k-pop',
  ja: 'j-pop',
  zh: 'mandopop',
  es: 'latin',
  pt: 'mpb',
  fr: 'chanson',
  de: 'schlager',
  hi: 'filmi',
};
/** How hard a synthetic qualified vector leans toward its language anchor. */
const ANCHOR_BLEND = 0.8;

const VEC_CACHE = new Map<string, number[] | null>();

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Embedding for a plain or qualified genre id: its own vector when the artifact
 * has one (j-rock, k-pop), else base ⊕ language anchor (rock@ko, and k-rap,
 * which has no catalog support of its own yet).
 */
export function qualifiedVector(qid: string): number[] | null {
  if (VEC_CACHE.has(qid)) return VEC_CACHE.get(qid)!;
  let out: number[] | null = null;
  const parsed = parseQualified(qid);
  if (!parsed) out = genreVector(qid);
  if (!out) {
    const info = qualifiedInfo(qid);
    const base = parsed?.base ?? NODE_BY_ID.get(qid)?.localizes?.[0] ?? null;
    const lang = parsed?.lang ?? info?.lang ?? null;
    const bv = base ? genreVector(base) : null;
    const anchor = lang && LANG_ANCHOR[lang] ? genreVector(LANG_ANCHOR[lang]) : null;
    if (bv) out = anchor ? normalize(bv.map((x, i) => x + ANCHOR_BLEND * anchor[i])) : bv;
  }
  VEC_CACHE.set(qid, out);
  return out;
}

function weightedCentroid(items: { id: string; weight: number }[]): number[] | null {
  let acc: number[] | null = null;
  for (const { id, weight } of items) {
    if (weight <= 0) continue;
    const v = qualifiedVector(id);
    if (!v) continue;
    acc ??= new Array<number>(v.length).fill(0);
    for (let i = 0; i < v.length; i++) acc[i] += v[i] * weight;
  }
  return acc ? normalize(acc) : null;
}

// ── per album ─────────────────────────────────────────────────────────────────

/**
 * Only the album's first few in-world sound tags compete for its primary.
 * genres[] is stored in vote / merge-rank order, so the long tail is the weakest
 * evidence — without this, a tag in eighth place picked the primary because it
 * was the most specific (A Rush of Blood to the Head → Post-Rock, Parachutes →
 * Dream Pop).
 */
export const PRIMARY_TOP_TAGS = 3;
/**
 * A runner-up family needs this share of the winner's evidence to be an alternate
 * home. At 0.5 Lauryn Hill (R&B, hip-hop 0.69) and Tiffany Day's electropop (Pop,
 * electronic 0.73) can move; The Life of Pablo (Hip-Hop, R&B 0.26) cannot.
 */
export const ALTERNATE_MIN_RATIO = 0.5;

interface WorldTiles {
  /** Qualified primary genre inside the world. */
  primary: string;
  /** The world (qualified family). */
  world: string;
  /** In-world tiles with their within-album weight (primary 1.0, co-tag 0.5). */
  tiles: { id: string; weight: number }[];
}

/** A runner-up world, with its evidence relative to the winner's (0–1]. */
export interface AlternateWorld extends WorldTiles {
  support: number;
}

export interface AlbumPlacement {
  lang: string | null;
  langSource: LanguageSource | null;
  /** Qualified primary genre, or null when no tag resolves. */
  primary: string | null;
  /** The world (qualified family) the album lives in. */
  world: string | null;
  /** In-world tiles with their within-album weight (primary 1.0, co-tag 0.5). */
  tiles: { id: string; weight: number }[];
  /** Every qualified genre on the album, in or out of its world. */
  all: string[];
  /**
   * Runner-up worlds (same language), best first — where the album goes when its
   * own world is too small to show on the user's map. Optional so hand-built
   * placements (tests) stay valid.
   */
  alternates?: AlternateWorld[];
}

/** The album's tiles inside one family's world (see placeAlbum). */
function tilesIn(genres: readonly string[] | null | undefined, family: string, lang: string | null): WorldTiles {
  const world = qualify(family, lang);
  const inWorld = (genres ?? []).filter((g) => {
    const id = resolveGenre(g);
    return id != null && !NODE_BY_ID.get(id)?.isScene && familiesOf(id).includes(family);
  });
  // Descriptors (ballad, instrumental…) are tiles but never the primary unless alone.
  const sound = inWorld.filter((g) => evidenceOf(resolveGenre(g)!) > 0);
  const primaryBase = primaryOf((sound.length > 0 ? sound : inWorld).slice(0, PRIMARY_TOP_TAGS));
  const primary = primaryBase ? qualify(primaryBase, lang) : world;

  const tileIds: string[] = [];
  for (const g of inWorld) {
    const q = qualify(resolveGenre(g)!, lang);
    if (!tileIds.includes(q)) tileIds.push(q);
  }
  if (tileIds.length === 0) tileIds.push(world);
  return { primary, world, tiles: tileIds.map((id) => ({ id, weight: id === primary ? 1 : 0.5 })) };
}

/**
 * Where one album sits on the map. The WORLD is the family with the most evidence
 * — the album's tags plus its artist prior (lib/genres/placement.ts) — in the
 * album's language. The tiles are the album's own genres inside that world (a
 * hybrid counts in each of its parents' worlds: pop rap is a Hip-Hop tile), and
 * the primary is the most specific of its first few (shoegaze over rock). An album
 * whose own tags say nothing about its world (untagged, or only "k-pop" on a rap
 * record placed by its artist) gets the world itself as its one tile.
 */
export function placeAlbum(input: PlacementInput): AlbumPlacement {
  const { family, lang, source, ranked } = chooseWorld(input);
  const all = qualifyAlbum(input.genres, lang);
  if (!family) return { lang, langSource: source, primary: null, world: null, tiles: [], all };
  const { world, primary, tiles } = tilesIn(input.genres, family, lang);
  const best = ranked[0]?.mass ?? 0;
  const alternates = ranked
    .slice(1)
    .filter((r) => r.mass >= ALTERNATE_MIN_RATIO * best)
    .map((r) => ({ ...tilesIn(input.genres, r.family, lang), support: Math.round((r.mass / best) * 100) / 100 }))
    .filter((a) => a.world !== world);
  return { lang, langSource: source, primary, world, tiles, all: all.length > 0 ? all : [world], alternates };
}

// ── per user ──────────────────────────────────────────────────────────────────

export interface RatedAlbum {
  id: string;
  score: number;
  year: number | null;
  country: string | null;
  placement: AlbumPlacement;
  /** < 1 when the genres were borrowed from the artist's other albums. */
  confidence?: number;
}

export interface WorldTile {
  id: string;
  /**
   * The tile's key on the map — `id`, unless the same genre is a tile in two
   * worlds (a hybrid: pop rock in Rock and in Pop), when it is `id#world` so each
   * world's tile only holds its own albums. Clients look albums up by this.
   */
  key: string;
  /** Plain genre name — the world already names the language. */
  display: { en: string; ko: string };
  /** Language-prefixed name, for contexts outside the world (dislikes). */
  fullDisplay: { en: string; ko: string };
  /** Σ within-album weight × confidence. */
  mass: number;
  /** Σ (score − 3) × weight × confidence. */
  w: number;
  avg: number;
  /** Share of the world's tile mass. */
  share: number;
  /**
   * Albums whose thumbnail shows under this tile (see TasteMap.albumTiles) — 0
   * for a tile outside the world's top WORLD_TILE_LIMIT, or one whose albums all
   * show elsewhere. Clients get only tiles with albums > 0.
   */
  albums: number;
}

export interface TasteWorld {
  key: string;
  label: { en: string; ko: string };
  /** Language of the world, null for an unmarked (English/unknown) world. */
  language: string | null;
  /** Σ album confidence — effectively the number of rated albums here. */
  mass: number;
  share: number;
  avg: number;
  tiles: WorldTile[];
  albumIds: string[];
  centroid: number[] | null;
  meanYear: number | null;
  sdYears: number | null;
  dominantScene: Scene | null;
}

export interface TasteMap {
  worlds: TasteWorld[];
  /**
   * album id → the tile KEYS its thumbnail shows under: its primary and at most
   * MAX_ALBUM_TILES − 1 co-tags among the world's top WORLD_TILE_LIMIT tiles
   * (a tile nobody else covers can add one more, so ≤ MAX_ALBUM_TILES + 1).
   * Folded worlds map to their key.
   */
  albumTiles: Map<string, string[]>;
}

interface Acc {
  key: string;
  mass: number;
  scoreSum: number;
  tiles: Map<string, { mass: number; w: number }>;
  albumIds: string[];
  years: number[];
  scenes: Scene[];
}

function round(x: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

function finish(a: Acc, total: number, tileOverride?: WorldTile[]): TasteWorld {
  const info = a.key === OTHER_WORLD ? null : qualifiedInfo(a.key);
  const tileMass = [...a.tiles.values()].reduce((s, t) => s + t.mass, 0) || 1;
  const tiles: WorldTile[] =
    tileOverride ??
    [...a.tiles.entries()]
      .map(([id, t]) => ({
        id,
        key: id,
        display: qualifiedInfo(id)?.shortDisplay ?? { en: id, ko: id },
        fullDisplay: qualifiedInfo(id)?.display ?? { en: id, ko: id },
        mass: round(t.mass, 1),
        w: round(t.w, 3),
        avg: round(3 + t.w / (t.mass || 1)),
        share: round(t.mass / tileMass, 3),
        albums: 0,
      }))
      .sort((x, y) => y.mass - x.mass || y.avg - x.avg || x.id.localeCompare(y.id));
  const meanYear = a.years.length > 0 ? a.years.reduce((s, y) => s + y, 0) / a.years.length : null;
  const sdYears =
    meanYear != null && a.years.length > 1
      ? Math.sqrt(a.years.reduce((s, y) => s + (y - meanYear) ** 2, 0) / a.years.length)
      : null;
  const language = info?.lang ?? null;
  let dominantScene: Scene | null = null;
  if (language === 'ko') dominantScene = 'kr';
  else if (language === 'ja') dominantScene = 'jp';
  else if (language) dominantScene = 'other';
  else if (a.scenes.length > 0) {
    const counts = new Map<Scene, number>();
    for (const s of a.scenes) counts.set(s, (counts.get(s) ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    if (n / a.scenes.length >= 0.5) dominantScene = top;
  }
  return {
    key: a.key,
    label:
      a.key === OTHER_WORLD
        ? { en: 'Other', ko: '기타' }
        : (info?.display ?? { en: a.key, ko: a.key }),
    language,
    mass: round(a.mass, 1),
    share: round(a.mass / (total || 1)),
    avg: round(a.scoreSum / (a.mass || 1)),
    tiles,
    albumIds: a.albumIds,
    centroid: weightedCentroid(tiles.map((t) => ({ id: t.id, weight: t.mass }))),
    meanYear: meanYear != null ? Math.round(meanYear) : null,
    sdYears: sdYears != null ? round(sdYears, 1) : null,
    dominantScene,
  };
}

const newAcc = (key: string): Acc => ({
  key,
  mass: 0,
  scoreSum: 0,
  tiles: new Map(),
  albumIds: [],
  years: [],
  scenes: [],
});

function addTo(acc: Acc, a: RatedAlbum, tiles: { id: string; weight: number }[]) {
  const c = a.confidence ?? 1;
  acc.mass += c;
  acc.scoreSum += a.score * c;
  acc.albumIds.push(a.id);
  if (a.year != null) acc.years.push(a.year);
  const sc = sceneOf(a.country);
  if (sc) acc.scenes.push(sc);
  for (const t of tiles) {
    const e = acc.tiles.get(t.id) ?? { mass: 0, w: 0 };
    e.mass += t.weight * c;
    e.w += (a.score - 3) * t.weight * c;
    acc.tiles.set(t.id, e);
  }
}

const byMass = (x: Acc, y: Acc) =>
  y.mass - x.mass || y.scoreSum - x.scoreSum || x.key.localeCompare(y.key);

interface Home {
  world: string;
  primary: string;
  tiles: { id: string; weight: number }[];
}

/**
 * Which of a world's tiles each album's thumbnail shows under (tile ids). Albums
 * go best-first; each takes its primary (if visible) and then the visible co-tag
 * with the fewest thumbnails so far, so covers spread across tiles instead of the
 * same top album heading every one. A visible tile left empty takes the album
 * carrying it that shows under the fewest tiles — one extra tile per album at
 * most, so a lone album can't fill a whole world. An album with no visible tile
 * falls back to the world's own tile when that is visible.
 */
function chooseAlbumTiles(world: TasteWorld, members: { a: RatedAlbum; home: Home }[]): Map<string, string[]> {
  const visible = world.tiles.slice(0, WORLD_TILE_LIMIT).map((t) => t.id);
  const rank = new Map(visible.map((id, i) => [id, i]));
  const count = new Map<string, number>();
  const out = new Map<string, string[]>();
  const order = [...members].sort((x, y) => y.a.score - x.a.score || x.a.id.localeCompare(y.a.id));
  for (const { a, home } of order) {
    const cands = home.tiles.map((t) => t.id).filter((id) => rank.has(id));
    if (cands.length === 0) {
      if (!rank.has(world.key)) continue;
      cands.push(world.key);
    }
    const chosen = [cands.includes(home.primary) ? home.primary : cands[0]];
    const rest = cands.filter((id) => id !== chosen[0]);
    while (chosen.length < MAX_ALBUM_TILES && rest.length > 0) {
      rest.sort((x, y) => (count.get(x) ?? 0) - (count.get(y) ?? 0) || rank.get(x)! - rank.get(y)!);
      chosen.push(rest.shift()!);
    }
    for (const id of chosen) count.set(id, (count.get(id) ?? 0) + 1);
    out.set(a.id, chosen);
  }
  for (const id of visible) {
    if ((count.get(id) ?? 0) > 0) continue;
    let pick: string | null = null;
    for (const { a, home } of order) {
      const n = out.get(a.id)?.length ?? 0;
      if (n > MAX_ALBUM_TILES || !home.tiles.some((t) => t.id === id)) continue;
      if (pick == null || n < (out.get(pick)?.length ?? 0)) pick = a.id;
    }
    if (pick) {
      out.set(pick, [...(out.get(pick) ?? []), id]);
      count.set(id, 1);
    }
  }
  return out;
}

/**
 * The user's taste map from their rated albums. Deterministic.
 *
 * Every album starts in its own world. A world stands on its own when it ranks in
 * the top MAX_WORLDS and holds MIN_WORLD_SHARE of the mass or MIN_WORLD_ALBUMS
 * albums. An album of a smaller world moves to its runner-up world (same
 * language, ≥ ALTERNATE_MIN_RATIO of the evidence — placement alternates) when
 * that one stands; the small worlds still left then fill any free slots, and only
 * what is left after that folds into "Other" — which never holds a single world
 * (it shows as that world instead).
 */
export function buildTasteMap(albums: RatedAlbum[]): TasteMap {
  const placed = albums.filter((a) => a.placement.world && a.placement.tiles.length > 0);
  const byId = new Map(placed.map((a) => [a.id, a]));

  // 1. Every world by the albums' own placement; which ones stand on their own.
  const raw = new Map<string, Acc>();
  for (const a of placed) {
    const k = a.placement.world!;
    if (!raw.has(k)) raw.set(k, newAcc(k));
    addTo(raw.get(k)!, a, a.placement.tiles);
  }
  const total = [...raw.values()].reduce((s, a) => s + a.mass, 0);
  const keep = new Set<string>();
  for (const w of [...raw.values()].sort(byMass)) {
    if (keep.size >= MAX_WORLDS) break;
    const big = w.mass / (total || 1) >= MIN_WORLD_SHARE || w.albumIds.length >= MIN_WORLD_ALBUMS;
    if (keep.size === 0 || big) keep.add(w.key);
  }

  // 2. Rehome the albums of worlds that didn't make it.
  const homes = new Map<string, Home>();
  for (const a of placed) {
    const p = a.placement;
    const alt = keep.has(p.world!) ? null : p.alternates?.find((x) => keep.has(x.world));
    homes.set(a.id, alt ?? { world: p.world!, primary: p.primary ?? p.world!, tiles: p.tiles });
  }
  // Small worlds left over fill any free slots, biggest first; "Other" only takes
  // what is still left — and never a single world (it would just be renamed).
  const left = new Map<string, number>();
  for (const a of placed) {
    const w = homes.get(a.id)!.world;
    if (!keep.has(w)) left.set(w, (left.get(w) ?? 0) + (a.confidence ?? 1));
  }
  const leftover = [...left.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  while (leftover.length > 0 && keep.size < MAX_WORLDS) keep.add(leftover.shift()![0]);
  if (leftover.length === 1) keep.add(leftover[0][0]);

  // 3. The final worlds.
  const accs = new Map<string, Acc>();
  const folded = new Map<string, Acc>();
  for (const a of placed) {
    const h = homes.get(a.id)!;
    const into = keep.has(h.world) ? accs : folded;
    if (!into.has(h.world)) into.set(h.world, newAcc(h.world));
    addTo(into.get(h.world)!, a, h.tiles);
  }
  const worlds = [...accs.values()].sort(byMass).map((a) => finish(a, total));

  const albumTiles = new Map<string, string[]>();
  for (const w of worlds) {
    const members = w.albumIds.map((id) => ({ a: byId.get(id)!, home: homes.get(id)! }));
    const chosen = chooseAlbumTiles(w, members);
    const n = new Map<string, number>();
    for (const [id, tiles] of chosen) {
      albumTiles.set(id, tiles);
      for (const t of tiles) n.set(t, (n.get(t) ?? 0) + 1);
    }
    for (const t of w.tiles) t.albums = n.get(t.id) ?? 0;
  }

  if (folded.size > 0) {
    // "Other": one tile per folded world, so the treemap still shows where the
    // long tail of ratings went and each tile still focuses its own albums.
    const fs = [...folded.values()].sort(byMass);
    const other = newAcc(OTHER_WORLD);
    for (const f of fs) {
      other.mass += f.mass;
      other.scoreSum += f.scoreSum;
      other.albumIds.push(...f.albumIds);
      other.years.push(...f.years);
      other.scenes.push(...f.scenes);
      const w = [...f.tiles.values()].reduce((s, t) => s + t.w, 0);
      other.tiles.set(f.key, { mass: f.mass, w });
    }
    const tiles: WorldTile[] = fs.map((f) => {
      const fw = finish(f, total);
      return {
        id: f.key,
        key: f.key,
        display: fw.label,
        fullDisplay: fw.label,
        mass: fw.mass,
        w: round([...f.tiles.values()].reduce((s, t) => s + t.w, 0), 3),
        avg: fw.avg,
        share: round(f.mass / (other.mass || 1), 3),
        albums: f.albumIds.length,
      };
    });
    worlds.push(finish(other, total, tiles));
    for (const f of fs) for (const id of f.albumIds) albumTiles.set(id, [f.key]);
  }

  // 4. A genre that is a tile in two worlds (a hybrid) gets a per-world key, so a
  // client looking albums up by tile never pulls another world's albums in.
  const uses = new Map<string, number>();
  for (const w of worlds) for (const t of w.tiles) uses.set(t.id, (uses.get(t.id) ?? 0) + 1);
  for (const w of worlds) {
    const keyOf = new Map<string, string>();
    for (const t of w.tiles) {
      if ((uses.get(t.id) ?? 0) > 1) t.key = `${t.id}#${w.key}`;
      keyOf.set(t.id, t.key);
    }
    for (const id of w.albumIds) {
      const tiles = albumTiles.get(id);
      if (tiles) albumTiles.set(id, tiles.map((t) => keyOf.get(t) ?? t));
    }
  }
  return { worlds, albumTiles };
}

/**
 * How well a candidate album fits one world: it must share the world's language
 * (an unmarked world takes English/unknown-language albums only) and land in the
 * world or on one of its tiles; then genre cosine to the world centroid, tile
 * overlap weighted by the user's mass there, and era closeness.
 */
export function worldAffinity(
  cand: AlbumPlacement,
  year: number | null,
  world: TasteWorld,
): number {
  if (world.key === OTHER_WORLD || !world.centroid) return 0;
  const candLang = cand.lang === 'en' ? null : cand.lang;
  if (candLang !== world.language) return 0;
  const tileShare = new Map(world.tiles.map((t) => [t.id, t.share]));
  const overlap = cand.all.reduce((s, q) => s + (tileShare.get(q) ?? 0), 0);
  if (cand.world !== world.key && overlap === 0) return 0;
  const vec = weightedCentroid(cand.all.map((id) => ({ id, weight: id === cand.primary ? 1 : 0.5 })));
  const cos = vec ? Math.max(0, cosine(vec, world.centroid)) : 0;
  const era = eraAffinity(year, { meanYear: world.meanYear, sdYears: world.sdYears });
  return 0.55 * cos + 0.25 * Math.min(1, overlap) + 0.2 * era;
}

// ── you vs the community ──────────────────────────────────────────────────────

export interface CommunityAlbum {
  placement: AlbumPlacement;
  scoreSum: number;
  scoreCount: number;
}

/** Community score totals per world: every community-rated album placed on the
 *  same map (genre × language), summed rating-weighted. */
export function communityWorldTotals(albums: CommunityAlbum[]): Map<string, { sum: number; n: number }> {
  const out = new Map<string, { sum: number; n: number }>();
  for (const a of albums) {
    const w = a.placement.world;
    if (!w || a.scoreCount <= 0) continue;
    const e = out.get(w) ?? { sum: 0, n: 0 };
    e.sum += a.scoreSum;
    e.n += a.scoreCount;
    out.set(w, e);
  }
  return out;
}

export interface WorldStanding {
  key: string;
  label: { en: string; ko: string };
  userAvg: number;
  communityAvg: number;
  /** Albums of yours in this world. */
  userCount: number;
  /** Community ratings in this world (yours included). */
  communityCount: number;
}

/** Albums of yours a world needs before it gets a standing. */
export const STANDING_MIN_ALBUMS = 3;

/**
 * Your average vs everyone's, per world ("Korean Rock", "Rock"…) — the largest
 * genre, language-qualified, so Korean rock is compared with Korean rock. A world
 * qualifies with ≥ STANDING_MIN_ALBUMS of your albums AND community ratings
 * beyond your own (otherwise the "community" is just you).
 */
export function worldStandings(
  worlds: TasteWorld[],
  community: Map<string, { sum: number; n: number }>,
  limit = 5,
): WorldStanding[] {
  const out: WorldStanding[] = [];
  for (const w of worlds) {
    if (w.key === OTHER_WORLD) continue;
    const userCount = new Set(w.albumIds).size;
    const c = community.get(w.key);
    if (userCount < STANDING_MIN_ALBUMS || !c || c.n <= userCount) continue;
    out.push({
      key: w.key,
      label: w.label,
      userAvg: w.avg,
      communityAvg: round(c.sum / c.n),
      userCount,
      communityCount: c.n,
    });
  }
  return out.sort((a, b) => b.userCount - a.userCount || a.key.localeCompare(b.key)).slice(0, limit);
}
