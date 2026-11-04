'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { spectrumColor } from '../../../lib/sj/display';
import type { NodeKey, TasteMapPayloadNode, Vec3 } from '../../../lib/tasteMap/types';
import type { SceneProps } from './TasteMapView';
import { useDrag3D } from './useDrag3D';
import { createGroupLayoutScratch, ensureBoxes, hitsAny, labelBoard, layoutGroupLabels } from './labelLayout';

/**
 * 3D taste map (react-three-fiber). Loaded only through `next/dynamic` from
 * TasteMapView, so three.js ships on /taste/map alone.
 *
 * - Nodes: one instanced sphere mesh, radius by mass, colored by avg score on
 *   the app's ramp (spectrumColor). Raycast hover/select via instanceId.
 * - Labels: camera-facing sprites with canvas-drawn text in the app font (see
 *   makeLabel for why not drei <Text>), sized by mass. Semantic zoom: each
 *   label has a reach distance by its mass rank and fades with camera
 *   distance; selection/hover/neighbors always show. Opacities are written
 *   straight to the materials inside useFrame — no React state, no per-frame
 *   allocation.
 * - Group nebulae: one soft radial sprite per (member, group), tinted by the
 *   group color, opacity by membership weight. Additive in dark mode; normal
 *   blending in light mode (additive on a light background washes to white).
 *   They thin out as the camera gets close so they never fog the labels.
 * - Far zoom: one label per group above its members.
 * - Trails: dashed lines through an artist's era nodes, chronological.
 * - Camera: damped OrbitControls plus a small rig that eases target + position
 *   to a focused node; any user drag cancels the ease.
 * - Add-artist ghost (Phase 4, preview only): a translucent sphere with a
 *   dashed camera-facing ring, a "preview" label and dashed lines to its anchors.
 */

const SCALE = 10;

// Typing note: the workspace has two @types/three copies (apps/web pins 0.170;
// a transitive `@types/three: *` hoists 0.187 to the root, which fiber/drei
// resolve). Where a THREE object crosses into a fiber prop, refs take `unknown`
// and the one texture prop is cast — runtime three is a single 0.170 copy.

const v3 = (p: Vec3): [number, number, number] => [p[0] * SCALE, p[1] * SCALE, p[2] * SCALE];
const radiusOf = (mass: number) => 0.12 + 0.07 * Math.sqrt(Math.max(mass, 0));
const fontOf = (mass: number) => 0.3 + 0.1 * Math.sqrt(Math.max(mass, 0));

function useGlowTexture(): THREE.Texture {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

export default function Scene3D(props: SceneProps) {
  const { theme, focus } = props;
  const down = useRef<{ x: number; y: number } | null>(null);

  // Effective focus: the shell's requests plus clicks inside the scene.
  const nonce = useRef(0);
  const [rigFocus, setRigFocus] = useState<{ key: NodeKey; nonce: number } | null>(() =>
    focus ? { key: focus.key, nonce: ++nonce.current } : null,
  );
  const focusNonce = focus?.nonce;
  useEffect(() => {
    if (focus) setRigFocus({ key: focus.key, nonce: ++nonce.current });
    // Re-run only when the shell bumps the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const pick = (key: NodeKey) => {
    props.onSelect(key);
    setRigFocus({ key, nonce: ++nonce.current });
  };

  return (
    <div
      className="absolute inset-0 select-none"
      style={{ cursor: props.hoveredKey ? 'pointer' : 'grab' }}
      onPointerDownCapture={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 26], fov: 50, near: 0.1, far: 400 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
          props.onSelect(null);
        }}
      >
        <color key={theme.bg} attach="background" args={[theme.bg]} />
        <ambientLight intensity={theme.dark ? 0.9 : 1.1} />
        <directionalLight position={[6, 10, 8]} intensity={theme.dark ? 1.2 : 1.4} />
        <Nebulae {...props} />
        <Trails {...props} />
        <NeighborLinks {...props} />
        <Nodes {...props} onPick={pick} />
        <PinMarkers {...props} />
        <Labels {...props} onPick={pick} />
        <GroupLabels {...props} />
        <Ghost {...props} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={70} />
        <CameraRig {...props} rigFocus={rigFocus} />
      </Canvas>
    </div>
  );
}

