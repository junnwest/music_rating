/**
 * Schematic 2D layout: the taste map drawn like a subway map, readable before
 * it is to scale. Pure; client-side, from the atlas (regions.ts) and the
 * payload's kNN `neighbors`, with the true plane (`pos2d`) only used to orient
 * the diagram so switching between the two views stays recognizable.
 *
 * Two chemistry ideas place everything:
 *
 * - VSEPR between countries. Countries are electron domains around a nucleus
 *   ("you", the map center): they spread as far apart as they can, so 2 sit
 *   opposite, 3 make a triangle, 4 a square. A bigger country pushes harder
 *   (like a lone pair) and takes a wider angle: the angle between neighbors is
 *   proportional to r_a + r_b + gap. Linked countries attract, so the circular
 *   order puts the ones with the most kNN weight between them side by side.
 *   The ring of countries is then turned (and mirrored if that fits better) to
 *   match where the countries sit on the true map, and stretched to the
 *   stage's aspect (stretching only moves discs apart, never together).
 * - Orbitals inside a country. Members fill quantized shells around the
 *   country's center: the capital (most central: strongest links at home, few
 *   abroad) alone in the middle, then shell k at radius k holding 6k members,
 *   so neighbors on every shell are about one slot apart. Members of a shell
 *   are spaced evenly (repulsion) and turned as a whole to best match each
 *   member's preferred direction (attraction): toward the countries its
 *   neighbors live in, and toward where it sits in its country on the true
 *   map. So bridges end up on the side facing the country they link to.
 *
 * Distances in this view mean only "same shell, same country"; the Distortion
 * lens scores it honestly. Output is in slots (one slot = the spacing between
 * neighbors on a shell), with the discs' bounding box centered on the origin;
 * the 2D view scales it to fit the stage.
 */
import type { Atlas } from './regions';
import type { Neighbor, NodeKey, Vec2 } from './types';

/** Gap between country discs, in slots. */
export const COUNTRY_GAP = 1.4;
/** Clearance between the nucleus and the nearest disc edge, in slots. */
export const NUCLEUS_GAP = 1.2;
/** Disc padding beyond the outer shell, in slots. */
export const DISC_PAD = 0.6;
/** Pull of a cross-country neighbor's direction, against 1 for the true-map direction. */
export const ABROAD_PULL = 2;
/** Brute-force the circular order of countries up to this many (7! = 5040 orders). */
export const MAX_EXACT_ORDER = 8;
/** The ring of countries stretches to the stage's aspect, up to this ratio. */
export const MAX_STRETCH = 1.8;

const TAU = Math.PI * 2;

export interface SchematicNode {
  key: NodeKey;
  pos2d: Vec2;
  mass: number;
}

export interface SchematicCountry {
  id: number;
  center: Vec2;
  /** Shell radii, innermost first (shell 1 onward; the capital sits at the center). */
  shells: number[];
  /** Disc radius: the outer shell plus padding. */
  radius: number;
}

export interface Schematic {
  pos: Map<NodeKey, Vec2>;
  countries: SchematicCountry[];
  /** The map center the countries orbit; null when there is only one country. */
  nucleus: Vec2 | null;
  /** Width and height of the discs' bounding box (centered on the origin). */
  extent: Vec2;
}

