'use client';

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { niceStep } from '../../../../lib/tasteMap/scene3d';
import type { TreeEdge } from '../../../../lib/tasteMap/fields';
import { ADDITIVE, glowLineMaterial, type Model } from './model';
import { NEBULA_FRAG, NEBULA_VERT, SKY, STAR_FRAG, STAR_VERT } from './sky';

/**
 * The WebGL layers of the 3D star chart. Every object is built once per model
 * (useMemo) and mounted with <primitive>, so no THREE type crosses into a
 * fiber prop (the workspace has two @types/three copies, see Scene3D). Each
 * layer copies the model's arrays into its buffers in useFrame.
 */

// Fiber's camera / gl types come from the other @types/three copy; read them through this shape.
interface FrameCtx {
  camera: unknown;
  size: { width: number; height: number };
  gl: { getPixelRatio(): number };
}

const sizeUniforms = () => ({
  uViewH: { value: 600 },
  uTanHalf: { value: Math.tan((50 * Math.PI) / 360) },
  uDpr: { value: 1 },
  uFocus: { value: 25 },
});

function setSizeUniforms(u: ReturnType<typeof sizeUniforms>, s: FrameCtx, m: Model) {
  const cam = s.camera as THREE.PerspectiveCamera;
  u.uViewH.value = s.size.height;
  u.uTanHalf.value = Math.tan(((cam.fov ?? 50) * Math.PI) / 360);
  u.uDpr.value = s.gl.getPixelRatio();
  u.uFocus.value = m.focusDist;
}

function useDispose(...items: { dispose(): void }[]) {
  useEffect(
    () => () => items.forEach((x) => x.dispose()),
    // The items are memoized per model; dispose when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    items,
  );
}

// ── Stars ────────────────────────────────────────────────────────────────────

export function Stars({ m }: { m: Model }) {
  const { points, geo, mat, uniforms } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const attr = (k: string, size: number, src?: Float32Array) => {
      const a = new THREE.BufferAttribute(src ? Float32Array.from(src) : new Float32Array(m.n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, a);
    };
    attr('position', 3);
    attr('aColor', 3);
    attr('aAlpha', 1);
    attr('aRadius', 1, m.radius);
    attr('aProx', 1);
    attr('aHollow', 1, Float32Array.from(m.ghost));
    const u = sizeUniforms();
    const material = new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: u, ...ADDITIVE });
    const p = new THREE.Points(g, material);
    p.frustumCulled = false;
    p.renderOrder = 5;
    return { points: p, geo: g, mat: material, uniforms: u };
  }, [m]);
  useDispose(geo, mat);

  useFrame((s) => {
    setSizeUniforms(uniforms, s as unknown as FrameCtx, m);
    (geo.getAttribute('position').array as Float32Array).set(m.pos);
    (geo.getAttribute('aColor').array as Float32Array).set(m.col);
    (geo.getAttribute('aAlpha').array as Float32Array).set(m.alpha);
    (geo.getAttribute('aProx').array as Float32Array).set(m.prox);
    for (const k of ['position', 'aColor', 'aAlpha', 'aProx']) geo.getAttribute(k).needsUpdate = true;
  });
  return <primitive object={points} />;
}

// ── Nebulae ──────────────────────────────────────────────────────────────────

/**
 * The sound field in 3D: one large soft cloud per star in its lens color,
 * added as light, so overlapping clouds brighten where you listen most and
 * mix colors where sounds meet (the 2D colorField's kernel average, felt
 * rather than computed). Ghosts don't count.
 */
