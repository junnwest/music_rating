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
  albumLanguage,
  parseQualified,
  primaryOfAlbum,
  qualifiedInfo,
  qualifyAlbum,
  type AlbumLanguageInput,
  type LanguageSource,
} from '../genres/language';
import { NODE_BY_ID } from '../genres/taxonomy';

/** Most worlds shown before the rest fold into "Other". */
export const MAX_WORLDS = 7;
/** A world below this share of the user's rated mass folds into "Other". */
export const MIN_WORLD_SHARE = 0.04;
export const OTHER_WORLD = 'other';

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
}

/** Where one album sits on the map. */
export function placeAlbum(input: AlbumLanguageInput): AlbumPlacement {
  const { lang, source } = albumLanguage(input);
  const all = qualifyAlbum(input.genres, lang);
  const primary = primaryOfAlbum(input.genres, lang);
  const world = primary ? (qualifiedInfo(primary)?.family ?? null) : null;
  const tiles = world
    ? all
        .filter((q) => qualifiedInfo(q)?.family === world)
        .map((id) => ({ id, weight: id === primary ? 1 : 0.5 }))
    : [];
  return { lang, langSource: source, primary, world, tiles, all };
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
  /** album id → the tile ids it shows under (folded worlds map to their key). */
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
        display: qualifiedInfo(id)?.shortDisplay ?? { en: id, ko: id },
        fullDisplay: qualifiedInfo(id)?.display ?? { en: id, ko: id },
        mass: round(t.mass, 1),
        w: round(t.w, 3),
        avg: round(3 + t.w / (t.mass || 1)),
        share: round(t.mass / tileMass, 3),
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

/** The user's taste map from their rated albums. Deterministic. */
export function buildTasteMap(albums: RatedAlbum[]): TasteMap {
  const accs = new Map<string, Acc>();
  for (const a of albums) {
    const { world, tiles } = a.placement;
    if (!world || tiles.length === 0) continue;
    const c = a.confidence ?? 1;
    let acc = accs.get(world);
    if (!acc) {
      acc = { key: world, mass: 0, scoreSum: 0, tiles: new Map(), albumIds: [], years: [], scenes: [] };
      accs.set(world, acc);
    }
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
  const total = [...accs.values()].reduce((s, a) => s + a.mass, 0);
  const ordered = [...accs.values()].sort(
    (x, y) => y.mass - x.mass || y.scoreSum - x.scoreSum || x.key.localeCompare(y.key),
  );

  const kept: Acc[] = [];
  const folded: Acc[] = [];
  for (const a of ordered) {
    const fits = kept.length < MAX_WORLDS && (kept.length === 0 || a.mass / (total || 1) >= MIN_WORLD_SHARE);
    (fits ? kept : folded).push(a);
  }

  const worlds = kept.map((a) => finish(a, total));
  const albumTiles = new Map<string, string[]>();
  for (const a of albums) {
    const { world, tiles } = a.placement;
    if (world && kept.some((k) => k.key === world)) albumTiles.set(a.id, tiles.map((t) => t.id));
  }

  if (folded.length > 0) {
    // "Other": one tile per folded world, so the treemap still shows where the
    // long tail of ratings went and each tile still focuses its own albums.
    const other: Acc = {
      key: OTHER_WORLD,
      mass: 0,
      scoreSum: 0,
      tiles: new Map(),
      albumIds: [],
      years: [],
      scenes: [],
    };
    for (const f of folded) {
      other.mass += f.mass;
      other.scoreSum += f.scoreSum;
      other.albumIds.push(...f.albumIds);
      other.years.push(...f.years);
      other.scenes.push(...f.scenes);
      const w = [...f.tiles.values()].reduce((s, t) => s + t.w, 0);
      other.tiles.set(f.key, { mass: f.mass, w });
    }
    const tiles: WorldTile[] = folded.map((f) => {
      const fw = finish(f, total);
      return {
        id: f.key,
        display: fw.label,
        fullDisplay: fw.label,
        mass: fw.mass,
        w: round([...f.tiles.values()].reduce((s, t) => s + t.w, 0), 3),
        avg: fw.avg,
        share: round(f.mass / (other.mass || 1), 3),
      };
    });
    worlds.push(finish(other, total, tiles));
    for (const f of folded) for (const id of f.albumIds) albumTiles.set(id, [f.key]);
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
