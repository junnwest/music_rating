/**
 * Pure geometry for the 3D star chart (components/sj/tasteMap/scene3d/*).
 *
 * - Scene frame: the 3D view is drawn in the session's fixed D5 frame
 *   (plane.ts PlaneBasis), so the principal plane is the "ecliptic" floor:
 *   scene X = u (the 2D view's x), scene Y = n (depth, up), scene Z = −v (the 2D
 *   view's y points away from a camera looking down at the floor). Looked at
 *   from straight above, the 3D view is the 2D "to scale" view. The mapping is
 *   a proper rotation (u × v = n), so nothing is mirrored.
 * - fitDistance: camera distance that frames a point set for a view direction,
 *   per axis, in closed form.
 * - orbitPosition: selection refocus in 3D, the 2D ego view's "distance" mode
 *   (focus.ts simRadius): every other star moves along its current bearing
 *   from the selected star to the radius its true similarity gives.
 * - placeLabels: greedy screen-space label placement by priority with four
 *   candidate slots per label, a budget for optional labels, reserved boxes
 *   (stage chrome) and hysteresis (a label keeps its previous slot).
 */
import type { PlaneBasis } from './plane';
import type { Vec3 } from './types';
import { simRadius } from './focus';

/** Scene units per map unit (map positions are roughly within [−1, 1]³). */
export const SCENE_SCALE = 10;

export interface SceneFrame {
  mu: Vec3;
  /** Rows: scene X, Y, Z as world directions (u, n, −v). */
  rows: [Vec3, Vec3, Vec3];
  scale: number;
}

export function sceneFrame(basis: PlaneBasis, scale = SCENE_SCALE): SceneFrame {
  const { u, v, n } = basis;
  return { mu: basis.mu, rows: [u, n, [-v[0], -v[1], -v[2]]], scale };
}

/** Map position → scene coordinates, written into `out` at offset `o`. */
export function toScene(f: SceneFrame, p: Vec3, out: Float32Array | number[], o = 0): void {
  const d0 = p[0] - f.mu[0];
  const d1 = p[1] - f.mu[1];
  const d2 = p[2] - f.mu[2];
  for (let r = 0; r < 3; r++) {
    const row = f.rows[r];
    out[o + r] = (d0 * row[0] + d1 * row[1] + d2 * row[2]) * f.scale;
  }
}

/** Scene coordinates → map position. */
export function fromScene(f: SceneFrame, x: number, y: number, z: number): Vec3 {
  const s = 1 / f.scale;
  const [a, b, c] = f.rows;
  return [
    f.mu[0] + (x * a[0] + y * b[0] + z * c[0]) * s,
    f.mu[1] + (x * a[1] + y * b[1] + z * c[1]) * s,
    f.mu[2] + (x * a[2] + y * b[2] + z * c[2]) * s,
  ];
}

/** 1, 2 or 5 × 10ⁿ, the smallest at or above x. */
export function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Distance from `center` along `back` (unit, center → camera) at which every
 * point sits inside `fill` of the half-frustum on both axes. `up` is the
 * world up (screen up is `up` made orthogonal to `back`). Points are xyz
 * triples in `pts` (only indices with mask[i] set, when given).
 */
export function fitDistance(
  pts: ArrayLike<number>,
  center: V3,
  back: V3,
  up: V3,
  fovYDeg: number,
  aspect: number,
  fill = 0.82,
  mask?: ArrayLike<number>,
): number {
  const b = unit(back);
  const right = unit(cross(up, b));
  const upS = cross(b, right);
  const tanY = Math.tan((fovYDeg * Math.PI) / 360) * fill;
  const tanX = tanY * aspect;
  let D = 0;
  const n = Math.floor(pts.length / 3);
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    const p: V3 = [pts[i * 3] - center[0], pts[i * 3 + 1] - center[1], pts[i * 3 + 2] - center[2]];
    const z = dot(p, b);
    D = Math.max(D, z + Math.abs(dot(p, right)) / tanX, z + Math.abs(dot(p, upS)) / tanY);
  }
  return D;
}

/**
 * Selection refocus: where a star goes when `sel` is selected. Bearing kept
 * from the current offset (a star sitting on the selection gets `fallback`),
 * radius = simRadius(sim) × R, never closer than `minR`.
 */
export function orbitPosition(sel: V3, at: V3, sim: number, R: number, minR: number, fallback: V3): V3 {
  let d: V3 = [at[0] - sel[0], at[1] - sel[1], at[2] - sel[2]];
  if (Math.hypot(d[0], d[1], d[2]) < 1e-6) d = fallback;
  const u = unit(d);
  const r = Math.max(minR, simRadius(sim) * R);
  return [sel[0] + u[0] * r, sel[1] + u[1] * r, sel[2] + u[2] * r];
}

