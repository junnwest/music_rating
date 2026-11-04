'use client';

import { useEffect, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { NodeKey, Vec3 } from '../../../lib/tasteMap/types';
import type { SceneProps } from './TasteMapView';

/**
 * 3D node drag for Scene3D (TASTE_MAP_PLAN.md Phase 3).
 *
 * A pointerdown on a node starts a drag on the camera-facing plane through the
 * node: OrbitControls is disabled for the gesture (r3f dispatches the object's
 * pointerdown before OrbitControls' own DOM listener sees it, so the orbit
 * never starts), and window-level pointermove / pointerup follow the pointer
 * even off the canvas. Nothing moves until the pointer travels a few pixels, so
 * a tap still selects. Positions go to the shell in map units (world / scale);
 * on drop the shell pins the node in all three axes.
 */
export function useDrag3D({
  scale,
  enabled,
  onDragNode,
}: {
  /** Scene units per map unit (Scene3D SCALE). */
  scale: number;
  enabled: boolean;
  onDragNode: SceneProps['onDragNode'];
}) {
  // Fiber resolves a second @types/three copy (see Scene3D's typing note);
  // cast at the boundary so the local THREE API types line up.
  const camera = useThree((s) => s.camera) as unknown as THREE.Camera;
  const gl = useThree((s) => s.gl) as unknown as { domElement: HTMLCanvasElement };
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const onDragRef = useRef(onDragNode);
  onDragRef.current = onDragNode;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  /** Call from the node's onPointerDown with its current world position (scene units). Returns true when a drag began. */
  const begin = (key: NodeKey, world: THREE.Vector3, e: ThreeEvent<PointerEvent>): boolean => {
    if (!enabled || cleanup.current) return false;
    if (e.button != null && e.button !== 0) return false;
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, world);
    const hit = new THREE.Vector3();
    const ray = e.ray as unknown as THREE.Ray;
    if (!ray.intersectPlane(plane, hit)) return false;
    const offset = world.clone().sub(hit);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const start = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    const pointerId = e.nativeEvent.pointerId;
    let started = false;
    let last: Vec3 = [world.x / scale, world.y / scale, world.z / scale];

    if (controls) controls.enabled = false;

    const toMap = (ev: PointerEvent): Vec3 | null => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      hit.add(offset);
      return [hit.x / scale, hit.y / scale, hit.z / scale];
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= 4) return;
        started = true;
        onDragRef.current(key, 'start', {});
      }
      const p = toMap(ev);
      if (!p) return;
      last = p;
      onDragRef.current(key, 'move', { pos: p });
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
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
    };
    return true;
  };

  return { begin };
}
