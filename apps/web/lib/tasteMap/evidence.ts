/**
 * How much a node's feature blocks can be trusted (README TODO "missing genre
 * data", item 4), shared by features.ts `similarity` and layout.ts
 * `weightedSimilarity` so the two stay identical, and by thin.ts.
 *
 * Every block of a node carries a confidence in [0, 1] (MapNode.confidence,
 * set by buildFeatureSpace; absent = 1 for older fixtures and hand-built test
 * nodes):
 *
 *   tags   1 when any tag comes from a trusted source (MusicBrainz / Last.fm /
 *          Wikidata / manual / legacy album rows, or the artist's MB / Last.fm /
 *          Wikidata evidence); WEAK_TAG_CONF when every tag is a store genre
 *          (iTunes / Deezer: "K-Pop" is iTunes' bucket for almost any Korean
 *          album); 1 when the user answered a question about the node.
 *   text   jina embeds title + tags text, not sound, so its worth follows the
 *          tags: 0.5 + 0.5 · tags confidence.
 *   graph  1 when the artist has its own similar-artist list; LISTED_ONLY_CONF
 *          when it only appears on other map artists' lists.
 *   era    1 (it is weak by its block weight, not by its data).
 *
 * Similarity: each shared block counts with weight w_b · min(conf_a, conf_b) in
 * both the numerator and the normalizer, and the normalizer is floored at
 * COVER_MIN of the metric's total block weight. A pair that shares only weak
 * evidence (an untagged node's era block, or one store genre) can no longer
 * reach ~1.0 and become everyone's nearest neighbor; a pair that shares at
 * least COVER_MIN of the weight is unchanged.
 */
import { BLOCKS, type BlockName, type MapNode, type MetricWeights } from './types';

/** Tag confidence when every tag on the node is a store genre (iTunes / Deezer). */
export const WEAK_TAG_CONF = 0.35;
/** Graph confidence when the artist has no list of its own but other map artists list it. */
export const LISTED_ONLY_CONF = 0.6;
/**
 * The normalizer never drops below this share of the total block weight. With
 * the default weights (tags 1, text 1, graph 1, era 0.5 → 3.5) a pair needs
 * 2.45 of shared, trusted weight to be scored at face value. Every
 * fully-evidenced pair (3.5) and every pair missing only text or only graph
 * (2.5) is untouched; tags + era only (1.5) is scaled by 0.61; era only (0.5)
 * by 0.20; a store-tag-only node without text (0.35 + 0.5) by 0.35; store tags
 * + text, no graph (CAMO: 0.35 + 0.675 + 0.5) by 0.62.
 *
 * Calibrated 2026-11-05 on zero / junnwest / one (kNN@8 / kNN@3 lists a thin
 * node appears in, of 29): 이상순 17 / 10 before → 16 / 5 at 0.5, 13 / 5 at
 * 0.6, 10 / 0 at 0.7; CAMO 18 / 10 → 14 / 6, 9 / 2, 3 / 0. Non-thin nodes keep
 * 96% (zero), 91% (junnwest, mostly CAMO leaving lists) and 100% (one) of
 * their kNN@8 lists at 0.7.
 */
export const COVER_MIN = 0.7;

/** Album genre sources that count as trusted (release_genres.source). */
export const TRUSTED_ALBUM_SOURCES: ReadonlySet<string> = new Set(['musicbrainz', 'lastfm', 'manual', 'legacy']);
/** Album genre sources that are store genres. */
export const STORE_ALBUM_SOURCES: ReadonlySet<string> = new Set(['itunes', 'deezer']);

export function blockConf(n: MapNode, b: BlockName): number {
  const c = n.confidence?.[b];
  return c == null || !Number.isFinite(c) ? 1 : Math.max(0, Math.min(1, c));
}

/** Σ max(0, w_b) over all blocks: the weight a fully-evidenced pair shares. */
export function totalWeight(w: MetricWeights): number {
  let s = 0;
  for (const b of BLOCKS) s += Math.max(0, w.block[b] ?? 1);
  return s;
}

/**
 * The effective weight of block b for the pair (0 when either node lacks it or
 * the metric zeroes it).
 */
export function pairBlockWeight(a: MapNode, b: MapNode, block: BlockName, w: MetricWeights): number {
  if (!a.has[block] || !b.has[block]) return 0;
  const wb = Math.max(0, w.block[block] ?? 1);
  if (wb === 0) return 0;
  return wb * Math.min(blockConf(a, block), blockConf(b, block));
}

/** The similarity normalizer for a pair whose shared effective weight is z. */
export function normalizer(z: number, w: MetricWeights): number {
  if (z <= 1e-12) return 0;
  return Math.max(z, COVER_MIN * totalWeight(w));
}
