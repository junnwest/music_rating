'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { LocateFixed, Orbit, Pause, RotateCw } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';
import { spanningTree } from '../../../lib/tasteMap/fields';
import { fitDistance, orbitPosition, toScene, type Box } from '../../../lib/tasteMap/scene3d';
import { similarityLookup } from '../../../lib/tasteMap/similarity';
import type { NodeKey } from '../../../lib/tasteMap/types';
import type { SceneProps } from './TasteMapView';
import { useDrag3D, type ThreeHandles } from './useDrag3D';
import { Constellations, Floor, Nebulae, Stars } from './scene3d/layers';
import { createModel, lensColors, measureExtent, project, type Model } from './scene3d/model';
import { paintBack, paintFront, type PaintInput } from './scene3d/overlay';
import { approach, SKY_CSS, smooth, starPx } from './scene3d/sky';

/**
 * 3D taste map: a star chart in the same night sky as the 2D view.
 * Loaded only through `next/dynamic` from TasteMapView, so three.js ships on
 * /taste/map alone.
 *
 * Frame (lib/tasteMap/scene3d): the session's D5 plane is the floor. Seen
 * from straight above, this is the 2D "to scale" view; tilt it and every
 * star's height above or below the plane, the depth 2D folds away, shows,
 * with a drop line to its foot on a faint polar graticule.
 *
 * Layers, back to front:
 * - Back canvas (2D): sky gradient, country names as faint spaced capitals,
 *   era trails, the selection's links drawn outward, similarity shells.
 * - WebGL (transparent, every pixel added as light): nebulae (one soft cloud
 *   per star in its lens color: the sound field), the graticule and drop
 *   lines, constellation lines (kNN minimum spanning tree), stars (point
 *   sprites: white-hot core, colored body, glow; far stars dim; ghosts
 *   hollow).
 * - Front canvas (2D): rings, pin badges and level-of-detail labels.
 * - Chrome: reset view, auto-rotate, similarity orbit (on a selection).
 *
 * Interaction: stars are picked in screen space (nearest within reach, or
 * its label), so tiny stars are easy to hit. Stars near the cursor swell,
 * brighten and reveal their names. Click a star to select it and fly to it;
 * the rest dims and its neighbor links draw on. "Similarity orbit" (on a
 * selection) moves every other star along its bearing to the radius its true
 * similarity gives (payload.similarity; lib/tasteMap/focus.ts simRadius, the
 * same log scale as the 2D refocus), with labelled shells; turning it off or
 * deselecting eases everything back. Drag a star to move + pin it (not while
 * orbiting). Double-click the sky or press Esc to reset the view. The map turns
 * slowly until you touch it.
 *
 * Rendering is on demand: frames run only while something moves (damping,
 * auto-rotate, easing, a drag); all per-frame state lives in typed arrays
 * (scene3d/model.ts), no React state.
 */

// Typing note: the workspace has two @types/three copies (apps/web pins 0.170;
// a transitive `@types/three: *` hoists 0.187 to the root, which fiber/drei
// resolve). Every THREE object is mounted with <primitive>, and fiber's
// camera / gl are cast where they're read. Runtime three is one 0.170 copy.

const FOV = 50;
/** Home view: elevation above the floor plane. */
const ELEVATION = (34 * Math.PI) / 180;
const PICK_PX = 11;

interface Live {
  props: SceneProps;
  orbitActive: boolean;
  colors: Float32Array;
  simRow: Map<NodeKey, number> | null;
  paint: PaintInput;
}

interface RigApi {
  /** False when the camera isn't ready yet (the request is then kept for later). */
  flyTo: (i: number, opts?: { orbit?: boolean }) => boolean;
  reset: () => void;
}

const COPY = {
  en: {
    reset: 'Reset view (Esc)',
    rotate: 'Turn slowly',
    stopRotate: 'Stop turning',
    orbit: 'Similarity orbit',
    orbitTip: 'Arrange every other artist around this one by how alike they really are',
    hint: 'Drag to orbit · scroll to zoom · click a star',
  },
  ko: {
    reset: '처음 시점으로 (Esc)',
    rotate: '천천히 돌리기',
    stopRotate: '회전 멈추기',
    orbit: '유사도 궤도',
    orbitTip: '다른 아티스트를 이 아티스트와 실제로 얼마나 비슷한지에 따라 둘러 배치해요',
    hint: '드래그로 회전 · 스크롤로 확대 · 별을 클릭',
  },
};

