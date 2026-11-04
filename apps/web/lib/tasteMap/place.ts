/**
 * "Add artist" ghost placement (TASTE_MAP_PLAN.md D3 + D8, Phase 4): where an
 * artist the user hasn't rated would land on their map — the kNN barycentre of
 * its nearest placed nodes in the user's metric (layout.ts placeNew) — and why,
 * from the exact per-dimension similarity split (features.ts explain).
 *
 * The candidate is folded into the user's input and the feature space is
 * rebuilt with it, because the tags block is TF-IDF over the user's nodes and
 * the graph block is an SVD over them: a lone node can't be projected into an
 * existing space. One extra node moves IDF and the SVD slightly, so the
 * candidate's neighbours are computed in a space a hair different from the one
 * the stored layout was solved in. Positions come from the stored layout, so
 * nothing on the map moves.
 *
 * Pure: no DB, never writes.
 */
import type { PlaceResponse } from './apiTypes';
import { countsForMap, splitEras } from './eras';
import { buildFeatureSpace, explain } from './features';
import { placeNew } from './layout';
import { metricFromRow, type MetricRow } from './metricStore';
import type { Contribution, EraOverride, MapArtistInput, MapNode, MapUserInput, Neighbor, NodeKey, Vec3 } from './types';

/** Anchors averaged for the position (placeNew's k). */
export const PLACE_K = 5;
/** Anchors named in the sentence, and contributions per anchor. */
const NAMED = 3;
const REASONS_PER_ANCHOR = 2;

/**
 * The candidate as the feature builder sees it: buildFeatureSpace only makes
 * nodes for segments with a rated album, so every album that counts for the map
 * (own studio work) is treated as rated, with no score. Unrated compilations
 * etc. stay unrated and so stay out, exactly as for a rated artist.
 */
export function asCandidate(artist: MapArtistInput): MapArtistInput {
  return {
    ...artist,
    albums: artist.albums.map((a) => (countsForMap(a) ? { ...a, rated: true, score: null } : { ...a, rated: false, score: null })),
  };
}

/** The node keys an artist that IS on the map has, in era order (empty if not on the map). */
export function onMapKeys(input: MapUserInput, artistId: string, overrides: EraOverride[] = []): NodeKey[] {
  const artist = input.artists.find((a) => a.id === artistId);
  if (!artist || !artist.albums.some((a) => a.rated)) return [];
  const rated = new Set(artist.albums.filter((a) => a.rated).map((a) => a.id));
  return splitEras(artist, overrides.find((o) => o.artistId === artistId))
    .filter((s) => s.albumIds.some((id) => rated.has(id)))
    .map((s) => s.key);
}

function nodeName(n: MapNode | undefined, fallback: string): string {
  if (!n) return fallback;
  return n.eraLabel ? `${n.label} ${n.eraLabel}` : n.label;
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** "Placed near Oasis (Britpop, listeners overlap), Blur (Britpop) and Pulp (described alike)." */
export function placeSentence(anchors: Neighbor[], nodeOf: (k: NodeKey) => MapNode | undefined): string {
  const named = anchors.slice(0, NAMED);
  if (!named.length) return 'Nothing on your map is close enough to place it, so it starts in the middle.';
  const parts = named.map((a) => {
    const why = a.why.slice(0, REASONS_PER_ANCHOR).map((c: Contribution) => c.label);
    const name = nodeName(nodeOf(a.key), a.key);
    return why.length ? `${name} (${why.join(', ')})` : name;
  });
  return `Placed near ${listJoin(parts)}.`;
}

export type PlaceResult =
  | { kind: 'on-map'; keys: NodeKey[] }
  | { kind: 'no-data' }
  | { kind: 'ok'; response: PlaceResponse };

export interface PlaceArgs {
  input: MapUserInput;
  /** The candidate as loaded (unrated); asCandidate is applied here. */
  candidate: MapArtistInput;
  overrides: EraOverride[];
  /** Stored layout positions with pins overlaid. */
  positions: Record<NodeKey, Vec3>;
  /** Stored taste_map_metric row (id-keyed), or null for the default metric. */
  metricRow: MetricRow | null;
  k?: number;
}

export function placeArtist({ input, candidate, overrides, positions, metricRow, k = PLACE_K }: PlaceArgs): PlaceResult {
  const keys = onMapKeys(input, candidate.id, overrides);
  if (keys.length) return { kind: 'on-map', keys };

  const cand = asCandidate(candidate);
  const others = input.artists.filter((a) => a.id !== candidate.id);
  const space = buildFeatureSpace({ ...input, artists: [...others, cand] }, overrides);
  const mine = space.nodes.filter((n) => n.artistId === candidate.id);
  if (!mine.length) return { kind: 'no-data' };
  // Whole-artist node, or the era with the most albums (first on a tie).
  const node = mine.reduce((best, n) => (n.albumIds.length > best.albumIds.length ? n : best), mine[0]);

  const weights = metricFromRow(metricRow, space);
  const placed: Record<NodeKey, Vec3> = {};
  for (const [key, p] of Object.entries(positions)) if (!key.includes(candidate.id)) placed[key] = p;
  const { pos, anchors } = placeNew(space, placed, node, {
    weights,
    k,
    explain: (a, b) => explain(a, b, space, weights),
  });
  const byKey = new Map(space.nodes.map((n) => [n.key, n]));
  return {
    kind: 'ok',
    response: {
      artistId: candidate.id,
      key: node.key,
      label: candidate.name,
      pos,
      anchors,
      explanation: placeSentence(anchors, (key) => byKey.get(key)),
    },
  };
}
