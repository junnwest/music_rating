/**
 * Ghost questions (README TODO "missing genre data", item 2): for a thin node,
 * "Is 이상순 closer to Korean Folk, Korean R&B or Korean Indie?" with 2–4
 * candidate genres drawn from its weak evidence:
 *
 *   own tags     the node's tag block (store genres + artist prior), × 1
 *   evidence     the artist's genre_evidence (MB / Last.fm / Wikidata / iTunes
 *                artist genres, and the iTunes store genre of each of its albums), × 0.6
 *   neighbors    the tag blocks of its 5 most similar placed nodes, × sim × 0.8
 *
 * each damped by the taxonomy's own `evidence` (catch-all scene words like
 * K-Pop count 0.3: iTunes files almost any Korean album there, so it rarely
 * answers anything). Candidates are taken best first, skipping one whose
 * in-language form was already taken (pop → K-Pop for a Korean act) or that is
 * an ancestor / descendant of a taken one, so the options are real
 * alternatives. Option ids are taxonomy node ids (the authored in-language
 * node when there is one: k-pop, k-rap); labels are the in-language form for
 * the artist ("Korean Folk" for a synthetic folk@ko).
 *
 * Pure: no DB.
 */
import { ancestorsOf, isSceneRoot } from '../genres/resolver';
import { evidenceOf, itunesTag, resolveEvidenceTag } from '../genres/placement';
import { parseQualified, qualifiedInfo, qualify } from '../genres/language';
import { NODE_BY_ID } from '../genres/taxonomy';
import { toArtistEvidence, type StoredGenreEvidence } from '../genres/artistEvidence';
import { albumLang } from './eras';
import { artistLang } from './features';
import type { GhostQuestion, QuestionOption } from './ghostApi';
import type { Ghost } from './thin';
import type { FeatureSpace, MapArtistInput, MapNode, MapUserInput, NodeKey } from './types';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 3;
const W_OWN = 1;
const W_EVIDENCE = 0.6;
const W_NEIGHBOR = 0.8;
const NEIGHBORS = 5;
/** Below this share of the best candidate's score an option isn't worth offering. */
const MIN_SHARE = 0.12;
/** Last resort when the evidence offers fewer than MIN_OPTIONS: broad families. */
const FALLBACK = ['pop', 'rock', 'hip-hop', 'rnb-soul', 'folk', 'electronic'];

/** Plain taxonomy id of a tag dim ('folk@ko' → 'folk'; authored ids stay). */
export function baseId(qid: string): string {
  return parseQualified(qid)?.base ?? qid;
}

/** Whether an id can be offered as an answer. */
export function isAnswerable(id: string): boolean {
  const node = NODE_BY_ID.get(id);
  if (!node || node.isScene || id === 'non-music') return false;
  // Descriptors (instrumental, ballad …) say how a record sounds, not its genre.
  if (node.evidence === 0 && !node.language && !node.localizes) return false;
  return true;
}

function evidenceTags(artist: MapArtistInput, albumIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const raw = artist.genreEvidence;
  if (!raw || typeof raw !== 'object') return out;
  let ev;
  try {
    ev = toArtistEvidence(raw as StoredGenreEvidence).artist;
  } catch {
    return out;
  }
  const add = (tag: string | null, w: number) => {
    const id = tag ? resolveEvidenceTag(tag) : null;
    if (id) out.set(id, (out.get(id) ?? 0) + w);
  };
  for (const [tags, isItunes] of [
    [ev.musicbrainz, false],
    [ev.lastfm, false],
    [ev.wikidata, false],
    [ev.itunes, true],
  ] as const) {
    if (!tags?.length) continue;
    const top = Math.max(...tags.map((t) => t.weight ?? 1));
    if (!(top > 0)) continue;
    for (const t of tags) add(isItunes ? itunesTag(t.tag) : t.tag, (t.weight ?? 1) / top);
  }
  // Store genre of each of the node's albums (artists.genre_evidence.itunes.albums).
  const albums = (raw as StoredGenreEvidence).itunes?.albums ?? {};
  for (const id of albumIds) if (albums[id]) add(itunesTag(albums[id]), 1);
  return out;
}

