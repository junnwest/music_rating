import * as THREE from 'three';
import { GRAY, hueMap, nodeRgb, type MapLens } from '../../../../lib/tasteMap/color';
import type { HonestySummary } from '../../../../lib/tasteMap/honesty';
import { hashDir, sceneFrame, toScene, type SceneFrame } from '../../../../lib/tasteMap/scene3d';
import type { PlaneBasis } from '../../../../lib/tasteMap/plane';
import type { NodeKey, PaletteHue, TasteMapPayloadNode } from '../../../../lib/tasteMap/types';
import { starRadius } from './sky';

/**
 * The scene's per-frame state, shared by every layer through a ref: written
 * once per frame by the Director (positions, colors, alphas, screen
 * projections, cursor proximity), read by the WebGL layers and the two 2D
 * overlays. Typed arrays, no per-frame allocation, no React state.
 */
export interface Model {
  nodes: TasteMapPayloadNode[];
  n: number;
  index: Map<NodeKey, number>;
  frame: SceneFrame;
  /** Scene positions: from the payload this frame / where each star is heading / as drawn. */
  base: Float32Array;
  target: Float32Array;
  pos: Float32Array;
  /** Drawn color (0–1 rgb), eased toward the lens color. */
  col: Float32Array;
  /** Drawn star alpha, eased (visibility, selection dimming). */
  alpha: Float32Array;
  /** Drawn at all: visible and not a hidden ghost. */
  show: Uint8Array;
  ghost: Uint8Array;
  radius: Float32Array;
  /** A fixed bearing per star, for the orbit when it sits on the selection. */
  fallback: Float32Array;
  /** 0–1 by mass rank (heaviest = 1). */
  importance: Float32Array;
  // Screen space, CSS px relative to the stage.
  sx: Float32Array;
  sy: Float32Array;
  depth: Float32Array;
  /** Drawn core radius, px. */
  rpx: Float32Array;
  front: Uint8Array;
  /** 2 = selected or hovered, 1 = a neighbor of the selection, 0 = other. */
  rel: Uint8Array;
  /** Cursor proximity 0–1, eased. */
  prox: Float32Array;
  /** Label alpha (eased) and slot (placeLabels), −1 = none. */
  labelA: Float32Array;
  labelSlot: Int8Array;
  /** Label hit boxes drawn last frame: x, y, w, h, index. */
  labelBoxes: number[];
  /** Region names drawn this frame (back canvas): labels keep off them. */
  regionBoxes: { x: number; y: number; w: number; h: number }[];
  cursor: { x: number; y: number } | null;
  w: number;
  h: number;
  /** Camera → orbit target distance now, and at the home framing. */
  focusDist: number;
  homeDist: number;
  /** Bounding radius of the map (scene units), for the floor and the orbit. */
  extent: number;
  /** Selection refocus in progress (orbit mode): selected index and outer radius. */
  orbit: { i: number; R: number } | null;
  /** 0→1 while the orbit eases in; 1→0 while it eases out. */
  orbitT: number;
  /** performance.now() of the last selection change (link draw-on). */
  selAt: number;
  selKey: NodeKey | null;
  /** Something is still moving: keep requesting frames. */
  moving: boolean;
  /** Frames drawn (dev perf probe). */
  frames: number;
  /** This frame's camera: view, view-projection, tan(fov/2). */
  view: THREE.Matrix4;
  viewProj: THREE.Matrix4;
  tanHalf: number;
}

const scratch = new THREE.Vector4();
/** Scene point → [screen x, screen y, depth] (CSS px; depth ≤ 0 = behind the camera). */
export function project(m: Model, x: number, y: number, z: number, out: number[]): number[] {
  const e = m.view.elements;
  out[2] = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
  scratch.set(x, y, z, 1).applyMatrix4(m.viewProj);
  const w = scratch.w || 1e-6;
  out[0] = ((scratch.x / w + 1) / 2) * m.w;
  out[1] = ((1 - scratch.y / w) / 2) * m.h;
  return out;
}

/** Screen px per scene unit at a depth. */
export const ppuAt = (m: Model, depth: number) => m.h / (2 * Math.max(depth, 1e-3) * m.tanHalf);

