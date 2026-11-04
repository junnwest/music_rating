/**
 * Shared contract for the 3D/2D taste map (TASTE_MAP_PLAN.md).
 *
 * Pipeline: load.ts (DB → MapUserInput) → eras.ts (artist → era segments) →
 * features.ts (segments → FeatureSpace) → layout.ts (FeatureSpace → LayoutResult)
 * → the route assembles a TasteMapPayload for web and iOS. Every stage is a pure
 * function of the previous one except load.ts, so each is testable on fixtures.
 */

// ── Raw inputs (load.ts) ─────────────────────────────────────────────────────

export interface MapAlbumInput {
  id: string; // release_groups.id
  title: string;
  artistId: string;
  year: number | null;
  /** Display genre tags (release_groups.genres, raw spellings). */
  genres: string[];
  titleLanguage: string | null;
  /**
   * release_groups.release_group_type ('album', 'ep', 'compilation', 'live',
   * 'soundtrack' …). Optional so older fixtures still parse. Compilations swamp
   * some discographies (Pink Floyd: 120 of 155), so eras/features down-weight
   * anything that isn't an album or EP unless the user rated it.
   */
  type?: string | null;
  coverUrl: string | null;
  /** jina-embeddings-v3, 1024-d. Null when the album isn't embedded. */
  embedding: number[] | null;
  /** The user's display score (1–5 scale used by the taste system), null if unrated. */
  score: number | null;
  rated: boolean;
}

export interface SimilarArtist {
  name: string;
  mbid: string | null;
  /** Our artists.id (a uuid) when the similar artist is in the catalog, mapped from the MBID via artist_external_ids. */
  artistId: string | null;
  /** 0–1. */
  match: number;
}

export interface MapArtistInput {
  id: string; // artists.id
  name: string;
  nameNative: string | null;
  country: string | null;
  /** artists.genre_evidence jsonb, passed through untouched. */
  genreEvidence: unknown;
  similar: { source: 'lastfm' | 'listenbrainz'; items: SimilarArtist[] }[];
  /** Every catalog album by the artist (non-single), rated or not, so eras can split on the whole discography. */
  albums: MapAlbumInput[];
}

export interface MapUserInput {
  userId: string;
  username: string;
  /** Only artists with ≥1 album the user rated. */
  artists: MapArtistInput[];
}

// ── Nodes (eras.ts) ──────────────────────────────────────────────────────────

/** 'a:<artistId>' for a whole artist, 'e:<artistId>:<firstAlbumId>' for an era. */
export type NodeKey = string;

export interface EraSegment {
  key: NodeKey;
  artistId: string;
  /** Chronological, contiguous. */
  albumIds: string[];
  startYear: number | null;
  endYear: number | null;
}

/** A user's manual era override (taste_map_eras): split before each listed album. */
export interface EraOverride {
  artistId: string;
  splitAlbumIds: string[];
}

// ── Features (features.ts) ───────────────────────────────────────────────────

export type BlockName = 'tags' | 'text' | 'graph' | 'era';
export const BLOCKS: readonly BlockName[] = ['tags', 'text', 'graph', 'era'];

/** Each block is L2-normalized on its own (a zero vector when the node has no data for it). */
export type FeatureBlocks = Record<BlockName, number[]>;

export interface TagDim {
  /** Taxonomy node id, language-qualified where relevant (lib/genres/language.ts). */
  id: string;
  label: string;
}

export interface MapNode {
  key: NodeKey;
  artistId: string;
  label: string; // artist name
  eraLabel: string | null; // "2000–2005"; null for a single-era artist
  albumIds: string[];
  ratedAlbumIds: string[];
  /** Number of rated albums in this node. */
  mass: number;
  avgScore: number | null;
  blocks: FeatureBlocks;
  /** Which blocks had real data (false → zero vector, excluded from that block's similarity). */
  has: Record<BlockName, boolean>;
}

export interface FeatureSpace {
  tagDims: TagDim[]; // index-aligned with blocks.tags
  dims: Record<BlockName, number>;
  nodes: MapNode[];
}

/** Learned personal metric (metric.ts, Phase 4). Unit weights = no personalization. */
export interface MetricWeights {
  block: Record<BlockName, number>;
  /** Per-dimension weights on the tags block, index-aligned with tagDims. */
  tagDims: number[] | null;
}

// ── Layout (layout.ts) ───────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Contribution {
  /** A tag label ("Britpop"), or a block name ("described alike", "listeners overlap", "same era"). */
  label: string;
  /** Share of the pair's similarity, 0–1. */
  share: number;
}

export interface Neighbor {
  key: NodeKey;
  sim: number;
  why: Contribution[];
}

export interface LayoutResult {
  /** Roughly within [-1, 1]^3. */
  positions: Record<NodeKey, Vec3>;
  /** Top-2 principal plane of `positions`, same scale. */
  plane2d: Record<NodeKey, Vec2>;
  neighbors: Record<NodeKey, Neighbor[]>;
}

// ── API payload (/api/taste/map → web + iOS) ─────────────────────────────────

export interface TasteMapGroup {
  id: string;
  name: string;
  color: string; // hex
  /** World key from lib/taste/worlds.ts that seeded this group, if any. */
  seedWorld: string | null;
}

export interface TasteMapPayloadNode {
  key: NodeKey;
  artistId: string;
  label: string;
  eraLabel: string | null;
  mass: number;
  avgScore: number | null;
  covers: { id: string; title: string; coverUrl: string | null }[];
  /** groupId → membership weight, summing to ≤ 1. */
  groups: Record<string, number>;
  pos: Vec3;
  pos2d: Vec2;
  pinned: boolean;
  /**
   * Pinned from the 2D view: only its place in the D5 plane is fixed, depth stays
   * free (apiTypes.ts PinInput.softZ). Present (true) only on soft pins; optional
   * so older payloads, fixtures and iOS still parse.
   */
  softZ?: boolean;
}

export interface TasteMapPayload {
  version: 1;
  nodes: TasteMapPayloadNode[];
  groups: TasteMapGroup[];
  /** One per artist with ≥2 eras, keys in chronological order. */
  trails: { artistId: string; keys: NodeKey[] }[];
  neighbors: Record<NodeKey, Neighbor[]>;
}
