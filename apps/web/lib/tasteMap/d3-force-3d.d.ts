// Minimal ambient types for d3-force-3d@3.0.5 (ships no types). Only what
// lib/tasteMap/forceLayout.ts uses.
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimLink<N extends SimNode> {
    source: string | number | N;
    target: string | number | N;
    index?: number;
  }

  export interface Force<N extends SimNode> {
    (alpha: number): void;
    initialize?: (nodes: N[], random: () => number, nDim: number) => void;
  }

  type Accessor<T, R> = R | ((d: T, i: number, data: T[]) => R);

  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    restart(): this;
    stop(): this;
    numDimensions(): number;
    numDimensions(n: 1 | 2 | 3): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(): number;
    alphaDecay(a: number): this;
    alphaTarget(): number;
    alphaTarget(a: number): this;
    velocityDecay(): number;
    velocityDecay(a: number): this;
    randomSource(r: () => number): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
    on(type: string, listener: ((this: Simulation<N>) => void) | null): this;
  }

  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;

  export interface PositionForce<N extends SimNode> extends Force<N> {
    strength(s: Accessor<N, number>): this;
  }
  export function forceX<N extends SimNode>(x?: Accessor<N, number>): PositionForce<N>;
  export function forceY<N extends SimNode>(y?: Accessor<N, number>): PositionForce<N>;
  export function forceZ<N extends SimNode>(z?: Accessor<N, number>): PositionForce<N>;

  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force<N> {
    id(fn: (d: N, i: number, data: N[]) => string | number): this;
    strength(s: Accessor<L, number>): this;
    distance(d: Accessor<L, number>): this;
    iterations(n: number): this;
  }
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;

  export interface CollideForce<N extends SimNode> extends Force<N> {
    radius(r: Accessor<N, number>): this;
    strength(s: number): this;
    iterations(n: number): this;
  }
  export function forceCollide<N extends SimNode>(radius?: Accessor<N, number>): CollideForce<N>;
}