// ── Camera ───────────────────────────────────────────────────────────────────

function CameraRig({
  payload,
  ghost,
  rigFocus,
}: SceneProps & { rigFocus: { key: NodeKey; nonce: number } | null }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const anim = useRef<{ target: THREE.Vector3; cam: THREE.Vector3 } | null>(null);
  const fitted = useRef(false);

  // Portrait stages need the camera further back to keep the whole map in view.
  useEffect(() => {
    if (fitted.current || !controls) return;
    fitted.current = true;
    if (aspect < 1 && !rigFocus) {
      camera.position.setLength(26 / Math.max(aspect, 0.45) ** 0.85);
      controls.update();
    }
  }, [aspect, camera, controls, rigFocus]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      anim.current = null;
    };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);

  const rigNonce = rigFocus?.nonce;
  useEffect(() => {
    if (!rigFocus || !controls) return;
    const n = payload.nodes.find((m) => m.key === rigFocus.key) ?? (ghost?.key === rigFocus.key ? ghost : null);
    if (!n) return;
    const target = new THREE.Vector3(...v3(n.pos));
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.min(Math.max(offset.length(), 6), 11));
    anim.current = { target, cam: target.clone().add(offset) };
    // Keyed on the nonce: the same node can be re-focused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rigNonce, controls]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    const t = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    controls.target.lerp(a.target, t);
    camera.position.lerp(a.cam, t);
    controls.update();
    if (camera.position.distanceToSquared(a.cam) < 1e-4 && controls.target.distanceToSquared(a.target) < 1e-4) {
      anim.current = null;
    }
  });
  return null;
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/** The selection, its neighbors and the hovered node — always fully shown. */
function useRelated({ payload, selectedKey, hoveredKey }: SceneProps): Set<NodeKey> {
  const neighbors = payload.neighbors;
  return useMemo(() => {
    const s = new Set<NodeKey>();
    if (selectedKey) {
      s.add(selectedKey);
      for (const nb of neighbors[selectedKey] ?? []) s.add(nb.key);
    }
    if (hoveredKey) s.add(hoveredKey);
    return s;
  }, [neighbors, selectedKey, hoveredKey]);
}

function Nodes(props: SceneProps & { onPick: (k: NodeKey) => void }) {
  const { payload, visible, selectedKey, hoveredKey, theme, onHover, onPick, layoutVersion, editable, onDragNode } = props;
  const nodes = payload.nodes;
  const mesh = useRef<THREE.InstancedMesh | null>(null);
  const related = useRelated(props);
  const drag = useDrag3D({ scale: SCALE, enabled: editable, onDragNode });

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const obj = new THREE.Object3D();
    const color = new THREE.Color();
    const bg = new THREE.Color(theme.bg);
    const L = theme.dark ? 0.72 : 0.62;
    nodes.forEach((n, i) => {
      const shown = visible.has(n.key);
      const r = radiusOf(n.mass) * (n.key === selectedKey ? 1.45 : n.key === hoveredKey ? 1.25 : 1);
      obj.position.set(...v3(n.pos));
      obj.scale.setScalar(shown ? r : 0);
      obj.updateMatrix();
      m.setMatrixAt(i, obj.matrix);
      color.set(n.avgScore != null ? spectrumColor(n.avgScore, L, 1) : theme.muted);
      if (selectedKey && !related.has(n.key)) color.lerp(bg, 0.6);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    // layoutVersion: node positions change in place (drag, re-arrange).
  }, [nodes, visible, selectedKey, hoveredKey, related, theme, layoutVersion]);

  const keyAt = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.instanceId != null ? nodes[e.instanceId]?.key ?? null : null;

  return (
    <instancedMesh
      ref={(el: unknown) => {
        mesh.current = el as THREE.InstancedMesh | null;
      }}
      args={[undefined, undefined, nodes.length]}
      onPointerMove={(e) => {
        e.stopPropagation();
        const k = keyAt(e);
        if (k && visible.has(k) && k !== hoveredKey) onHover(k);
      }}
      onPointerOut={() => onHover(null)}
      onPointerDown={(e) => {
        // Grab the nearest hit node; OrbitControls stays off until the drag ends.
        const k = keyAt(e);
        const n = e.instanceId != null ? nodes[e.instanceId] : null;
        if (!k || !n || !visible.has(k)) return;
        if (drag.begin(k, new THREE.Vector3(...v3(n.pos)), e)) e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 5) return;
        const k = keyAt(e);
        if (k && visible.has(k)) onPick(k);
      }}
    >
      <sphereGeometry args={[1, 24, 16]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} />
    </instancedMesh>
  );
}

