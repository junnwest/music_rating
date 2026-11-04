/**
 * Schematic 2D layout: the taste map drawn like a subway map, a readable
 * exaggeration of the true plane rather than a different picture. Pure;
 * client-side, from the true plane (`pos2d`) and the payload's kNN
 * `neighbors`. No genre or country goes in: sounds blend into each other
 * exactly as much as the neighbors say, and the territories, color field and
 * overlaps drawn on top emerge from where the stars end up.
 *
 * Two chemistry ideas do the exaggerating:
 *
 * - VSEPR around you. Every star is a domain around the nucleus (you, the
 *   map's mass center). Directions are spread out like electron pairs that
 *   repel: each star keeps its bearing's order, but bearings are evened out by
 *   mass (ANGLE_SPREAD of the way), so sounds that sat in one narrow wedge, or
 *   two islands on either side, fan out around you. Distance from you keeps
 *   its order and is evened out to fill a disc (center = between sounds,
 *   rim = one sound's far edge).
 * - Bonds and repulsion. Then the stars relax: every pair repels (Coulomb, so
 *   they spread evenly, about one slot apart), every kNN pair is a bond whose
 *   rest length shrinks with similarity, and each star is held loosely to its
 *   VSEPR seat so the true map's shape survives. A star with friends in two
 *   sounds is pulled between them, so overlaps sit where they really are.
 *
 * Distances are only roughly meaningful here; the Distortion lens scores it
 * honestly. The result is fitted into the bounding box of the input `pos2d`
 * (same plane units), so the 2D view's frame, fields and contours work on it
 * unchanged.
 */
import type { Neighbor, NodeKey, Vec2 } from './types';

/** How far bearings move toward evenly spread (0 = true bearings, 1 = fully even). */
export const ANGLE_SPREAD = 0.7;
/** Relaxation steps. */
export const STEPS = 300;
/** Pull toward the VSEPR seat, per slot of offset. */
export const SEAT_PULL = 0.06;
/** Bond stiffness, × similarity. */
export const BOND = 0.5;
/** Pairwise repulsion (force = REPEL / d²). */
export const REPEL = 0.35;
/** Bond rest length in slots at similarity 1 and at 0. */
export const BOND_NEAR = 1;
export const BOND_FAR = 3;
/** The fit may stretch the diagram along the box's long side, up to this ratio. */
export const MAX_STRETCH = 1.8;

const TAU = Math.PI * 2;

export interface SchematicNode {
  key: NodeKey;
  pos2d: Vec2;
  mass: number;
}