function readStored(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeStored(key: string, v: boolean) {
  try {
    window.localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the preference just isn't remembered.
  }
}

export default function Scene3D(props: SceneProps) {
  const { payload, basis, lens, honesty, visible, selectedKey, focus } = props;
  const { lang } = useLanguage();
  const L = lang === 'ko' ? 'ko' : 'en';
  const copy = COPY[L];
  const root = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const three = useRef<ThreeHandles | null>(null);
  const rig = useRef<RigApi | null>(null);
  /** A fly-to asked for before the rig was ready (mode switch with a selection). */
  const pendingFly = useRef<{ i: number; orbit: boolean } | null>(null);

  const model = useMemo(() => createModel(payload.nodes, basis), [payload.nodes, basis]);
  // Re-arrange / drags move nodes in place: keep the floor's extent current once things settle.
  useEffect(() => {
    if (!props.busy) model.extent = measureExtent(model);
  }, [model, props.busy, props.layoutVersion]);

  const colors = useMemo(() => lensColors(payload.nodes, lens, payload.palette, honesty), [payload.nodes, lens, payload.palette, honesty]);
  const keep = useMemo(() => new Set(payload.nodes.filter((n) => visible.has(n.key) && !n.ghost).map((n) => n.key)), [payload.nodes, visible]);
  const edges = useMemo(() => spanningTree(payload.neighbors, keep), [payload.neighbors, keep]);
  const lookup = useMemo(() => similarityLookup(payload), [payload]);
  const hasSim = !!payload.similarity;
  const simRow = useMemo(() => (selectedKey && hasSim ? lookup.row(selectedKey) : null), [lookup, selectedKey, hasSim]);
  const neighborSim = useMemo(
    () => new Map((selectedKey ? payload.neighbors[selectedKey] ?? [] : []).map((nb) => [nb.key, nb.sim])),
    [payload.neighbors, selectedKey],
  );

  const [orbitOn, setOrbitOn] = useState(false);
  const orbitActive = orbitOn && hasSim && !!selectedKey && model.index.has(selectedKey);
  const [rotating, setRotating] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setRotating(readStored('tasteMap3d.rotate', !reduce));
  }, []);
  const [touched, setTouched] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767.98px)');
    const on = () => setIsPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Phones: the shell's bottom sheet (inspector peek / expanded, or a panel) covers this much of the stage.
  const inset = isPhone ? props.bottomInset ?? 0 : 0;
  // A tall sheet sends the chrome to the top left (under the fullscreen button); a peek just lifts it.
  const chromeTop = inset > 160;
  const insetRef = useRef(inset);
  insetRef.current = inset;

  const ghostAt = useMemo(() => {
    if (!props.ghost) return null;
    const out: [number, number, number] = [0, 0, 0];
    toScene(model.frame, props.ghost.pos, out);
    return out;
  }, [props.ghost, model]);

  const live = useRef<Live>(null as unknown as Live);
  // Stage chrome (the shell's buttons and legend, our own controls): labels keep off it.
  const reserved = useRef<Box[]>([]);
  const measureChrome = useCallback(() => {
    const el = root.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const s = stage.getBoundingClientRect();
    const out: Box[] = [];
    const add = (r: DOMRect) => {
      if (r.width > 0 && r.height > 0 && r.width < s.width * 0.9) out.push({ x: r.left - s.left - 4, y: r.top - s.top - 4, w: r.width + 8, h: r.height + 8 });
    };
    for (const child of Array.from(stage.children)) if (child !== el) add(child.getBoundingClientRect());
    // The phone sheet spans the full width (so `add` skips it): reserve the strip it covers.
    if (insetRef.current > 0) out.push({ x: 0, y: s.height - insetRef.current - 4, w: s.width, h: insetRef.current + 4 });
    if (chromeRef.current) for (const c of Array.from(chromeRef.current.children)) add(c.getBoundingClientRect());
    reserved.current = out;
    if (live.current) live.current.paint.reserved = out;
    three.current?.invalidate();
  }, []);
  useEffect(() => {
    const id = window.setInterval(measureChrome, 700);
    return () => window.clearInterval(id);
  }, [measureChrome]);

  live.current = {
    props,
    orbitActive,
    colors,
    simRow,
    paint: {
      payload,
      atlas: props.atlas,
      hiddenGroups: props.hiddenGroups,
      selectedKey,
      hoveredKey: props.hoveredKey,
      ghost: props.ghost,
      ghostAt,
      pins: props.pins,
      font: props.theme.font,
      lang: L,
      reserved: reserved.current,
      neighborSim,
    },
  };
  // The chrome moves with the selection / orbit / hint: re-measure once it has laid out.
  useEffect(() => {
    const id = window.requestAnimationFrame(measureChrome);
    return () => window.cancelAnimationFrame(id);
  }, [measureChrome, selectedKey, isPhone, inset, orbitOn, touched, props.ghost]);
  const kick = () => three.current?.invalidate();
  // Any prop change may start an animation (selection, lens, visibility).
  useEffect(kick);

  // Shell focus requests (inspector clicks, mode switch) fly to the node.
  const focusNonce = focus?.nonce;
  useEffect(() => {
    if (!focus) return;
    const i = model.index.get(focus.key);
    if (i != null && !rig.current?.flyTo(i, { orbit: orbitActive })) pendingFly.current = { i, orbit: orbitActive };
    // Keyed on the nonce: the same node can be re-focused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Orbit on / off: frame the selection's neighborhood.
  useEffect(() => {
    if (!selectedKey) return;
    const i = model.index.get(selectedKey);
    if (i != null && orbitActive) rig.current?.flyTo(i, { orbit: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orbitActive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') rig.current?.reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dev only: lets the screenshot harness find stars on screen.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as { __tasteMap3D?: unknown };
    w.__tasteMap3D = {
      heaviest: () => model.nodes.reduce((a, b) => (b.mass > a.mass ? b : a)).key,
      keys: () => model.nodes.map((n) => n.key),
      frames: () => model.frames,
      screenOf: (key: NodeKey) => {
        const i = model.index.get(key);
        return i == null ? null : { x: model.sx[i], y: model.sy[i], front: !!model.front[i] };
      },
    };
    return () => {
      delete w.__tasteMap3D;
    };
  }, [model]);

  const drag = useDrag3D({ three, frame: model.frame, enabled: props.editable && !orbitActive, onDragNode: props.onDragNode });

  // ── Screen-space picking ──
  const pickAt = (x: number, y: number): number => {
    const m = model;
    const b = m.labelBoxes;
    for (let k = 0; k + 4 < b.length; k += 5) {
      if (x >= b[k] && x <= b[k] + b[k + 2] && y >= b[k + 1] && y <= b[k + 1] + b[k + 3]) return b[k + 4];
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < m.n; i++) {
      if (!m.show[i] || !m.front[i] || m.alpha[i] < 0.15) continue;
      const d = Math.hypot(m.sx[i] - x, m.sy[i] - y);
      const reach = Math.max(PICK_PX, m.rpx[i] + 6);
      if (d > reach) continue;
      // Nearer the pointer wins; ties go to the star nearer the camera.
      const score = d / reach + m.depth[i] * 1e-4;
      if (score < bestD) {
        bestD = score;
        best = i;
      }
    }
    return best;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = useRef<{ x: number; y: number; i: number; dragging: boolean } | null>(null);
  const hoverKey = useRef<NodeKey | null>(props.hoveredKey);
  hoverKey.current = props.hoveredKey;
  const setHover = (i: number) => {
    const k = i >= 0 ? model.nodes[i].key : null;
    if (k !== hoverKey.current) {
      hoverKey.current = k;
      props.onHover(k);
    }
  };
  const interacted = () => {
    if (!touched) setTouched(true);
  };

  const cursor = props.hoveredKey ? 'pointer' : 'grab';
  return (
    <div
      ref={root}
      className="absolute inset-0 select-none overflow-hidden"
      style={{ cursor, touchAction: 'none', background: SKY_CSS }}
      onPointerMove={(e) => {
        const p = local(e);
        model.cursor = e.pointerType === 'mouse' ? p : null;
        if (!drag.dragging.current && e.pointerType === 'mouse') setHover(pickAt(p.x, p.y));
        kick();
      }}
      onPointerLeave={() => {
        model.cursor = null;
        if (!drag.dragging.current) setHover(-1);
        kick();
      }}
      onPointerDownCapture={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const p = local(e);
        const i = pickAt(p.x, p.y);
        down.current = { x: e.clientX, y: e.clientY, i, dragging: false };
        interacted();
        if (i >= 0) {
          const w = new THREE.Vector3(model.pos[i * 3], model.pos[i * 3 + 1], model.pos[i * 3 + 2]);
          if (drag.begin(model.nodes[i].key, w, e)) {
            down.current.dragging = true;
            e.stopPropagation();
          }
        }
      }}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (!d || (e.target as HTMLElement).closest('button')) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
        if (d.i >= 0) {
          props.onSelect(model.nodes[d.i].key);
          rig.current?.flyTo(d.i, { orbit: orbitOn && hasSim });
        } else props.onSelect(null);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const p = local(e);
        if (pickAt(p.x, p.y) < 0) rig.current?.reset();
      }}
    >
      <canvas ref={backRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <Canvas
        className="!absolute inset-0"
        frameloop="demand"
        camera={{ position: [0, 8, 24], fov: FOV, near: 0.1, far: 2000 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: true }}
        onCreated={({ gl }) => (gl as unknown as THREE.WebGLRenderer).setClearColor(0x000000, 0)}
      >
        <ThreeBridge three={three} />
        <Director m={model} live={live} />
        <Nebulae m={model} />
        <Floor m={model} />
        <Constellations m={model} edges={edges} />
        <Stars m={model} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.075}
          rotateSpeed={0.55}
          zoomSpeed={0.9}
          zoomToCursor
          enablePan
          screenSpacePanning
          minDistance={1.5}
          maxDistance={400}
          autoRotate={rotating && !selectedKey && !props.hoveredKey}
          autoRotateSpeed={0.45}
        />
        <Rig m={model} live={live} api={rig} pending={pendingFly} lift={inset * 0.45} onTouched={() => { interacted(); }} onUserMove={() => { if (rotating) setRotating(false); }} />
        <Painter m={model} live={live} back={backRef} front={frontRef} />
      </Canvas>
      <canvas ref={frontRef} role="img" aria-label="Taste map (3D)" className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Chrome: bottom left, above a phone's peeking sheet (top left while a tall one is up). */}
      <div
        ref={chromeRef}
        className={`pointer-events-none absolute left-2.5 flex items-center gap-1.5 ${chromeTop ? 'top-[52px]' : 'bottom-2.5'}`}
        style={!chromeTop && inset > 0 ? { bottom: inset + 10 } : undefined}
      >
        <button
          type="button"
          onClick={() => rig.current?.reset()}
          aria-label={copy.reset}
          title={copy.reset}
          className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-divider bg-surface/85 text-ink backdrop-blur transition hover:bg-surface"
        >
          <LocateFixed size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !rotating;
            setRotating(next);
            writeStored('tasteMap3d.rotate', next);
          }}
          aria-pressed={rotating}
          aria-label={rotating ? copy.stopRotate : copy.rotate}
          title={rotating ? copy.stopRotate : copy.rotate}
          className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-divider bg-surface/85 text-ink backdrop-blur transition hover:bg-surface"
        >
          {rotating ? <Pause size={13} /> : <RotateCw size={13} />}
        </button>
        {selectedKey && hasSim && (
          <button
            type="button"
            aria-pressed={orbitOn}
            title={copy.orbitTip}
            onClick={() => setOrbitOn((v) => !v)}
            className={`pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold backdrop-blur transition ${
              orbitOn ? 'border-ink bg-ink text-page' : 'border-divider bg-surface/85 text-ink hover:bg-surface'
            }`}
          >
            <Orbit size={13} />
            {copy.orbit}
          </button>
        )}
        {!touched && !selectedKey && !isPhone && (
          <span className="pl-1 text-[11px] font-medium tracking-wide text-[rgb(140,148,168)] transition-opacity">{copy.hint}</span>
        )}
      </div>
    </div>
  );
}