/** Push-pin badge on pinned nodes, facing the camera: filled = full pin, hollow ring = pinned in 2D (depth free). */
function PinMarkers({ payload, pins, visible, theme, layoutVersion }: SceneProps) {
  const marks = useMemo(
    () =>
      payload.nodes
        .filter((n) => pins.has(n.key) && visible.has(n.key))
        .map((n) => ({ key: n.key, pos: v3(n.pos), r: radiusOf(n.mass), soft: pins.get(n.key)!.softZ })),
    // layoutVersion: positions change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload.nodes, pins, visible, layoutVersion],
  );
  return (
    <>
      {marks.map((m) => {
        const head = Math.max(0.09, m.r * 0.42);
        return (
          <Billboard key={m.key} position={m.pos}>
            {/* Offset up-right and toward the camera so the sphere never hides it. */}
            <group position={[m.r * 0.85, m.r * 0.85, m.r * 1.1]} renderOrder={4}>
              <mesh raycast={() => null}>
                <circleGeometry args={[head * 1.35, 24]} />
                <meshBasicMaterial color={theme.bg} depthWrite={false} />
              </mesh>
              <mesh raycast={() => null} position={[0, 0, 0.001]}>
                {m.soft ? <ringGeometry args={[head * 0.55, head, 24]} /> : <circleGeometry args={[head, 24]} />}
                <meshBasicMaterial color={theme.ink} depthWrite={false} />
              </mesh>
            </group>
          </Billboard>
        );
      })}
    </>
  );
}

// ── Labels (semantic zoom) ───────────────────────────────────────────────────

/**
 * Label textures are drawn on a 2D canvas with the app's own font stack, not
 * troika/drei <Text>: troika fetches its font + unicode data from jsdelivr and
 * spins up a blob: worker, and the app's CSP (next.config.mjs connect-src /
 * script-src) blocks both — <Text> then suspends forever. System fonts also
 * cover Hangul/Japanese for free.
 */
interface LabelTex {
  tex: THREE.CanvasTexture;
  /** World-space width/height for a given font size (height of one line = fontSize). */
  w: number;
  h: number;
}

const LABEL_PX = 48;