export interface Schematic {
  /** Plane coordinates (same units and box as `pos2d`). */
  pos: Map<NodeKey, Vec2>;
  /** You: the mass center the stars spread around; null with fewer than 3 stars. */
  nucleus: Vec2 | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The schematic layout of `nodes` (the visible ones), placed in their own `pos2d` bounding box. */
export function schematicLayout(nodes: SchematicNode[], neighbors: Record<NodeKey, Neighbor[]>): Schematic {
  const ns = [...nodes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const m = ns.length;
  const pos = new Map<NodeKey, Vec2>();
  if (m < 3) {
    for (const n of ns) pos.set(n.key, [n.pos2d[0], n.pos2d[1]]);
    return { pos, nucleus: null };
  }
  const idx = new Map(ns.map((n, i) => [n.key, i]));
  const mass = ns.map((n) => Math.max(n.mass, 0.05));
  const M = mass.reduce((s, x) => s + x, 0);

  // Bonds: symmetrized kNN similarity among laid-out nodes.
  const bondOf = new Map<string, { a: number; b: number; s: number }>();
  for (const n of ns)
    for (const nb of neighbors[n.key] ?? []) {
      const j = idx.get(nb.key);
      const i = idx.get(n.key)!;
      if (j == null || j === i || !(nb.sim > 0)) continue;
      const [a, b] = i < j ? [i, j] : [j, i];
      const id = `${a}:${b}`;
      const prev = bondOf.get(id);
      if (!prev || nb.sim > prev.s) bondOf.set(id, { a, b, s: Math.min(1, nb.sim) });
    }
  const bonds = [...bondOf.values()];

  // ── True plane, centered on you ──
  let gx = 0;
  let gy = 0;
  ns.forEach((n, i) => {
    gx += mass[i] * n.pos2d[0];
    gy += mass[i] * n.pos2d[1];
  });
  gx /= M;
  gy /= M;

  // ── VSEPR seats (slots): bearings evened out by mass, distances evened into a disc ──
  const theta = ns.map((n) => Math.atan2(n.pos2d[1] - gy, n.pos2d[0] - gx));
  const radius = ns.map((n) => Math.hypot(n.pos2d[0] - gx, n.pos2d[1] - gy));
  const byAngle = ns.map((_, i) => i).sort((a, b) => theta[a] - theta[b] || a - b);
  const even = new Array<number>(m);
  let cum = 0;
  for (const i of byAngle) {
    even[i] = (TAU * (cum + mass[i] / 2)) / M;
    cum += mass[i];
  }
  // Turn the even fan to best match the true bearings.
  let ss = 0;
  let cc = 0;
  for (let i = 0; i < m; i++) {
    ss += mass[i] * Math.sin(theta[i] - even[i]);
    cc += mass[i] * Math.cos(theta[i] - even[i]);
  }
  const turn = Math.atan2(ss, cc);
  const disc = 0.55 * Math.sqrt(m);
  const byRadius = ns.map((_, i) => i).sort((a, b) => radius[a] - radius[b] || a - b);
  const rank = new Array<number>(m);
  byRadius.forEach((i, r) => (rank[i] = r));
  const seat: Vec2[] = ns.map((_, i) => {
    const a = theta[i] + ANGLE_SPREAD * wrap(even[i] + turn - theta[i]);
    const r = disc * Math.sqrt((rank[i] + 0.5) / m);
    return [r * Math.cos(a), r * Math.sin(a)];
  });

  // ── Relax: repulsion, bonds, seats ──
  const x = seat.map((q) => [q[0], q[1]] as Vec2);
  const f = x.map(() => [0, 0]);
  for (let step = 0; step < STEPS; step++) {
    const heat = 1 - step / STEPS;
    for (const v of f) v[0] = v[1] = 0;
    for (let i = 0; i < m; i++)
      for (let j = i + 1; j < m; j++) {
        let dx = x[i][0] - x[j][0];
        let dy = x[i][1] - x[j][1];
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          // Coincident: split along a deterministic direction.
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        const k = REPEL / Math.max(d, 0.3) ** 2 / d;
        f[i][0] += k * dx;
        f[i][1] += k * dy;
        f[j][0] -= k * dx;
        f[j][1] -= k * dy;
      }
    for (const { a, b, s } of bonds) {
      const dx = x[b][0] - x[a][0];
      const dy = x[b][1] - x[a][1];
      const d = Math.hypot(dx, dy) || 1e-6;
      const rest = BOND_FAR + (BOND_NEAR - BOND_FAR) * s;
      const k = (BOND * s * (d - rest)) / d;
      f[a][0] += k * dx;
      f[a][1] += k * dy;
      f[b][0] -= k * dx;
      f[b][1] -= k * dy;
    }
    for (let i = 0; i < m; i++) {
      f[i][0] += SEAT_PULL * (seat[i][0] - x[i][0]);
      f[i][1] += SEAT_PULL * (seat[i][1] - x[i][1]);
      // Heavier stars move less; no step longer than half a slot (less as it cools).
      const len = Math.hypot(f[i][0], f[i][1]);
      const cap = (0.5 * (0.2 + 0.8 * heat)) / Math.max(len, 1e-9);
      const g = Math.min(1 / Math.sqrt(mass[i]), cap);
      x[i][0] += g * f[i][0];
      x[i][1] += g * f[i][1];
    }
  }

  // ── Fit into the true box ──
  let cx = 0;
  let cy = 0;
  x.forEach((q, i) => {
    cx += mass[i] * q[0];
    cy += mass[i] * q[1];
  });
  cx /= M;
  cy /= M;
  const box = (pts: Vec2[]) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [a, b] of pts) {
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, a);
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    }
    return { x0, x1, y0, y1, w: Math.max(x1 - x0, 1e-9), h: Math.max(y1 - y0, 1e-9) };
  };
  const tb = box(ns.map((n) => n.pos2d));
  const sb = box(x);
  const side = Math.max(tb.w, tb.h);
  const tw = Math.max(tb.w, side / MAX_STRETCH);
  const th = Math.max(tb.h, side / MAX_STRETCH);
  const k = Math.min(tw / sb.w, th / sb.h);
  // Stretch along the box's long side, toward its aspect.
  const sx = Math.min(MAX_STRETCH, Math.max(1, tw / (sb.w * k)));
  const sy = Math.min(MAX_STRETCH, Math.max(1, th / (sb.h * k)));
  const mx = (sb.x0 + sb.x1) / 2;
  const my = (sb.y0 + sb.y1) / 2;
  const ox = (tb.x0 + tb.x1) / 2;
  const oy = (tb.y0 + tb.y1) / 2;
  const place = (q: Vec2): Vec2 => [ox + (q[0] - mx) * k * sx, oy + (q[1] - my) * k * sy];
  ns.forEach((n, i) => pos.set(n.key, place(x[i])));
  return { pos, nucleus: place([cx, cy]) };
}