export function Nebulae({ m }: { m: Model }) {
  const { points, geo, mat, uniforms } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.n * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(m.n * 3), 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(m.n), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(m.n), 1));
    const u = sizeUniforms();
    const material = new THREE.ShaderMaterial({ vertexShader: NEBULA_VERT, fragmentShader: NEBULA_FRAG, uniforms: u, ...ADDITIVE });
    const p = new THREE.Points(g, material);
    p.frustumCulled = false;
    p.renderOrder = 1;
    return { points: p, geo: g, mat: material, uniforms: u };
  }, [m]);
  useDispose(geo, mat);

  useFrame((s) => {
    setSizeUniforms(uniforms, s as unknown as FrameCtx, m);
    (geo.getAttribute('position').array as Float32Array).set(m.pos);
    (geo.getAttribute('aColor').array as Float32Array).set(m.col);
    const A = geo.getAttribute('aAlpha').array as Float32Array;
    const S = geo.getAttribute('aSize').array as Float32Array;
    // Clouds scale with the map, so a small map isn't one blob and a big one isn't dust.
    const bw = Math.max(1.1, m.extent * 0.2);
    const sel = m.selKey != null;
    const crowd = Math.min(1, Math.sqrt(30 / Math.max(1, m.n)));
    for (let i = 0; i < m.n; i++) {
      const on = m.show[i] && !m.ghost[i] ? 1 : 0;
      A[i] = on * Math.min(1, m.alpha[i] * 1.4) * 0.075 * crowd * (sel ? 0.55 : 1) * (1 - 0.6 * m.orbitT);
      S[i] = bw * (0.85 + 0.25 * Math.sqrt(m.nodes[i].mass));
    }
    for (const k of ['position', 'aColor', 'aAlpha', 'aSize']) geo.getAttribute(k).needsUpdate = true;
  });
  return <primitive object={points} />;
}

// ── Floor: graticule + drop lines ────────────────────────────────────────────

/**
 * The D5 plane as a faint polar graticule (the 2D view lives on it), with a
 * drop line from every star to its foot on the plane, so height above or
 * below the plane (the depth the 2D view folds away) reads at a glance.
 * The floor fades when seen edge-on, and drop lines fade during the orbit
 * refocus (positions there aren't the map).
 */
export function Floor({ m }: { m: Model }) {
  const extent = Math.round(m.extent * 4) / 4;
  const grid = useMemo(() => {
    const step = niceStep(extent / 3.2);
    const R = Math.max(step * 2, Math.ceil((extent * 1.18) / step) * step);
    const pos: number[] = [];
    const col: number[] = [];
    const [r0, g0, b0] = SKY.lineRgb;
    const fade = (r: number) => 1 - Math.min(1, Math.max(0, (r - R * 0.55) / (R * 0.45))) ** 2;
    const seg = (x0: number, z0: number, x1: number, z1: number, a: number) => {
      pos.push(x0, 0, z0, x1, 0, z1);
      col.push(r0, g0, b0, a * fade(Math.hypot(x0, z0)), r0, g0, b0, a * fade(Math.hypot(x1, z1)));
    };
    for (let r = step; r <= R + 1e-6; r += step) {
      const N = 128;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2;
        const a1 = ((k + 1) / N) * Math.PI * 2;
        seg(r * Math.cos(a0), r * Math.sin(a0), r * Math.cos(a1), r * Math.sin(a1), 0.085);
      }
    }
    // Four spokes: the 2D view's x and y axes, through the plane's center.
    const PIECES = 12;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      for (let j = 0; j < PIECES; j++) {
        const t0 = (j / PIECES) * R;
        const t1 = ((j + 1) / PIECES) * R;
        seg(t0 * Math.cos(a), t0 * Math.sin(a), t1 * Math.cos(a), t1 * Math.sin(a), 0.07 * (1 - 0.5 * (t1 / R)));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 4));
    const mat = glowLineMaterial();
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 0;
    return { lines, g, mat };
  }, [extent]);
  useDispose(grid.g, grid.mat);

  // Drop lines: stem + a small cross at the foot, per star.
  const drops = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.n * 6 * 3), 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(m.n * 6 * 4), 4));
    const mat = glowLineMaterial();
    const lines = new THREE.LineSegments(g, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    return { lines, g, mat };
  }, [m]);
  useDispose(drops.g, drops.mat);

  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const cam = camera as unknown as THREE.Camera;
    cam.getWorldDirection(v);
    const edge = Math.min(1, Math.max(0, (Math.abs(v.y) - 0.05) / 0.3));
    grid.mat.uniforms.uOpacity.value = edge * (1 - 0.7 * m.orbitT);

    const P = drops.g.getAttribute('position').array as Float32Array;
    const C = drops.g.getAttribute('aColor').array as Float32Array;
    const crowd = Math.min(1, Math.sqrt(40 / Math.max(1, m.n)));
    const sel = m.selKey != null;
    const foot = Math.max(0.04, m.extent * 0.005);
    for (let i = 0; i < m.n; i++) {
      const x = m.pos[i * 3];
      const y = m.pos[i * 3 + 1];
      const z = m.pos[i * 3 + 2];
      const o = i * 18;
      // Stem, then the foot's two small strokes.
      P[o] = x;
      P[o + 1] = y;
      P[o + 2] = z;
      P[o + 3] = x;
      P[o + 4] = 0;
      P[o + 5] = z;
      P[o + 6] = x - foot;
      P[o + 7] = 0;
      P[o + 8] = z;
      P[o + 9] = x + foot;
      P[o + 10] = 0;
      P[o + 11] = z;
      P[o + 12] = x;
      P[o + 13] = 0;
      P[o + 14] = z - foot;
      P[o + 15] = x;
      P[o + 16] = 0;
      P[o + 17] = z + foot;
      const rel = m.rel[i];
      const base = rel ? 0.42 : sel ? 0.025 : 0.15 * crowd;
      const a = m.show[i] ? base * Math.min(1, m.alpha[i] * 1.5) * (1 - m.orbitT) * (m.ghost[i] ? 0.4 : 1) : 0;
      const c = i * 24;
      for (let k = 0; k < 6; k++) {
        C[c + k * 4] = m.col[i * 3];
        C[c + k * 4 + 1] = m.col[i * 3 + 1];
        C[c + k * 4 + 2] = m.col[i * 3 + 2];
        C[c + k * 4 + 3] = k === 0 ? a : k === 1 ? a * 0.35 : a * 0.35;
      }
    }
    drops.g.getAttribute('position').needsUpdate = true;
    drops.g.getAttribute('aColor').needsUpdate = true;
  });

  return (
    <>
      <primitive object={grid.lines} />
      <primitive object={drops.lines} />
    </>
  );
}