function makeLabel(lines: string[], color: string, outline: string, font: string, weight: number, fontSize: number): LabelTex {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const f = `${weight} ${LABEL_PX}px ${font}`;
  g.font = f;
  const sub = `${Math.round(weight * 0.8)} ${Math.round(LABEL_PX * 0.72)}px ${font}`;
  const widths = lines.map((l, i) => {
    g.font = i === 0 ? f : sub;
    return g.measureText(l).width;
  });
  const pad = LABEL_PX * 0.25;
  const lineH = LABEL_PX * 1.18;
  c.width = Math.ceil(Math.max(...widths) + pad * 2);
  c.height = Math.ceil(lineH * lines.length + pad);
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  lines.forEach((l, i) => {
    g.font = i === 0 ? f : sub;
    const y = pad / 2 + i * lineH;
    g.lineWidth = LABEL_PX * 0.16;
    g.strokeStyle = outline;
    g.strokeText(l, c.width / 2, y);
    g.fillStyle = color;
    g.fillText(l, c.width / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const k = fontSize / lineH;
  return { tex, w: c.width * k, h: c.height * k };
}

function useLabelTextures(
  items: { id: string; lines: string[]; color: string; fontSize: number; weight: number }[],
  theme: SceneProps['theme'],
): LabelTex[] {
  const texs = useMemo(
    () => items.map((it) => makeLabel(it.lines, it.color, theme.bg, theme.font, it.weight, it.fontSize)),
    [items, theme.bg, theme.font],
  );
  useEffect(() => () => texs.forEach((t) => t.tex.dispose()), [texs]);
  return texs;
}

function Labels(props: SceneProps & { onPick: (k: NodeKey) => void }) {
  const { payload, visible, theme, selectedKey, hoveredKey, onHover, onPick, layoutVersion } = props;
  const nodes = payload.nodes;
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const related = useRelated(props);

  const items = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.key,
        lines: n.eraLabel ? [n.label, n.eraLabel] : [n.label],
        color: theme.ink,
        fontSize: fontOf(n.mass),
        weight: 650,
      })),
    [nodes, theme.ink],
  );
  const texs = useLabelTextures(items, theme);

  // Reach: how far the camera can be before a label fades; bigger nodes carry further.
  const reach = useMemo(() => {
    const order = nodes.map((n, i) => ({ i, m: n.mass })).sort((a, b) => b.m - a.m);
    const r = new Float32Array(nodes.length);
    const denom = Math.max(1, order.length - 1);
    order.forEach(({ i }, rank) => {
      r[i] = 9 + 30 * Math.pow(1 - rank / denom, 1.4);
    });
    return r;
  }, [nodes]);
  // layoutVersion: positions change in place (drag, re-arrange).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const worldPos = useMemo(() => nodes.map((n) => new THREE.Vector3(...v3(n.pos))), [nodes, layoutVersion]);

  // Screen-space declutter: every few frames, a greedy pass by priority hides
  // labels whose screen box overlaps one already kept. Priority: related labels
  // (selection, hover, neighbors — pinned, never hidden), then the group labels
  // GroupLabels has placed (read off the shared board), then the rest by mass.
  // Pinned boxes go back on the board so group labels steer around them.
  // Alphas ease toward their targets, so a label hidden by the pass fades out.
  const scene = useThree((s) => s.scene);
  const board = labelBoard(scene);
  const massOrder = useMemo(
    () => nodes.map((n, i) => ({ i, m: n.mass })).sort((a, b) => b.m - a.m).map((x) => x.i),
    [nodes],
  );
  const scratch = useMemo(
    () => ({
      v: new THREE.Vector3(),
      boxes: new Float32Array(nodes.length * 4),
      blocked: new Uint8Array(nodes.length),
      alpha: new Float32Array(nodes.length),
      frame: 0,
    }),
    [nodes.length],
  );

  useFrame(({ camera, size }, dt) => {
    const st = scratch;
    const fade = 1 - Math.exp(-Math.min(dt, 0.1) * 10);
    const target = (i: number, d: number) => {
      const n = nodes[i];
      if (!visible.has(n.key)) return 0;
      if (related.has(n.key)) return 1;
      const a = Math.min(1, Math.max(0, (reach[i] - d) / 5));
      return selectedKey ? a * 0.4 : a;
    };

    if (st.frame++ % 6 === 0) {
      const persp = camera as unknown as THREE.PerspectiveCamera;
      const tanHalf = Math.tan(((persp.fov ?? 50) * Math.PI) / 360);
      let kept = 0;
      const place = (i: number) => {
        const s = sprites.current[i];
        st.blocked[i] = 1;
        if (!s) return;
        const d = camera.position.distanceTo(s.position);
        if (target(i, d) <= 0.02) return;
        st.v.copy(s.position).project(persp);
        if (st.v.z > 1) return;
        const ppu = size.height / (2 * d * tanHalf);
        const w = s.scale.x * ppu;
        const h = s.scale.y * ppu;
        const x = ((st.v.x + 1) / 2) * size.width - w / 2;
        const y = ((1 - st.v.y) / 2) * size.height - h;
        const forced = related.has(nodes[i].key);
        if (!forced && (hitsAny(st.boxes, kept, x, y, w, h) || hitsAny(board.groupBoxes, board.groupCount, x, y, w, h, 2))) return;
        const o = kept * 4;
        st.boxes[o] = x;
        st.boxes[o + 1] = y;
        st.boxes[o + 2] = w;
        st.boxes[o + 3] = h;
        kept += 1;
        st.blocked[i] = 0;
      };
      for (const i of massOrder) if (related.has(nodes[i].key)) place(i);
      board.pinnedBoxes = ensureBoxes(board.pinnedBoxes, kept);
      board.pinnedBoxes.set(st.boxes.subarray(0, kept * 4));
      board.pinnedCount = kept;
      for (const i of massOrder) if (!related.has(nodes[i].key)) place(i);
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const s = sprites.current[i];
      if (!s) continue;
      const goal = st.blocked[i] ? 0 : target(i, camera.position.distanceTo(worldPos[i]));
      st.alpha[i] += (goal - st.alpha[i]) * fade;
      if (related.has(nodes[i].key)) st.alpha[i] = goal;
      s.visible = st.alpha[i] > 0.02;
      (s.material as THREE.SpriteMaterial).opacity = st.alpha[i];
    }
  });

  return (
    <>
      {nodes.map((n, i) => {
        const t = texs[i];
        if (!t) return null;
        const strong = n.key === selectedKey || n.key === hoveredKey ? 1.15 : 1;
        const [x, y, z] = v3(n.pos);
        return (
          <sprite
            key={n.key}
            ref={(el: unknown) => {
              sprites.current[i] = el as THREE.Sprite | null;
            }}
            position={[x, y + radiusOf(n.mass) * 1.5 + 0.04, z]}
            scale={[t.w * strong, t.h * strong, 1]}
            center={[0.5, 0] as never}
            renderOrder={2}
            onPointerMove={(e) => {
              e.stopPropagation();
              if (n.key !== hoveredKey && visible.has(n.key)) onHover(n.key);
            }}
            onPointerOut={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (e.delta <= 5 && visible.has(n.key)) onPick(n.key);
            }}
          >
            <spriteMaterial map={t.tex as never} transparent depthWrite={false} />
          </sprite>
        );
      })}
    </>
  );
}

