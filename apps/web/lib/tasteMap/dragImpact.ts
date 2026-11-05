/**
 * Drag HUD maths (client-side, pure): what moving one star on the 2D plane
 * changes, measured against where the drag started. Map2D shows it live.
 *
 * - moved: plane distance, and as a share of the map's span (so "12% of the map").
 * - sound: the field's kernel-smoothed sound mix around the star (whatsHere,
 *   without the star itself), at the start vs now: the tags that gained or lost
 *   the most. This is "what kind of music you're putting it among".
 * - neighbors: its k nearest stars on the map at the start vs now (who it joined, who it left).
 * - fit: of its k most similar artists by the data (payload `neighbors`), how
 *   many are among its k nearest on the map (the honest-map recall), start vs
 *   now, and the mean true similarity to its map neighbors. A drop that lowers
 *   these disagrees with the data, which is what the personal metric learns from.
 */
import { whatsHere, type HerePoint } from './focus';
import type { NodeKey, Vec2 } from './types';

export const DRAG_K = 5;

export interface DragImpactInput {
  key: NodeKey;
  start: Vec2;
  now: Vec2;
  /** Every other solid star on the map (the dragged one is skipped if present). */
  points: HerePoint[];
  /** The dragged star's most similar artists by the data, best first. */
  trueNeighbors: NodeKey[];
  /** True similarity 0–1 to the dragged star, or null when unknown. */
  simTo: (other: NodeKey) => number | null;
  /** The map's span in plane units (for "% of the map"). */
  span: number;
  /** Kernel bandwidth for the sound mix (plane units). */
  bandwidth: number;
  k?: number;
}

export interface SoundShift {
  id: string;
  before: number;
  after: number;
  delta: number;
}

export interface DragImpact {
  moved: number;
  movedPct: number;
  /** Largest |delta| first, |delta| ≥ 2 points, at most 4. */
  sound: SoundShift[];
  nearBefore: NodeKey[];
  nearAfter: NodeKey[];
  joined: NodeKey[];
  left: NodeKey[];
  /** True neighbors among the map's nearest (out of `k`), start and now. */
  keptBefore: number;
  keptAfter: number;
  k: number;
  /** Mean true similarity to the map's nearest, start and now (null without data). */
  simBefore: number | null;
  simAfter: number | null;
}

function nearest(points: HerePoint[], at: Vec2, k: number): NodeKey[] {
  return points
    .map((p) => ({ key: p.key, d: (p.x - at[0]) ** 2 + (p.y - at[1]) ** 2 }))
    .sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1))
    .slice(0, k)
    .map((x) => x.key);
}

function meanSim(keys: NodeKey[], simTo: (o: NodeKey) => number | null): number | null {
  const v = keys.map(simTo).filter((s): s is number => s != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function dragImpact(input: DragImpactInput): DragImpact {
  const { key, start, now, trueNeighbors, simTo, span, bandwidth } = input;
  const points = input.points.filter((p) => p.key !== key);
  const truth = trueNeighbors.filter((t) => t !== key && points.some((p) => p.key === t)).slice(0, input.k ?? DRAG_K);
  const k = Math.min(input.k ?? DRAG_K, points.length);
  const moved = Math.hypot(now[0] - start[0], now[1] - start[1]);

  const mixAt = (at: Vec2) => new Map(whatsHere(points, at, bandwidth, 0).mix.map((m) => [m.id, m.share]));
  const a = mixAt(start);
  const b = mixAt(now);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const sound = [...ids]
    .map((id) => {
      const before = a.get(id) ?? 0;
      const after = b.get(id) ?? 0;
      return { id, before, after, delta: after - before };
    })
    .filter((s) => Math.abs(s.delta) >= 0.02)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.id < y.id ? -1 : 1))
    .slice(0, 4);

  const nearBefore = nearest(points, start, k);
  const nearAfter = nearest(points, now, k);
  const before = new Set(nearBefore);
  const after = new Set(nearAfter);
  const kt = truth.length;
  const kept = (near: NodeKey[]) => near.slice(0, kt).filter((x) => truth.includes(x)).length;

  return {
    moved,
    movedPct: span > 0 ? moved / span : 0,
    sound,
    nearBefore,
    nearAfter,
    joined: nearAfter.filter((x) => !before.has(x)),
    left: nearBefore.filter((x) => !after.has(x)),
    keptBefore: kept(nearBefore),
    keptAfter: kept(nearAfter),
    k: kt,
    simBefore: meanSim(nearBefore, simTo),
    simAfter: meanSim(nearAfter, simTo),
  };
}
