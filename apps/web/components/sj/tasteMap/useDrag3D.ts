'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { fromScene, type SceneFrame } from '../../../lib/tasteMap/scene3d';
import type { NodeKey, Vec3 } from '../../../lib/tasteMap/types';
import type { SceneProps } from './TasteMapView';

/** What the drag needs from inside the r3f Canvas (Scene3D's ThreeBridge fills it). */
export interface ThreeHandles {
  camera: THREE.Camera;
  dom: HTMLElement;
  controls: { enabled: boolean } | null;
  invalidate: () => void;
}

/**
 * 3D node drag for Scene3D (TASTE_MAP_PLAN.md Phase 3).
 *
 * Scene3D picks stars in screen space on its own container, so a drag starts
 * from a plain DOM pointerdown: the star moves on the camera-facing plane
 * through it, OrbitControls is off for the gesture (Scene3D stops the
 * pointerdown before the canvas sees it), and window-level pointermove /
 * pointerup follow the pointer even off the stage. Nothing moves until the
 * pointer travels a few pixels, so a tap still selects. Positions go to the
 * shell in map units (`frame` maps scene ↔ map); on drop the shell pins the
 * node in all three axes.
 */
export function useDrag3D({
  three,
  frame,
  enabled,
  onDragNode,
}: {
  three: MutableRefObject<ThreeHandles | null>;
  frame: SceneFrame;
  enabled: boolean;
  onDragNode: SceneProps['onDragNode'];
}) {
  const onDragRef = useRef(onDragNode);
  onDragRef.current = onDragNode;
  const cleanup = useRef<(() => void) | null>(null);
  const active = useRef(false);

  useEffect(() => () => cleanup.current?.(), []);

  /** Start a drag of `key`, whose star is at `world` (scene units). Returns true when the gesture is taken. */
  const begin = (key: NodeKey, world: THREE.Vector3, ev: { clientX: number; clientY: number; pointerId: number; button: number }): boolean => {
    const t = three.current;
    if (!enabled || !t || cleanup.current || ev.button !== 0) return false;
    const { camera, dom, controls } = t;
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    const rayAt = (x: number, y: number) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit);
    };
    if (!rayAt(ev.clientX, ev.clientY)) return false;
    const offset = world.clone().sub(hit);
    const start = { x: ev.clientX, y: ev.clientY };
    let started = false;
    let last: Vec3 = fromScene(frame, world.x, world.y, world.z);

    if (controls) controls.enabled = false;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 4) return;
        started = true;
        active.current = true;
        onDragRef.current(key, 'start', {});
      }
      if (!rayAt(e.clientX, e.clientY)) return;
      hit.add(offset);
      last = fromScene(frame, hit.x, hit.y, hit.z);
      onDragRef.current(key, 'move', { pos: last });
      t.invalidate();
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== ev.pointerId) return;
      cleanup.current?.();
      if (started) onDragRef.current(key, 'end', { pos: last });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (controls) controls.enabled = true;
      cleanup.current = null;
      active.current = false;
    };
    return true;
  };

  return { begin, dragging: active };
}