/**
 * Far-zoom group names. Each group's home point sits above its members; every
 * frame the homes are projected and labelLayout slides colliding names along
 * screen y (up preferred) into free slots, steering around pinned node labels.
 * A displaced name gets a thin leader in the group color back to its home. The
 * drawn offset and alpha ease toward the layout's targets, and the layout
 * prefers each name's previous slot, so names hold still while orbiting.
 * Placed boxes go on the shared board; ordinary node labels yield to them.
 */
function GroupLabels({ payload, hiddenGroups, theme, layoutVersion }: SceneProps) {
  const groups = payload.groups;
  const scene = useThree((s) => s.scene);
  const board = labelBoard(scene);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const anchors = useMemo(
    () =>
      groups.map((g) => {
        const c = new THREE.Vector3();
        let w = 0;
        let top = -Infinity;
        for (const n of payload.nodes) {
          const m = n.groups[g.id] ?? 0;
          if (m < 0.5) continue;
          const p = v3(n.pos);
          c.x += p[0] * m * n.mass;
          c.y += p[1] * m * n.mass;
          c.z += p[2] * m * n.mass;
          w += m * n.mass;
          top = Math.max(top, p[1]);
        }
        if (w === 0) return null;
        c.divideScalar(w);
        c.y = top + 1.4;
        return { at: c, weight: w };
      }),
    // layoutVersion: positions change in place (drag, re-arrange).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payload.nodes, groups, layoutVersion],
  );
  // Layout priority: heaviest group first.
  const order = useMemo(
    () =>
      Int32Array.from(
        anchors
          .map((a, i) => ({ i, w: a?.weight ?? 0 }))
          .sort((a, b) => b.w - a.w)
          .map((x) => x.i),
      ),
    [anchors],
  );
  const items = useMemo(
    () => groups.map((g) => ({ id: g.id, lines: [g.name], color: g.color, fontSize: 0.85, weight: 800 })),
    [groups],
  );
  const texs = useLabelTextures(items, theme);

  const st = useMemo(() => {
    const G = groups.length;
    const nan = () => new Float32Array(G).fill(Number.NaN);
    return {
      v: new THREE.Vector3(),
      up: new THREE.Vector3(),
      right: new THREE.Vector3(),
      hx: new Float32Array(G),
      hy: new Float32Array(G),
      w: new Float32Array(G),
      h: new Float32Array(G),
      ppu: new Float32Array(G),
      fade: new Float32Array(G),
      active: new Uint8Array(G),
      target: nan(),
      next: nan(),
      targetX: new Float32Array(G),
      shift: new Float32Array(G),
      shiftX: new Float32Array(G),
      alpha: new Float32Array(G),
      layout: createGroupLayoutScratch(G, 16),
      obstacleCap: 16,
    };
  }, [groups.length]);

  // Leaders: one line segment per group, per-vertex RGBA so each fades alone.
  const leaders = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(groups.length * 6), 3));
    const col = new Float32Array(groups.length * 8);
    const c = new THREE.Color();
    groups.forEach((g, i) => {
      c.set(g.color);
      col.set([c.r, c.g, c.b, 0, c.r, c.g, c.b, 0], i * 8);
    });
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false });
    const seg = new THREE.LineSegments(geo, mat);
    seg.renderOrder = 3;
    seg.frustumCulled = false;
    seg.raycast = () => {};
    return seg;
  }, [groups]);
  useEffect(
    () => () => {
      leaders.geometry.dispose();
      (leaders.material as THREE.Material).dispose();
    },
    [leaders],
  );

  // Priority -0.5: after OrbitControls (-1) has moved the camera, before Labels (0) reads the board.
  useFrame(({ camera, size }, dt) => {
    const cam = camera as unknown as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    const tanHalf = Math.tan(((cam.fov ?? 50) * Math.PI) / 360);
    const ease = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    st.right.setFromMatrixColumn(cam.matrixWorld, 0);
    st.up.setFromMatrixColumn(cam.matrixWorld, 1);
    const G = groups.length;

    for (let i = 0; i < G; i += 1) {
      const a = anchors[i];
      const t = texs[i];
      st.active[i] = 0;
      st.fade[i] = 0;
      if (!a || !t || hiddenGroups.has(groups[i].id)) continue;
      const depth = -st.v.copy(a.at).applyMatrix4(cam.matrixWorldInverse).z;
      if (depth <= cam.near) continue;
      st.fade[i] = Math.min(1, Math.max(0, (cam.position.distanceTo(a.at) - 15) / 7));
      if (st.fade[i] <= 0.02) continue;
      st.v.copy(a.at).project(cam);
      const ppu = size.height / (2 * depth * tanHalf);
      st.ppu[i] = ppu;
      st.hx[i] = ((st.v.x + 1) / 2) * size.width;
      st.hy[i] = ((1 - st.v.y) / 2) * size.height;
      st.w[i] = t.w * ppu;
      st.h[i] = t.h * ppu;
      st.active[i] = 1;
    }

    if (board.pinnedCount > st.obstacleCap) {
      st.obstacleCap = board.pinnedCount * 2;
      st.layout = createGroupLayoutScratch(G, st.obstacleCap);
    }
    layoutGroupLabels(st.hx, st.hy, st.w, st.h, st.active, st.target, order, board.pinnedBoxes, board.pinnedCount, size.width, st.next, st.targetX, st.layout);
    st.target.set(st.next);

    board.groupBoxes = ensureBoxes(board.groupBoxes, G);
    let nb = 0;
    const pos = leaders.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = leaders.geometry.getAttribute('color') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    for (let i = 0; i < G; i += 1) {
      const s = sprites.current[i];
      const a = anchors[i];
      C[i * 8 + 3] = 0;
      C[i * 8 + 7] = 0;
      if (!s || !a) continue;
      const tgt = st.target[i];
      const placed = Number.isFinite(tgt);
      // A name coming back from invisible appears in its new slot rather than sliding there.
      if (placed) {
        const snap = st.alpha[i] < 0.03;
        st.shift[i] = snap ? tgt : st.shift[i] + (tgt - st.shift[i]) * ease;
        st.shiftX[i] = snap ? st.targetX[i] : st.shiftX[i] + (st.targetX[i] - st.shiftX[i]) * ease;
      }
      st.alpha[i] += ((placed ? st.fade[i] : 0) - st.alpha[i]) * ease;
      const alpha = st.alpha[i];
      s.visible = alpha > 0.02;
      (s.material as THREE.SpriteMaterial).opacity = alpha;
      if (!s.visible) continue;

      const ppu = st.ppu[i];
      const sh = st.shift[i];
      const sx = st.shiftX[i] / ppu;
      s.position.copy(a.at).addScaledVector(st.up, -sh / ppu).addScaledVector(st.right, sx);

      // Leader from the home point to the nearer edge of the displaced name.
      const lead = alpha * 0.55 * Math.min(1, Math.max(0, (Math.abs(sh) - 8) / 16));
      if (lead > 0.01) {
        const from = sh < 0 ? 2 : -2;
        const to = sh < 0 ? -sh - 3 : -sh + st.h[i] + 3;
        st.v.copy(a.at).addScaledVector(st.up, from / ppu).toArray(P, i * 6);
        st.v.copy(a.at).addScaledVector(st.up, to / ppu).addScaledVector(st.right, sx).toArray(P, i * 6 + 3);
        C[i * 8 + 3] = lead;
        C[i * 8 + 7] = lead;
      }

      if (placed && st.fade[i] > 0.35) {
        const o = nb * 4;
        board.groupBoxes[o] = st.hx[i] + st.targetX[i] - st.w[i] / 2;
        board.groupBoxes[o + 1] = st.hy[i] + tgt - st.h[i];
        board.groupBoxes[o + 2] = st.w[i];
        board.groupBoxes[o + 3] = st.h[i];
        nb += 1;
      }
    }
    board.groupCount = nb;
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }, -0.5);

  return (
    <>
      <primitive object={leaders} />
      {groups.map((g, i) => {
        const t = texs[i];
        if (!anchors[i] || !t) return null;
        return (
          <sprite
            key={g.id}
            ref={(el: unknown) => {
              sprites.current[i] = el as THREE.Sprite | null;
            }}
            visible={false}
            scale={[t.w, t.h, 1]}
            center={[0.5, 0] as never}
            renderOrder={3}
            raycast={() => null}
          >
            <spriteMaterial map={t.tex as never} transparent opacity={0} depthWrite={false} depthTest={false} />
          </sprite>
        );
      })}
    </>
  );
}


