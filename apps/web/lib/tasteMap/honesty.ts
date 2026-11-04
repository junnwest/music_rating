/**
 * Honest map (TASTE_MAP_PLAN.md §8 slice 2.1): how much of each node's real
 * neighborhood survives on the map you are looking at. Pure; client-side, so it
 * follows drags and re-arranges live.
 *
 * The payload's `neighbors` are the feature-space kNN (layout.ts, cosine on the
 * weighted blocks). For node i, take its top-k of those (k_i = min(k, list)) and
 * its k_i nearest nodes by on-screen distance (pos2d in 2D, pos in 3D):
 *
 *   recall_i  = |true ∩ shown| / k_i       (1 = neighborhood kept, 0 = torn apart)
 *   torn      = true neighbors drawn far away (the map hides that they are close)
 *   intruders = drawn close but not true neighbors (the map invents a closeness)
 *
 * This is the per-node form of trustworthiness/continuity (Venna & Kaski) with
 * plain set overlap instead of rank penalties, so it can be read as "3 of 5".
 */
import type { Neighbor, NodeKey } from './types';

export const HONEST_K = 5;

export interface Honesty {
  /** 0–1. */
  recall: number;
  /** Neighborhood size used for this node (≤ HONEST_K). */
  k: number;
  torn: NodeKey[];
  intruders: NodeKey[];
}

export interface HonestySummary {
  byKey: Map<NodeKey, Honesty>;
  /** Mean recall over nodes with at least one true neighbor on the map; 1 when none. */
  mean: number;
}

/** `coords`: every node on the map → its 2D or 3D position. Neighbors off the map are ignored. */
export function neighborHonesty(
  coords: Map<NodeKey, readonly number[]>,
  neighbors: Record<NodeKey, Neighbor[]>,
  k = HONEST_K,
): HonestySummary {
  const byKey = new Map<NodeKey, Honesty>();
  const keys = [...coords.keys()];
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    const truth = (neighbors[key] ?? [])
      .filter((nb) => nb.key !== key && coords.has(nb.key))
      .slice(0, k)
      .map((nb) => nb.key);
    if (!truth.length) continue;
    const p = coords.get(key)!;
    const shown = keys
      .filter((o) => o !== key)
      .map((o) => ({ o, d: dist2(p, coords.get(o)!) }))
      .sort((a, b) => a.d - b.d || (a.o < b.o ? -1 : 1))
      .slice(0, truth.length)
      .map((x) => x.o);
    const shownSet = new Set(shown);
    const truthSet = new Set(truth);
    const torn = truth.filter((t) => !shownSet.has(t));
    const intruders = shown.filter((s) => !truthSet.has(s));
    const recall = (truth.length - torn.length) / truth.length;
    byKey.set(key, { recall, k: truth.length, torn, intruders });
    sum += recall;
    count++;
  }
  return { byKey, mean: count ? sum / count : 1 };
}

function dist2(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}
