/**
 * D4/D5 re-arrange: a constrained d3-force-3d simulation over the solved layout.
 * Framework-free (browser + Node): no DOM, no React. The browser animates it
 * with `.start()` / `.on('tick')`; tests and the server just call `.tick(n)`.
 *
 * Forces:
 *  - anchor: pull toward each node's initial (UMAP) position, `anchorStrength`;
 *  - link:   kNN links in the learned metric, strength ∝ sim, rest length shrinking with sim;
 *  - pins:   pinned nodes are fixed via fx/fy/fz (exactly, every tick);
 *  - groups: attraction toward each group's membership-weighted centroid;
 *  - collide: radius = node size (+ padding).
 *
 * `mode: '2d'` runs the same simulation in 2 dimensions (x, y), leaving z as
 * passed in. Per D5 that's a collision pass over the projected plane, so links
 * and groups default to 0 there (override via options).
 *
 * Partial pins (D5): a node pinned from the 2D view (`pinned: 'xy'`) fixes only
 * its position in the D5 plane; its depth along the plane normal stays free.
 * The plane isn't axis-aligned, so in 3d mode pass `basis` (plane.ts
 * planeBasis): the simulation then runs in the (u, v, n) frame, where the plane
 * is x, y and the normal is z, and fixes fx/fy for 'xy' pins and fx/fy/fz for
 * full pins. Every force here is rotation-invariant (anchors rotate with the
 * nodes), so this changes nothing else; positions in and out stay in world
 * coordinates. In 2d mode the input is already plane coords, so 'xy' and full
 * pins behave the same and `basis` is ignored.
 */
import {
  forceCollide,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type Force,
  type Simulation,
} from 'd3-force-3d';
import { fromPlane, toPlane, type PlaneBasis } from './plane';
import type { NodeKey, Vec3 } from './types';

export interface RearrangeNode {
  key: NodeKey;
  /** Initial position; also the anchor target. In 2d mode x, y are the plane coords. */
  pos: Vec3;
  /** true = fixed in every axis; 'xy' = fixed in the D5 plane only (depth free, needs `basis` in 3d). */
  pinned: boolean | 'xy';
  /** Collision radius in map units. */
  size: number;
}

export interface RearrangeLink {
  a: NodeKey;
  b: NodeKey;
  sim: number;
}

export interface RearrangeGroup {
  key: NodeKey;
  /** groupId → membership weight (≤ 1 in total). */
  weights: Record<string, number>;
}

export interface RearrangeOptions {
  mode?: '2d' | '3d';
  /** Anchor pull toward the initial position (default 0.1). Decay it as the user corrects more. */
  anchorStrength?: number;
  /** Multiplier on link sims (default 0.3 in 3d, 0 in 2d). */
  linkStrength?: number;
  /** Rest length for a link of similarity `sim` (default 0.1 + 0.5·(1 − sim)). */
  linkDistance?: (sim: number) => number;
  /** Group-centroid attraction (default 0.05 in 3d, 0 in 2d). */
  groupStrength?: number;
  /** Collision strength 0–1 (default 0.7). */
  collisionStrength?: number;
  collisionPadding?: number;
  velocityDecay?: number;
  alphaDecay?: number;
  seed?: number;
  /**
   * 3d mode: the session's D5 plane frame. When set, the simulation runs in
   * (u, v, n) coordinates so 'xy' pins fix exactly the in-plane components.
   * Without it, 'xy' pins fix world x, y (only right for an axis-aligned plane).
   */
  basis?: PlaneBasis;
}

export type PinMode = boolean | 'xy';

