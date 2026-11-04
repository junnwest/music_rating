/**
 * D5 principal plane: the pure 3×3 PCA behind the 2D view, split out of
 * layout.ts so the browser bundle can use it without pulling in umap-js.
 *
 * - `principalAxes(pts)`: mean + descending-variance axes, canonical signs.
 * - `projectPlane(positions)`: the payload's `pos2d` (layout.ts re-exports it).
 * - `planeBasis(positions)`: the same frame as an orthonormal basis
 *   {mu, u, v, n}, so the client can lift a 2D drag back into 3D
 *   (`mu + x·u + y·v + depth·n`) and project a re-arranged 3D layout down
 *   again with the session's fixed frame.
 */
import type { NodeKey, Vec2, Vec3 } from './types';

type M3 = number[][];

/** Eigen-decomposition of a symmetric 3×3 matrix (Jacobi). Values descending; vectors[i] is a unit column. */
function symEigen3(A: M3): { values: number[]; vectors: number[][] } {
  const a = A.map((r) => r.slice());
  const V: M3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]),
  };
}

const dot3 = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross3 = (u: number[], v: number[]): number[] => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
function unit3(u: number[]): number[] {
  const l = Math.sqrt(dot3(u, u));
  return l > 0 ? [u[0] / l, u[1] / l, u[2] / l] : [1, 0, 0];
}

/** Flip v so its largest-magnitude component is positive (deterministic sign convention). */
function canonicalSign(v: number[]): number[] {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]) > Math.abs(v[best]) + 1e-12) best = i;
  return v[best] < 0 ? v.map((x) => -x) : v;
}

function mean3(pts: Vec3[]): Vec3 {
  const m: Vec3 = [0, 0, 0];
  if (!pts.length) return m;
  for (const p of pts) {
    m[0] += p[0];
    m[1] += p[1];
    m[2] += p[2];
  }
  return [m[0] / pts.length, m[1] / pts.length, m[2] / pts.length];
}

function covariance3(pts: Vec3[], mu: Vec3): M3 {
  const C: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of pts) {
    const d = [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
  }
  return C;
}

/** Principal axes (descending variance) of a point set, with the canonical sign convention. */
export function principalAxes(pts: Vec3[]): { mu: Vec3; axes: number[][] } {
  const mu = mean3(pts);
  const { vectors } = symEigen3(covariance3(pts, mu));
  const a0 = canonicalSign(vectors[0]);
  const a1 = canonicalSign(vectors[1]);
  return { mu, axes: [a0, a1, unit3(cross3(a0, a1))] };
}

/**
 * D5: project 3D positions onto their top-2 principal plane (same scale, centered).
 * Keys are processed in sorted order and each axis's largest component is made
 * positive, so the result doesn't depend on insertion order and doesn't mirror
 * between re-solves of an aligned layout.
 */
export function projectPlane(positions: Record<NodeKey, Vec3>): Record<NodeKey, Vec2> {
  const keys = Object.keys(positions).sort();
  const out: Record<NodeKey, Vec2> = {};
  if (!keys.length) return out;
  const { mu, axes } = principalAxes(keys.map((k) => positions[k]));
  for (const k of keys) {
    const p = positions[k];
    const d = [p[0] - mu[0], p[1] - mu[1], p[2] - mu[2]];
    out[k] = [dot3(d, axes[0]), dot3(d, axes[1])];
  }
  return out;
}

/** Orthonormal right-handed frame of the D5 plane: u, v span it, n is its normal. */
export interface PlaneBasis {
  mu: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** The frame `projectPlane` projects onto (same key order, same signs). */
export function planeBasis(positions: Record<NodeKey, Vec3>): PlaneBasis {
  const keys = Object.keys(positions).sort();
  if (!keys.length) return { mu: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
  const { mu, axes } = principalAxes(keys.map((k) => positions[k]));
  return { mu, u: axes[0] as Vec3, v: axes[1] as Vec3, n: axes[2] as Vec3 };
}

/** World → plane frame: [x along u, y along v, depth along n]. */
export function toPlane(p: Vec3, b: PlaneBasis): Vec3 {
  const d = [p[0] - b.mu[0], p[1] - b.mu[1], p[2] - b.mu[2]];
  return [dot3(d, b.u), dot3(d, b.v), dot3(d, b.n)];
}

/** Plane frame → world: mu + x·u + y·v + z·n. */
export function fromPlane(q: Vec3, b: PlaneBasis): Vec3 {
  return [
    b.mu[0] + q[0] * b.u[0] + q[1] * b.v[0] + q[2] * b.n[0],
    b.mu[1] + q[0] * b.u[1] + q[1] * b.v[1] + q[2] * b.n[1],
    b.mu[2] + q[0] * b.u[2] + q[1] * b.v[2] + q[2] * b.n[2],
  ];
}