// ── Inside the Canvas ────────────────────────────────────────────────────────

/** Hands the camera / controls / invalidate to code outside the Canvas (picking, drag). */
function ThreeBridge({ three }: { three: MutableRefObject<ThreeHandles | null> }) {
  const camera = useThree((s) => s.camera) as unknown as THREE.Camera;
  const gl = useThree((s) => s.gl) as unknown as { domElement: HTMLElement };
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    three.current = { camera, dom: gl.domElement, controls, invalidate: () => invalidate() };
  }, [camera, gl, controls, invalidate, three]);
  return null;
}

/**
 * Once per frame, before the layers: positions (layout, orbit refocus,
 * easing), colors, alphas, relations, screen projections and cursor
 * proximity into the model.
 */
function Director({ m, live }: { m: Model; live: MutableRefObject<Live> }) {
  const first = useRef(true);
  useFrame((state, dt) => {
    const cam = state.camera as unknown as THREE.PerspectiveCamera;
    const controls = state.controls as unknown as OrbitControlsImpl | null;
    const { props: p, orbitActive, colors, simRow } = live.current;
    m.w = state.size.width;
    m.h = state.size.height;
    cam.updateMatrixWorld();
    m.view.copy(cam.matrixWorldInverse);
    m.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    m.tanHalf = Math.tan(((cam.fov ?? FOV) * Math.PI) / 360);
    if (controls) m.focusDist = cam.position.distanceTo(controls.target);
    m.moving = false;

    const sel = p.selectedKey != null ? m.index.get(p.selectedKey) ?? -1 : -1;
    const hov = p.hoveredKey != null ? m.index.get(p.hoveredKey) ?? -1 : -1;
    if (p.selectedKey !== m.selKey) {
      m.selKey = p.selectedKey;
      m.selAt = performance.now();
    }
    for (let i = 0; i < m.n; i++) {
      const n = m.nodes[i];
      m.ghost[i] = n.ghost ? 1 : 0;
      m.show[i] = p.visible.has(n.key) && !n.ghost?.hidden ? 1 : 0;
      m.rel[i] = 0;
      toScene(m.frame, n.pos, m.base, i * 3);
    }
    if (sel >= 0) for (const nb of p.payload.neighbors[p.selectedKey!] ?? []) {
      const j = m.index.get(nb.key);
      if (j != null) m.rel[j] = 1;
    }
    if (sel >= 0) m.rel[sel] = 2;
    if (hov >= 0) m.rel[hov] = 2;

    // Orbit refocus.
    const wantOrbit = orbitActive && sel >= 0 && !!simRow;
    if (wantOrbit) m.orbit = { i: sel, R: m.extent * 0.95 };
    const ot = wantOrbit ? 1 : 0;
    m.orbitT += (ot - m.orbitT) * approach(dt, 3.2);
    if (Math.abs(ot - m.orbitT) < 0.002) m.orbitT = ot;
    else m.moving = true;
    if (m.orbitT === 0 && !wantOrbit) m.orbit = null;

    const sx = m.base[sel * 3];
    const sy = m.base[sel * 3 + 1];
    const sz = m.base[sel * 3 + 2];
    const minR = m.extent * 0.05;
    for (let i = 0; i < m.n; i++) {
      const o = i * 3;
      if (wantOrbit && i !== sel) {
        const t = orbitPosition(
          [sx, sy, sz],
          [m.base[o], m.base[o + 1], m.base[o + 2]],
          simRow!.get(m.nodes[i].key) ?? 0,
          m.orbit!.R,
          minR,
          [m.fallback[o], m.fallback[o + 1], m.fallback[o + 2]],
        );
        m.target[o] = t[0];
        m.target[o + 1] = t[1];
        m.target[o + 2] = t[2];
      } else {
        m.target[o] = m.base[o];
        m.target[o + 1] = m.base[o + 1];
        m.target[o + 2] = m.base[o + 2];
      }
    }

    // Ease positions (snap during drags / re-arrange, which animate themselves), colors, alphas.
    const kPos = first.current || p.busy ? 1 : approach(dt, 4.2);
    const kCol = first.current ? 1 : approach(dt, 6);
    const kA = first.current ? 1 : approach(dt, 7);
    let maxMove = 0;
    for (let k = 0; k < m.n * 3; k++) {
      const d = m.target[k] - m.pos[k];
      m.pos[k] += d * kPos;
      maxMove = Math.max(maxMove, Math.abs(d));
      const c = colors[k] - m.col[k];
      m.col[k] += c * kCol;
      if (Math.abs(c) > 0.003) m.moving = true;
    }
    if (maxMove > 0.004) m.moving = true;
    for (let i = 0; i < m.n; i++) {
      const goal = m.show[i] ? (sel >= 0 && m.rel[i] === 0 ? 0.26 : 1) * (m.ghost[i] ? 0.6 : 1) : 0;
      const d = goal - m.alpha[i];
      m.alpha[i] += d * kA;
      if (Math.abs(d) > 0.004) m.moving = true;
    }

    // Project; cursor proximity.
    const cur = m.cursor;
    const kP = approach(dt, 10);
    const pt = [0, 0, 0];
    for (let i = 0; i < m.n; i++) {
      project(m, m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2], pt);
      m.sx[i] = pt[0];
      m.sy[i] = pt[1];
      m.depth[i] = pt[2];
      m.front[i] = pt[2] > 0.2 ? 1 : 0;
      let goal = 0;
      if (cur && m.show[i] && m.front[i]) goal = smooth(1 - Math.hypot(pt[0] - cur.x, pt[1] - cur.y) / 100) * (sel >= 0 && !m.rel[i] ? 0.6 : 1);
      if (m.rel[i] === 2) goal = Math.max(goal, 0.8);
      const d = goal - m.prox[i];
      m.prox[i] += d * kP;
      if (Math.abs(d) > 0.004) m.moving = true;
      m.rpx[i] = starPx(m.radius[i], m.h / (2 * Math.max(pt[2], 1e-3) * m.tanHalf), m.prox[i]);
    }
    first.current = false;
  }, -0.5);
  return null;
}