export interface Rearrange {
  /** Advance n ticks synchronously (default 1) and emit one 'tick'. */
  tick(n?: number): Rearrange;
  positions(): Record<NodeKey, Vec3>;
  /**
   * Fix a node at `pos` (world coords). `mode: 'xy'` fixes only the in-plane
   * components (depth stays free). In 2d mode only x, y are fixed; z is stored.
   */
  pin(key: NodeKey, pos: Vec3, mode?: true | 'xy'): Rearrange;
  unpin(key: NodeKey): Rearrange;
  isPinned(key: NodeKey): boolean;
  pinMode(key: NodeKey): PinMode;
  setAnchorStrength(s: number): Rearrange;
  on(event: 'tick' | 'end', cb: (() => void) | null): Rearrange;
  /** Start the animated (timer-driven) run; 'tick' fires per frame. */
  start(alpha?: number): Rearrange;
  stop(): Rearrange;
  alpha(): number;
  readonly mode: '2d' | '3d';
}

interface SNode {
  key: NodeKey;
  index?: number;
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  ax: number;
  ay: number;
  az: number;
  /** z carried through untouched in 2d mode. */
  pz: number;
  size: number;
  pinned: PinMode;
  groups: [string, number][];
}

interface SLink {
  source: string | SNode;
  target: string | SNode;
  sim: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groupForce(nodes: SNode[], nDim: number, strength: () => number): Force<SNode> {
  const force = (alpha: number) => {
    const s = strength();
    if (s <= 0) return;
    const acc = new Map<string, { x: number; y: number; z: number; w: number }>();
    for (const nd of nodes) {
      for (const [g, w] of nd.groups) {
        if (w <= 0) continue;
        const c = acc.get(g) ?? { x: 0, y: 0, z: 0, w: 0 };
        c.x += w * nd.x;
        c.y += w * nd.y;
        c.z += w * (nd.z ?? 0);
        c.w += w;
        acc.set(g, c);
      }
    }
    for (const nd of nodes) {
      if (nd.pinned === true) continue;
      // An 'xy' pin only moves along the normal (z in the plane frame).
      const inPlane = !nd.pinned;
      if (!inPlane && nDim < 3) continue;
      for (const [g, w] of nd.groups) {
        const c = acc.get(g);
        if (!c || c.w <= 0 || w <= 0) continue;
        const k = w * s * alpha;
        if (inPlane) {
          nd.vx = (nd.vx ?? 0) + (c.x / c.w - nd.x) * k;
          nd.vy = (nd.vy ?? 0) + (c.y / c.w - nd.y) * k;
        }
        if (nDim > 2) nd.vz = (nd.vz ?? 0) + (c.z / c.w - (nd.z ?? 0)) * k;
      }
    }
  };
  return force;
}

export function createRearrange(
  nodesIn: RearrangeNode[],
  linksIn: RearrangeLink[],
  groupsIn: RearrangeGroup[] = [],
  opts: RearrangeOptions = {},
): Rearrange {
  const mode = opts.mode ?? '3d';
  const nDim = mode === '2d' ? 2 : 3;
  let anchorStrength = opts.anchorStrength ?? 0.1;
  const linkStrength = opts.linkStrength ?? (mode === '2d' ? 0 : 0.3);
  const linkDistance = opts.linkDistance ?? ((sim: number) => 0.1 + 0.5 * (1 - sim));
  const groupStrength = opts.groupStrength ?? (mode === '2d' ? 0 : 0.05);
  const padding = opts.collisionPadding ?? 0;
  const basis = nDim > 2 ? opts.basis : undefined;
  const inFrame = (p: Vec3): Vec3 => (basis ? toPlane(p, basis) : p);
  const outFrame = (p: Vec3): Vec3 => (basis ? fromPlane(p, basis) : p);

  const groupsByKey = new Map(groupsIn.map((g) => [g.key, Object.entries(g.weights)]));
  const nodes: SNode[] = nodesIn.map((n) => {
    const p = inFrame(n.pos);
    const nd: SNode = {
      key: n.key,
      x: p[0],
      y: p[1],
      ax: p[0],
      ay: p[1],
      az: p[2],
      pz: p[2],
      size: n.size,
      pinned: n.pinned,
      groups: groupsByKey.get(n.key) ?? [],
    };
    if (nDim > 2) nd.z = p[2];
    if (n.pinned) {
      nd.fx = p[0];
      nd.fy = p[1];
      if (nDim > 2 && n.pinned === true) nd.fz = p[2];
    }
    return nd;
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const links: SLink[] = linksIn
    .filter((l) => l.a !== l.b && byKey.has(l.a) && byKey.has(l.b))
    .map((l) => ({ source: l.a, target: l.b, sim: l.sim }));

  const sim: Simulation<SNode> = forceSimulation<SNode>(nodes, nDim as 2 | 3).stop();
  sim.randomSource(mulberry32(opts.seed ?? 1));
  if (opts.velocityDecay != null) sim.velocityDecay(opts.velocityDecay);
  if (opts.alphaDecay != null) sim.alphaDecay(opts.alphaDecay);

  const anchorS = (d: SNode) => (d.pinned ? 0 : anchorStrength);
  // An 'xy' pin's free depth is still anchored to its original depth.
  const anchorZ = (d: SNode) => (d.pinned === true ? 0 : anchorStrength);
  const fx = forceX<SNode>((d) => d.ax).strength(anchorS);
  const fy = forceY<SNode>((d) => d.ay).strength(anchorS);
  const fz = forceZ<SNode>((d) => d.az).strength(anchorZ);
  sim.force('anchorX', fx).force('anchorY', fy);
  if (nDim > 2) sim.force('anchorZ', fz);
  const refreshAnchors = () => {
    fx.strength(anchorS);
    fy.strength(anchorS);
    if (nDim > 2) fz.strength(anchorZ);
  };

  if (linkStrength > 0 && links.length) {
    sim.force(
      'link',
      forceLink<SNode, SLink>(links)
        .id((d) => d.key)
        .strength((l) => linkStrength * Math.max(l.sim, 0))
        .distance((l) => linkDistance(l.sim)),
    );
  }
  if (groupStrength > 0) sim.force('group', groupForce(nodes, nDim, () => groupStrength));
  sim.force(
    'collide',
    forceCollide<SNode>((d) => d.size + padding).strength(opts.collisionStrength ?? 0.7),
  );

  const listeners: Record<'tick' | 'end', (() => void) | null> = { tick: null, end: null };
  sim.on('tick.rearrange', () => listeners.tick?.());
  sim.on('end.rearrange', () => listeners.end?.());

  const api: Rearrange = {
    mode,
    tick(n = 1) {
      sim.tick(n);
      listeners.tick?.();
      return api;
    },
    positions() {
      const out: Record<NodeKey, Vec3> = {};
      for (const nd of nodes) out[nd.key] = outFrame([nd.x, nd.y, nDim > 2 ? (nd.z ?? 0) : nd.pz]);
      return out;
    },
    pin(key, posWorld, pinMode = true) {
      const nd = byKey.get(key);
      if (!nd) return api;
      const pos = inFrame(posWorld);
      nd.pinned = pinMode;
      nd.x = nd.fx = pos[0];
      nd.y = nd.fy = pos[1];
      nd.vx = 0;
      nd.vy = 0;
      if (nDim > 2) {
        nd.z = pos[2];
        nd.fz = pinMode === true ? pos[2] : null;
        nd.vz = 0;
      } else {
        nd.pz = pos[2];
      }
      refreshAnchors();
      return api;
    },
    unpin(key) {
      const nd = byKey.get(key);
      if (!nd) return api;
      nd.pinned = false;
      nd.fx = nd.fy = nd.fz = null;
      refreshAnchors();
      return api;
    },
    isPinned(key) {
      return !!byKey.get(key)?.pinned;
    },
    pinMode(key) {
      return byKey.get(key)?.pinned ?? false;
    },
    setAnchorStrength(s) {
      anchorStrength = s;
      refreshAnchors();
      return api;
    },
    on(event, cb) {
      listeners[event] = cb;
      return api;
    },
    start(alpha = 1) {
      sim.alpha(alpha).restart();
      return api;
    },
    stop() {
      sim.stop();
      return api;
    },
    alpha() {
      return sim.alpha();
    },
  };
  return api;
}