/** Members shell k can hold: 1 (the capital), then 6k, about one slot apart. */
export const shellCapacity = (k: number) => (k === 0 ? 1 : 6 * k);

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Rotation α that best maps angles `from` onto `to` (weighted circular mean), and its cost Σ w(1 − cos). */
function fitRotation(from: number[], to: number[], w: number[]): { alpha: number; cost: number } {
  let s = 0;
  let c = 0;
  for (let i = 0; i < from.length; i++) {
    s += w[i] * Math.sin(to[i] - from[i]);
    c += w[i] * Math.cos(to[i] - from[i]);
  }
  const alpha = Math.atan2(s, c);
  let cost = 0;
  for (let i = 0; i < from.length; i++) cost += w[i] * (1 - Math.cos(to[i] - from[i] - alpha));
  return { alpha, cost };
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  const out: number[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

/**
 * The schematic layout of the nodes the atlas covers (the visible ones). Nodes
 * outside the atlas get no position; callers fall back to `pos2d`. `aspect`:
 * the stage's width / height.
 */
export function schematicLayout(
  nodes: SchematicNode[],
  atlas: Atlas,
  neighbors: Record<NodeKey, Neighbor[]>,
  aspect = 1,
): Schematic {
  const byKey = new Map(nodes.filter((n) => atlas.countryOf.has(n.key)).map((n) => [n.key, n]));
  const empty: Schematic = { pos: new Map(), countries: [], nucleus: null, extent: [1, 1] };
  if (!byKey.size) return empty;

  // Symmetrized similarity among laid-out nodes.
  const sim = new Map<NodeKey, Map<NodeKey, number>>();
  for (const k of byKey.keys()) sim.set(k, new Map());
  for (const a of byKey.keys())
    for (const nb of neighbors[a] ?? []) {
      if (nb.key === a || !byKey.has(nb.key) || !(nb.sim > 0)) continue;
      const w = Math.max(nb.sim, sim.get(a)!.get(nb.key) ?? 0);
      sim.get(a)!.set(nb.key, w);
      sim.get(nb.key)!.set(a, w);
    }
  const countryOf = (k: NodeKey) => atlas.countryOf.get(k)!;

  // ── Countries: members by centrality, filled into shells ──
  const countries = atlas.countries
    .map((c) => {
      const ms = c.members.filter((k) => byKey.has(k));
      const central = (k: NodeKey) => {
        let home = 0;
        let abroad = 0;
        for (const [o, w] of sim.get(k)!) {
          if (countryOf(o) === c.id) home += w;
          else abroad += w;
        }
        return home - 0.5 * abroad + 0.05 * Math.sqrt(Math.max(0, byKey.get(k)!.mass));
      };
      const score = new Map(ms.map((k) => [k, central(k)]));
      const order = [...ms].sort((a, b) => score.get(b)! - score.get(a)! || (a < b ? -1 : 1));
      const shells: NodeKey[][] = [];
      let i = 0;
      for (let k = 0; i < order.length; k++) {
        shells.push(order.slice(i, i + shellCapacity(k)));
        i += shellCapacity(k);
      }
      let mass = 0;
      let tx = 0;
      let ty = 0;
      for (const k of ms) {
        const n = byKey.get(k)!;
        const m = Math.max(n.mass, 0.05);
        mass += m;
        tx += m * n.pos2d[0];
        ty += m * n.pos2d[1];
      }
      const outer = shells.length - 1;
      return { id: c.id, shells, radius: outer + DISC_PAD, mass, truth: [tx / mass, ty / mass] as Vec2 };
    })
    .filter((c) => c.shells.length > 0);
  if (!countries.length) return empty;

  // True center of the laid-out nodes.
  let gm = 0;
  let gx = 0;
  let gy = 0;
  for (const n of byKey.values()) {
    const m = Math.max(n.mass, 0.05);
    gm += m;
    gx += m * n.pos2d[0];
    gy += m * n.pos2d[1];
  }
  const G: Vec2 = [gx / gm, gy / gm];

  // ── VSEPR: country centers around the nucleus (slot units) ──
  const C = countries.length;
  const center = new Map<number, Vec2>();
  let nucleus: Vec2 | null = null;
  if (C === 1) {
    center.set(countries[0].id, [0, 0]);
  } else {
    nucleus = [0, 0];
    const idx = new Map(countries.map((c, i) => [c.id, i]));
    const phi = countries.map((c) => Math.atan2(c.truth[1] - G[1], c.truth[0] - G[0]));
    const maxW = Math.max(1e-9, ...atlas.links.map((l) => l.w));
    const link = countries.map(() => countries.map(() => 0));
    for (const l of atlas.links) {
      const a = idx.get(l.a);
      const b = idx.get(l.b);
      if (a == null || b == null) continue;
      link[a][b] = link[b][a] = l.w / maxW;
    }
    // Circular order: bonded countries side by side, then true-map neighbors.
    let order: number[];
    if (C <= MAX_EXACT_ORDER) {
      let best = -Infinity;
      order = [];
      for (const rest of permutations(countries.map((_, i) => i).slice(1))) {
        const o = [0, ...rest];
        let s = 0;
        for (let i = 0; i < C; i++) {
          const a = o[i];
          const b = o[(i + 1) % C];
          s += link[a][b] + 0.35 * Math.cos(phi[a] - phi[b]);
        }
        if (s > best + 1e-9) {
          best = s;
          order = o;
        }
      }
    } else {
      order = countries.map((_, i) => i).sort((a, b) => phi[a] - phi[b] || a - b);
    }
    // Angles: each gap proportional to what it must clear.
    const need = order.map((a, i) => countries[a].radius + countries[order[(i + 1) % C]].radius + COUNTRY_GAP);
    const total = need.reduce((s, x) => s + x, 0);
    const gap = need.map((x) => (TAU * x) / total);
    const theta = new Array<number>(C).fill(0);
    for (let i = 1; i < C; i++) theta[order[i]] = theta[order[i - 1]] + gap[i - 1];
    let R = Math.max(...countries.map((c) => c.radius)) + NUCLEUS_GAP;
    for (let i = 0; i < C; i++) R = Math.max(R, need[i] / (2 * Math.sin(Math.min(Math.PI, gap[i]) / 2)));
    // Turn (and maybe mirror) the ring to match the true map.
    const w = countries.map((c) => c.mass);
    const fwd = fitRotation(theta, phi, w);
    const mirrored = theta.map((t) => -t);
    const rev = fitRotation(mirrored, phi, w);
    const [th, alpha] = rev.cost < fwd.cost - 1e-9 ? [mirrored, rev.alpha] : [theta, fwd.alpha];
    // Stretch along the stage's long axis.
    const stretch = Math.min(MAX_STRETCH, Math.max(1 / MAX_STRETCH, aspect));
    const ax = Math.max(1, stretch);
    const ay = Math.max(1, 1 / stretch);
    countries.forEach((c, i) => center.set(c.id, [R * ax * Math.cos(th[i] + alpha), R * ay * Math.sin(th[i] + alpha)]));
  }

  // ── Orbitals: each shell spaced evenly, turned toward its members' pulls ──
  const pos = new Map<NodeKey, Vec2>();
  for (const c of countries) {
    const S = center.get(c.id)!;
    pos.set(c.shells[0][0], [S[0], S[1]]);
    for (let k = 1; k < c.shells.length; k++) {
      const ms = c.shells[k];
      const want = ms.map((key) => {
        const n = byKey.get(key)!;
        let vx = n.pos2d[0] - c.truth[0];
        let vy = n.pos2d[1] - c.truth[1];
        const len = Math.hypot(vx, vy);
        if (len > 1e-12) {
          vx /= len;
          vy /= len;
        }
        for (const [o, s] of sim.get(key)!) {
          const oc = countryOf(o);
          if (oc === c.id) continue;
          const T = center.get(oc);
          if (!T) continue;
          const dx = T[0] - S[0];
          const dy = T[1] - S[1];
          const d = Math.hypot(dx, dy) || 1;
          vx += (ABROAD_PULL * s * dx) / d;
          vy += (ABROAD_PULL * s * dy) / d;
        }
        return Math.hypot(vx, vy) > 1e-9 ? Math.atan2(vy, vx) : 0;
      });
      const m = ms.length;
      const sorted = ms.map((key, i) => ({ key, a: want[i] })).sort((x, y) => x.a - y.a || (x.key < y.key ? -1 : 1));
      const slots = sorted.map((_, j) => (j * TAU) / m);
      const ones = sorted.map(() => 1);
      let best = { shift: 0, alpha: 0, cost: Infinity };
      for (let s = 0; s < m; s++) {
        const to = slots.map((_, j) => sorted[(j + s) % m].a);
        const f = fitRotation(slots, to, ones);
        if (f.cost < best.cost - 1e-9) best = { shift: s, alpha: f.alpha, cost: f.cost };
      }
      slots.forEach((b, j) => {
        const a = wrap(b + best.alpha);
        pos.set(sorted[(j + best.shift) % m].key, [S[0] + k * Math.cos(a), S[1] + k * Math.sin(a)]);
      });
    }
  }

  // ── Center the discs' bounding box on the origin ──
  let ox = Infinity;
  let oy = Infinity;
  let px = -Infinity;
  let py = -Infinity;
  for (const c of countries) {
    const S = center.get(c.id)!;
    ox = Math.min(ox, S[0] - c.radius);
    px = Math.max(px, S[0] + c.radius);
    oy = Math.min(oy, S[1] - c.radius);
    py = Math.max(py, S[1] + c.radius);
  }
  const cx = (ox + px) / 2;
  const cy = (oy + py) / 2;
  const shift = (q: Vec2): Vec2 => [q[0] - cx, q[1] - cy];

  for (const [k, q] of pos) pos.set(k, shift(q));
  return {
    pos,
    countries: countries.map((c) => ({
      id: c.id,
      center: shift(center.get(c.id)!),
      shells: c.shells.slice(1).map((_, i) => i + 1),
      radius: c.radius,
    })),
    nucleus: nucleus ? shift(nucleus) : null,
    extent: [px - ox, py - oy],
  };
}