// ── Nebulae, trails, links ───────────────────────────────────────────────────

function Nebulae({ payload, visible, hiddenGroups, theme }: SceneProps) {
  const tex = useGlowTexture();
  const mats = useRef<(THREE.SpriteMaterial | null)[]>([]);

  const sprites = useMemo(() => {
    const out: { key: string; pos: [number, number, number]; color: string; base: number; scale: number }[] = [];
    const colorOf = new Map(payload.groups.map((g) => [g.id, g.color]));
    for (const n of payload.nodes) {
      if (!visible.has(n.key)) continue;
      for (const [gid, w] of Object.entries(n.groups)) {
        if (w < 0.1 || hiddenGroups.has(gid)) continue;
        const color = colorOf.get(gid);
        if (!color) continue;
        out.push({
          key: `${n.key}|${gid}`,
          pos: v3(n.pos),
          color,
          base: (theme.dark ? 0.34 : 0.2) * w,
          scale: 3.4 + 0.5 * Math.sqrt(n.mass),
        });
      }
    }
    return out;
  }, [payload, visible, hiddenGroups, theme.dark]);

  const worldPos = useMemo(() => sprites.map((s) => new THREE.Vector3(...s.pos)), [sprites]);

  useFrame(({ camera }) => {
    for (let i = 0; i < sprites.length; i += 1) {
      const m = mats.current[i];
      if (!m) continue;
      const d = camera.position.distanceTo(worldPos[i]);
      m.opacity = sprites[i].base * Math.min(1, Math.max(0.2, (d - 2) / 12));
    }
  });

  const blending = theme.dark ? THREE.AdditiveBlending : THREE.NormalBlending;
  return (
    <group>
      {sprites.map((s, i) => (
        <sprite
          key={`${s.key}|${theme.dark ? 'd' : 'l'}`}
          renderOrder={-1}
          position={s.pos}           scale={[s.scale, s.scale, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            ref={(el: unknown) => {
              mats.current[i] = el as THREE.SpriteMaterial | null;
            }}
            map={tex as never}
            color={s.color}
            transparent
            opacity={s.base}
            depthWrite={false}
            blending={blending}
          />
        </sprite>
      ))}
    </group>
  );
}

function Trails({ payload, visible, theme }: SceneProps) {
  const byKey = useMemo(() => new Map(payload.nodes.map((n) => [n.key, n])), [payload.nodes]);
  return (
    <>
      {payload.trails.map((tr) => {
        const pts = tr.keys
          .filter((k) => visible.has(k))
          .map((k) => byKey.get(k))
          .filter((n): n is TasteMapPayloadNode => !!n)
          .map((n) => v3(n.pos));
        if (pts.length < 2) return null;
        return (
          <Line
            key={tr.artistId}
            points={pts}
            color={theme.muted}
            lineWidth={1.5}
            dashed
            dashSize={0.25}
            gapSize={0.18}
            transparent
            opacity={0.75}
            raycast={() => null}
          />
        );
      })}
    </>
  );
}

function NeighborLinks({ payload, visible, selectedKey, theme }: SceneProps) {
  const byKey = useMemo(() => new Map(payload.nodes.map((n) => [n.key, n])), [payload.nodes]);
  if (!selectedKey) return null;
  const from = byKey.get(selectedKey);
  if (!from) return null;
  return (
    <>
      {(payload.neighbors[selectedKey] ?? []).map((nb) => {
        const to = byKey.get(nb.key);
        if (!to || !visible.has(nb.key)) return null;
        return (
          <Line
            key={nb.key}
            points={[v3(from.pos), v3(to.pos)]}
            color={theme.ink}
            lineWidth={1}
            transparent
            opacity={0.15 + 0.4 * nb.sim}
            raycast={() => null}
          />
        );
      })}
      <Billboard position={v3(from.pos)}>
        <mesh raycast={() => null}>
          <ringGeometry args={[radiusOf(from.mass) * 1.75, radiusOf(from.mass) * 2.05, 48]} />
          <meshBasicMaterial color={theme.ink} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      </Billboard>
    </>
  );
}

// ── Add-artist ghost ─────────────────────────────────────────────────────────

const GHOST_R = 0.32;
const RING = Array.from({ length: 49 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2;
  return [Math.cos(a) * GHOST_R * 1.35, Math.sin(a) * GHOST_R * 1.35, 0] as [number, number, number];
});

function Ghost({ ghost, payload, visible, theme }: SceneProps) {
  const items = useMemo(
    () => (ghost ? [{ id: ghost.key, lines: [ghost.label, ghost.tag], color: theme.ink, fontSize: 0.42, weight: 800 }] : []),
    [ghost, theme.ink],
  );
  const texs = useLabelTextures(items, theme);
  const byKey = useMemo(() => new Map(payload.nodes.map((n) => [n.key, n])), [payload.nodes]);
  if (!ghost) return null;
  const at = v3(ghost.pos);
  const t = texs[0];
  return (
    <group>
      {ghost.anchors.map((k) => {
        const n = byKey.get(k);
        if (!n || !visible.has(k)) return null;
        return (
          <Line
            key={k}
            points={[at, v3(n.pos)]}
            color={theme.ink}
            lineWidth={1}
            dashed
            dashSize={0.18}
            gapSize={0.14}
            transparent
            opacity={0.55}
            raycast={() => null}
          />
        );
      })}
      <mesh position={at} raycast={() => null} renderOrder={1}>
        <sphereGeometry args={[GHOST_R, 24, 16]} />
        <meshBasicMaterial color={theme.ink} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <Billboard position={at}>
        <Line points={RING} color={theme.ink} lineWidth={1.4} dashed dashSize={0.09} gapSize={0.07} transparent opacity={0.9} raycast={() => null} />
      </Billboard>
      {t && (
        <sprite position={[at[0], at[1] + GHOST_R * 1.6, at[2]]} scale={[t.w, t.h, 1]} center={[0.5, 0] as never} renderOrder={5} raycast={() => null}>
          <spriteMaterial map={t.tex as never} transparent depthWrite={false} depthTest={false} />
        </sprite>
      )}
    </group>
  );
}