export function createModel(nodes: TasteMapPayloadNode[], basis: PlaneBasis): Model {
  const n = nodes.length;
  const f3 = () => new Float32Array(n * 3);
  const f1 = () => new Float32Array(n);
  const order = nodes.map((x, i) => ({ i, m: x.mass })).sort((a, b) => b.m - a.m);
  const importance = f1();
  order.forEach(({ i }, rank) => {
    importance[i] = n > 1 ? 1 - rank / (n - 1) : 1;
  });
  const m: Model = {
    nodes,
    n,
    index: new Map(nodes.map((x, i) => [x.key, i])),
    frame: sceneFrame(basis),
    base: f3(),
    target: f3(),
    pos: f3(),
    col: f3(),
    alpha: f1(),
    show: new Uint8Array(n),
    ghost: new Uint8Array(n),
    radius: Float32Array.from(nodes, (x) => starRadius(x.mass)),
    fallback: Float32Array.from(nodes.flatMap((x) => hashDir(x.key))),
    importance,
    sx: f1(),
    sy: f1(),
    depth: f1(),
    rpx: f1(),
    front: new Uint8Array(n),
    rel: new Uint8Array(n),
    prox: f1(),
    labelA: f1(),
    labelSlot: new Int8Array(n).fill(-1),
    labelBoxes: [],
    regionBoxes: [],
    cursor: null,
    w: 1,
    h: 1,
    focusDist: 25,
    homeDist: 25,
    extent: 8,
    orbit: null,
    orbitT: 0,
    selAt: 0,
    selKey: null,
    moving: true,
    frames: 0,
    view: new THREE.Matrix4(),
    viewProj: new THREE.Matrix4(),
    tanHalf: Math.tan((50 * Math.PI) / 360),
  };
  // Start where the layout is: no fly-in on mount.
  nodes.forEach((x, i) => toScene(m.frame, x.pos, m.base, i * 3));
  m.target.set(m.base);
  m.pos.set(m.base);
  m.extent = measureExtent(m);
  return m;
}

/** Radius around the plane's center (scene origin) that holds the stars, ignoring the farthest 5%. */
export function measureExtent(m: Model): number {
  const d: number[] = [];
  for (let i = 0; i < m.n; i++) d.push(Math.hypot(m.base[i * 3], m.base[i * 3 + 1], m.base[i * 3 + 2]));
  d.sort((a, b) => a - b);
  return Math.max(2, d.length ? d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] : 2);
}

/** Lens colors (0–1 rgb) per node, index-aligned with the model. Fixed lightness: depth is spatial here. */
export function lensColors(
  nodes: TasteMapPayloadNode[],
  lens: MapLens,
  palette: PaletteHue[] | undefined,
  honesty: HonestySummary,
): Float32Array {
  const hues = hueMap(palette);
  const out = new Float32Array(nodes.length * 3);
  nodes.forEach((n, i) => {
    const rgb = lens === 'score' && n.avgScore == null ? GRAY : nodeRgb(n, lens, hues, 0.78, honesty.byKey.get(n.key)?.recall);
    out[i * 3] = rgb[0] / 255;
    out[i * 3 + 1] = rgb[1] / 255;
    out[i * 3 + 2] = rgb[2] / 255;
  });
  return out;
}

/** CSS color of a model color slot, optionally lightened toward white. */
export function cssOf(col: Float32Array, i: number, lighten = 0, alpha = 1): string {
  const c = (k: number) => Math.round((col[i * 3 + k] + (1 - col[i * 3 + k]) * lighten) * 255);
  return `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${alpha})`;
}

/** Glow material for lines: vertex RGBA, added as light (see sky.ts STAR_FRAG). */
export function glowLineMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aColor;
      varying vec4 vColor;
      void main() {
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec4 vColor;
      void main() {
        float a = vColor.a * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vColor.rgb * a, 0.0);
      }
    `,
    uniforms: { uOpacity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

/** Additive points material config shared by stars and nebulae. */
export const ADDITIVE = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
} as const;