/** Candidate genres for one node, best first, before picking. */
export function candidateScores(
  node: MapNode,
  artist: MapArtistInput,
  space: FeatureSpace,
  neighbors: { node: MapNode; sim: number }[],
): Map<string, number> {
  const score = new Map<string, number>();
  const add = (id: string, w: number) => {
    if (!(w > 0) || !isAnswerable(id)) return;
    score.set(id, (score.get(id) ?? 0) + w * (0.3 + 0.7 * Math.min(1, evidenceOf(id))));
  };
  const fromBlock = (n: MapNode, w: number) => {
    if (!n.has.tags) return;
    n.blocks.tags.forEach((x, k) => {
      if (x > 0 && space.tagDims[k]) add(baseId(space.tagDims[k].id), w * x);
    });
  };
  fromBlock(node, W_OWN);
  const ev = evidenceTags(artist, node.albumIds);
  const evMax = Math.max(0, ...ev.values());
  if (evMax > 0) for (const [id, w] of ev) add(id, (W_EVIDENCE * w) / evMax);
  for (const nb of neighbors.slice(0, NEIGHBORS)) fromBlock(nb.node, W_NEIGHBOR * Math.max(0, nb.sim));
  return score;
}

/** Pick 2–MAX_OPTIONS real alternatives (see the header). */
export function pickOptions(scores: Map<string, number>, lang: string | null): QuestionOption[] {
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const best = ranked[0]?.[1] ?? 0;
  const taken: { id: string; q: string; anc: Set<string> }[] = [];
  const tryTake = (id: string) => {
    const q = qualify(id, lang);
    const anc = ancestorsOf(id);
    if (taken.some((t) => t.q === q || t.anc.has(id) || anc.has(t.id))) return;
    taken.push({ id, q, anc });
  };
  for (const [id, s] of ranked) {
    if (taken.length >= MAX_OPTIONS) break;
    if (s < MIN_SHARE * best) break;
    tryTake(id);
  }
  for (const id of FALLBACK) {
    if (taken.length >= MIN_OPTIONS) break;
    tryTake(id);
  }
  return taken.map(({ id, q }) => {
    const info = qualifiedInfo(q) ?? qualifiedInfo(id);
    // An authored in-language node (pop → k-pop) is the more exact answer; a synthetic 'folk@ko' isn't a node.
    const genreId = NODE_BY_ID.has(q) ? q : id;
    return { genreId, label: info?.display.en ?? id, labelKo: info?.display.ko ?? info?.display.en ?? id };
  });
}

function orList(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/**
 * One question per thin ghost the user hasn't hidden or answered ("none of
 * these" counts as answered). `S` is similarityMatrix(space.nodes) (index-aligned).
 */
export function buildQuestions(
  input: MapUserInput,
  space: FeatureSpace,
  S: Float64Array,
  ghosts: ReadonlyMap<NodeKey, Ghost>,
  answered: ReadonlySet<NodeKey> = new Set(),
): GhostQuestion[] {
  const artists = new Map(input.artists.map((a) => [a.id, a]));
  const n = space.nodes.length;
  const out: GhostQuestion[] = [];
  space.nodes.forEach((node, i) => {
    const g = ghosts.get(node.key);
    if (!g || g.reason !== 'thin' || g.hidden || answered.has(node.key)) return;
    const artist = artists.get(node.artistId);
    if (!artist) return;
    const neighbors = space.nodes
      .map((m, j) => ({ node: m, sim: S[i * n + j], j }))
      .filter((x) => x.j !== i && !ghosts.has(x.node.key))
      .sort((a, b) => b.sim - a.sim || (a.node.key < b.node.key ? -1 : 1));
    const lang = artistLang(artist.albums.map((a) => albumLang(a, artist)));
    const options = pickOptions(candidateScores(node, artist, space, neighbors), lang);
    if (options.length < MIN_OPTIONS) return;
    const name = node.eraLabel ? `${node.label} (${node.eraLabel})` : node.label;
    out.push({
      key: node.key,
      artistId: node.artistId,
      label: node.label,
      eraLabel: node.eraLabel,
      prompt: `Is ${name} closer to ${orList(options.map((o) => o.label))}?`,
      options,
    });
  });
  return out;
}