// ── Constellations ───────────────────────────────────────────────────────────

/**
 * The kNN graph's minimum spanning tree (fields.ts spanningTree, as in 2D):
 * the fewest strongest links that connect the map. Lines blend their two
 * stars' colors; the focused star's links light up; the rest recede while
 * something is selected.
 */
export function Constellations({ m, edges }: { m: Model; edges: TreeEdge[] }) {
  const { lines, g, mat, pairs } = useMemo(() => {
    const pr = edges
      .map((e) => [m.index.get(e.a), m.index.get(e.b), e.sim] as const)
      .filter((e): e is readonly [number, number, number] => e[0] != null && e[1] != null);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, pr.length) * 6), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(Math.max(1, pr.length) * 8), 4));
    const material = glowLineMaterial();
    const l = new THREE.LineSegments(geo, material);
    l.frustumCulled = false;
    l.renderOrder = 3;
    return { lines: l, g: geo, mat: material, pairs: pr };
  }, [m, edges]);
  useDispose(g, mat);

  useFrame(() => {
    const P = g.getAttribute('position').array as Float32Array;
    const C = g.getAttribute('aColor').array as Float32Array;
    const sel = m.selKey != null;
    const L = 0.45;
    pairs.forEach(([a, b, sim], k) => {
      P.set(m.pos.subarray(a * 3, a * 3 + 3), k * 6);
      P.set(m.pos.subarray(b * 3, b * 3 + 3), k * 6 + 3);
      const lit = m.rel[a] === 2 || m.rel[b] === 2;
      const base = lit ? 0.62 : sel ? 0.06 : 0.12 + 0.12 * Math.min(1, sim / 0.6);
      const vis = m.show[a] && m.show[b] ? Math.min(m.alpha[a], m.alpha[b]) : 0;
      const alpha = base * Math.min(1, vis * 1.3) * (1 - 0.85 * m.orbitT);
      for (const [end, i] of [
        [0, a],
        [1, b],
      ] as const) {
        const o = k * 8 + end * 4;
        for (let c = 0; c < 3; c++) C[o + c] = m.col[i * 3 + c] + (1 - m.col[i * 3 + c]) * L;
        C[o + 3] = alpha;
      }
    });
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aColor').needsUpdate = true;
  });
  return <primitive object={lines} />;
}
