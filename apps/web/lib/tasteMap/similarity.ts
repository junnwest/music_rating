/**
 * Client-side reader for TasteMapPayload.similarity (payload.ts packSimilarity):
 * the all-pairs similarity under the map's metric, packed as an upper triangle
 * of integers 0–1000.
 */
import type { NodeKey, TasteMapPayload } from './types';

export interface SimilarityLookup {
  /** True similarity 0–1, or null when either key is unknown. */
  get(a: NodeKey, b: NodeKey): number | null;
  /** Every other node's similarity to `key`. */
  row(key: NodeKey): Map<NodeKey, number>;
}

export function similarityLookup(payload: Pick<TasteMapPayload, 'similarity' | 'neighbors'>): SimilarityLookup {
  const packed = payload.similarity;
  if (!packed) {
    // Older payloads: fall back to the top-k neighbor lists (unknown pairs → null).
    const get = (a: NodeKey, b: NodeKey) =>
      a === b ? 1 : (payload.neighbors[a]?.find((n) => n.key === b)?.sim ?? payload.neighbors[b]?.find((n) => n.key === a)?.sim ?? null);
    return {
      get,
      row: (key) => new Map((payload.neighbors[key] ?? []).map((n) => [n.key, n.sim])),
    };
  }
  const { keys, q } = packed;
  const n = keys.length;
  const index = new Map(keys.map((k, i) => [k, i]));
  // Offset of row i in the packed upper triangle.
  const rowStart = (i: number) => i * n - (i * (i + 1)) / 2;
  const at = (i: number, j: number) => {
    if (i === j) return 1;
    const [a, b] = i < j ? [i, j] : [j, i];
    return q[rowStart(a) + (b - a - 1)] / 1000;
  };
  return {
    get(a, b) {
      const i = index.get(a);
      const j = index.get(b);
      return i === undefined || j === undefined ? null : at(i, j);
    },
    row(key) {
      const i = index.get(key);
      const out = new Map<NodeKey, number>();
      if (i === undefined) return out;
      for (let j = 0; j < n; j++) if (j !== i) out.set(keys[j], at(i, j));
      return out;
    },
  };
}