/** A deterministic unit vector from a key (for stars with no bearing). */
export function hashDir(key: string): V3 {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const a = ((h >>> 0) / 2 ** 32) * Math.PI * 2;
  const z = (((Math.imul(h, 2654435761) >>> 0) / 2 ** 32) * 2 - 1) * 0.6;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

// ── Labels ───────────────────────────────────────────────────────────────────

export interface LabelCandidate {
  /** Index into the caller's arrays. */
  i: number;
  /** Higher first. */
  prio: number;
  /** Star center on screen and its drawn radius, px. */
  x: number;
  y: number;
  r: number;
  /** Text box size, px. */
  w: number;
  h: number;
  /** Always placed (selection, hover), even when overlapping. */
  force: boolean;
  /** Counts against the budget (false: neighbors of the selection, cursor reveals). */
  optional: boolean;
  /** Slot used last frame, −1 if none (hysteresis: tried first). */
  prev: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slots: above, below, right, left of the star. Returns the box's top-left. */
export function slotBox(c: Pick<LabelCandidate, 'x' | 'y' | 'r' | 'w' | 'h'>, slot: number, gap = 4): Box {
  const { x, y, r, w, h } = c;
  switch (slot) {
    case 1:
      return { x: x - w / 2, y: y + r + gap, w, h };
    case 2:
      return { x: x + r + gap, y: y - h / 2, w, h };
    case 3:
      return { x: x - r - gap - w, y: y - h / 2, w, h };
    default:
      return { x: x - w / 2, y: y - r - gap - h, w, h };
  }
}

const hit = (a: Box, b: Box, pad: number) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Greedy placement: candidates by priority; forced ones always get a slot
 * (their preferred one, or the first free); optional ones only while under
 * `budget`. A label must not overlap a placed label, a reserved box, another
 * star's disc (`stars`: x, y, r triples) or leave the stage. Returns the chosen
 * slot per candidate index (−1 = not shown).
 */
export function placeLabels(
  cands: LabelCandidate[],
  reserved: Box[],
  stage: { w: number; h: number },
  budget: number,
  stars?: ArrayLike<number>,
): Map<number, number> {
  const out = new Map<number, number>();
  const placed: Box[] = [];
  const sorted = [...cands].sort((a, b) => b.prio - a.prio);
  let optional = 0;
  const starHit = (b: Box, self: LabelCandidate) => {
    if (!stars) return false;
    for (let k = 0; k + 2 < stars.length; k += 3) {
      const sx = stars[k];
      const sy = stars[k + 1];
      const sr = stars[k + 2];
      if (Math.abs(self.x - sx) < 0.5 && Math.abs(self.y - sy) < 0.5) continue;
      const cx = Math.max(b.x, Math.min(sx, b.x + b.w));
      const cy = Math.max(b.y, Math.min(sy, b.y + b.h));
      if ((cx - sx) ** 2 + (cy - sy) ** 2 < sr * sr) return true;
    }
    return false;
  };
  for (const c of sorted) {
    if (!c.force && c.optional && optional >= budget) continue;
    const order = c.prev >= 0 ? [c.prev, 0, 1, 2, 3].filter((s, k, a) => a.indexOf(s) === k) : [0, 1, 2, 3];
    let chosen = -1;
    // Labels that must show (forced, and the non-optional: neighbors, cursor
    // reveals) relax the star rule only when every slot covers a star.
    for (const strict of c.force || !c.optional ? [true, false] : [true]) {
      for (const s of order) {
        const b = slotBox(c, s);
        if (b.x < 2 || b.y < 2 || b.x + b.w > stage.w - 2 || b.y + b.h > stage.h - 2) continue;
        if (reserved.some((r) => hit(b, r, 0))) continue;
        if (placed.some((p) => hit(b, p, 2))) continue;
        if (strict && starHit(b, c)) continue;
        chosen = s;
        break;
      }
      if (chosen >= 0) break;
    }
    if (chosen < 0 && c.force) chosen = c.prev >= 0 ? c.prev : 0;
    if (chosen < 0) continue;
    placed.push(slotBox(c, chosen));
    out.set(c.i, chosen);
    if (c.optional) optional++;
  }
  return out;
}

/** How many optional labels the stage carries: by area, more as you zoom in. */
export function labelBudget(stageArea: number, zoom: number): number {
  const base = Math.min(14, Math.max(4, stageArea / 42000));
  return Math.round(base * Math.min(4, Math.max(1, zoom) ** 1.6));
}