/**
 * Camera: home framing (the map fitted to the stage from 34° above the
 * floor), fly-to on select, reset. User input cancels a flight and stops the
 * idle turn.
 */
function Rig({
  m,
  live,
  api,
  pending,
  lift,
  onTouched,
  onUserMove,
}: {
  m: Model;
  live: MutableRefObject<Live>;
  api: MutableRefObject<RigApi | null>;
  pending: MutableRefObject<{ i: number; orbit: boolean } | null>;
  /** Px to shift the picture up (phones: centered in what the bottom sheet leaves visible). */
  lift: number;
  onTouched: () => void;
  onUserMove: () => void;
}) {
  const camera = useThree((s) => s.camera) as unknown as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<{ target: THREE.Vector3; cam: THREE.Vector3 } | null>(null);
  const pristine = useRef(true);
  const cb = useRef({ onTouched, onUserMove });
  cb.current = { onTouched, onUserMove };

  const home = useCallback(() => {
    const visible = live.current.props.visible;
    const mask = Uint8Array.from(m.nodes, (n) => (visible.has(n.key) && !n.ghost?.hidden ? 1 : 0));
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.n; i++) {
      if (!mask[i]) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], m.base[i * 3 + k]);
        hi[k] = Math.max(hi[k], m.base[i * 3 + k]);
      }
    }
    if (!Number.isFinite(lo[0])) {
      lo = [-1, -1, -1];
      hi = [1, 1, 1];
    }
    const center: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const back: [number, number, number] = [0, Math.sin(ELEVATION), Math.cos(ELEVATION)];
    const aspect = size.width / Math.max(1, size.height);
    // Room for the stage chrome: the map fills ~78% of the shorter half-axis.
    const D = Math.max(5, fitDistance(m.base, center, back, [0, 1, 0], camera.fov ?? FOV, aspect, 0.78, mask)) * 1.04;
    m.homeDist = D;
    const t = new THREE.Vector3(...center);
    return { target: t, cam: t.clone().add(new THREE.Vector3(...back).multiplyScalar(D)) };
  }, [m, size.width, size.height, camera, live]);

  // First framing (and re-framing on resize until the user moves the view).
  useEffect(() => {
    if (!controls || !pristine.current) return;
    const h = home();
    controls.target.copy(h.target);
    camera.position.copy(h.cam);
    controls.update();
    invalidate();
  }, [controls, camera, home, invalidate]);

  useEffect(() => {
    if (!controls) return;
    const start = () => {
      anim.current = null;
      pristine.current = false;
      cb.current.onTouched();
      cb.current.onUserMove();
    };
    controls.addEventListener('start', start);
    return () => controls.removeEventListener('start', start);
  }, [controls]);

  useEffect(() => {
    api.current = {
      flyTo: (i, opts) => {
        if (!controls) return false;
        pristine.current = false;
        const target = new THREE.Vector3(m.target[i * 3], m.target[i * 3 + 1], m.target[i * 3 + 2]);
        const offset = camera.position.clone().sub(controls.target);
        let dist: number;
        if (opts?.orbit) {
          const aspect = size.width / Math.max(1, size.height);
          // The 0.1 shell (simRadius ≈ 0.58 R) near the edge; the far rim may run off-stage.
          dist = (m.extent * 0.95 * 0.66) / (m.tanHalf * Math.min(1, aspect));
        } else {
          // Frame the star's neighborhood (itself + its kNN), so a dense
          // cluster opens up and a loner doesn't zoom into empty sky.
          const p = live.current.props;
          const key = m.nodes[i].key;
          const pts = [m.target[i * 3], m.target[i * 3 + 1], m.target[i * 3 + 2]];
          for (const nb of p.payload.neighbors[key] ?? []) {
            const j = m.index.get(nb.key);
            if (j == null || !m.show[j]) continue;
            pts.push(m.target[j * 3], m.target[j * 3 + 1], m.target[j * 3 + 2]);
          }
          const back = offset.clone().normalize();
          const aspect = size.width / Math.max(1, size.height);
          const fit = fitDistance(pts, [target.x, target.y, target.z], [back.x, back.y, back.z], [0, 1, 0], camera.fov ?? FOV, aspect, 0.62);
          dist = Math.min(m.homeDist * 0.85, Math.max(3.5, fit));
        }
        offset.setLength(dist);
        anim.current = { target, cam: target.clone().add(offset) };
        invalidate();
        return true;
      },
      reset: () => {
        if (!controls) return;
        anim.current = home();
        invalidate();
      },
    };
    const want = pending.current;
    if (want && controls) {
      pending.current = null;
      api.current.flyTo(want.i, { orbit: want.orbit });
    }
  }, [api, pending, controls, camera, m, home, invalidate, size.width, size.height, live]);

  // Lift: a view offset moves the picture without moving the camera, so
  // orbiting still turns around the selected star.
  const liftNow = useRef(0);
  useEffect(() => invalidate(), [lift, invalidate]);
  useFrame((state, dt) => {
    const goal = lift;
    const cur = liftNow.current;
    if (Math.abs(goal - cur) > 0.5 || (goal !== 0 && !camera.view?.enabled)) {
      liftNow.current = Math.abs(goal - cur) > 0.5 ? cur + (goal - cur) * approach(dt, 6) : goal;
      m.moving = true;
    }
    if (Math.abs(liftNow.current) > 0.5) {
      const { width: w, height: h } = state.size;
      camera.setViewOffset(w, h, 0, liftNow.current, w, h);
    } else if (camera.view?.enabled) camera.clearViewOffset();
  }, -3);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    const t = approach(dt, 4.5);
    controls.target.lerp(a.target, t);
    camera.position.lerp(a.cam, t);
    controls.update();
    m.moving = true;
    if (camera.position.distanceToSquared(a.cam) < 1e-4 && controls.target.distanceToSquared(a.target) < 1e-4) anim.current = null;
  }, -2);
  return null;
}

/** Draws the back and front 2D canvases after the Director, then keeps frames coming while anything moves. */
function Painter({
  m,
  live,
  back,
  front,
}: {
  m: Model;
  live: MutableRefObject<Live>;
  back: MutableRefObject<HTMLCanvasElement | null>;
  front: MutableRefObject<HTMLCanvasElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame((state, dt) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = state.size.width;
    const H = state.size.height;
    const now = performance.now();
    for (const [ref, paint] of [
      [back, (ctx: CanvasRenderingContext2D) => paintBack(ctx, m, live.current.paint, now)],
      [front, (ctx: CanvasRenderingContext2D) => paintFront(ctx, m, live.current.paint, dt)],
    ] as const) {
      const c = ref.current;
      if (!c) continue;
      const pw = Math.round(W * dpr);
      const ph = Math.round(H * dpr);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(ctx);
    }
    m.frames++;
    if (m.moving) invalidate();
  });
  return null;
}
