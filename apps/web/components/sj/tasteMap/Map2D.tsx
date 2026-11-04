'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { contourDensity } from 'd3-contour';
import { spectrumColor } from '../../../lib/sj/display';
import type { NodeKey, TasteMapPayloadNode } from '../../../lib/tasteMap/types';
import type { SceneProps } from './TasteMapView';

/**
 * 2D taste map: a DPR-aware canvas of the payload's principal plane (`pos2d`),
 * the same canonical layout the 3D scene shows, flattened (plan D5).
 *
 * - Pan with a drag on the background, zoom with the wheel or a pinch (plain
 *   pointer events). Dragging a node moves it in the plane and, on drop, the
 *   shell pins it (D5: x, y fixed, depth soft). Pinned nodes carry a small pin
 *   badge (filled = full pin, hollow = 2D pin).
 * - Group density blobs: one `contourDensity` per group, weighted by
 *   membership × mass, computed once in a fixed grid space and drawn through
 *   the view transform, filled at low alpha so levels stack into a soft blob.
 * - Labels: greedy collision avoidance by priority (selection, hover, the
 *   selection's neighbors, then mass), so zooming in reveals more names.
 * - Draws on demand (one rAF per state change or animation frame), never in a
 *   free-running loop.
 * - Add-artist ghost (Phase 4, preview only): a translucent dashed circle at the
 *   ghost's plane position with dashed lines to its anchors and a "preview" tag.
 */

const GRID = 1000;
const MIN_K = 0.5;
const MAX_K = 10;

interface View {
  k: number;
  tx: number;
  ty: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  key: NodeKey | null;
}

function nodeRadius(mass: number, k: number): number {
  return (2.5 + 2.1 * Math.sqrt(Math.max(mass, 0))) * Math.min(1.6, 0.8 + 0.2 * Math.sqrt(k));
}

const colorCache = new Map<string, string>();
/** spectrumColor is an OKLCh solve per call; cache it per (score, lightness). */
function scoreColor(score: number, lightness: number): string {
  const key = `${score.toFixed(2)}|${lightness}`;
  let c = colorCache.get(key);
  if (!c) {
    c = spectrumColor(score, lightness, 1);
    colorCache.set(key, c);
  }
  return c;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A small push-pin badge at a node's upper right: filled = full pin, hollow = 2D pin (depth free). */
function drawPinBadge(ctx: CanvasRenderingContext2D, x: number, y: number, soft: boolean, theme: SceneProps['theme']) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  // Needle.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3.2, y - 3.2);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = theme.bg;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = theme.ink;
  ctx.stroke();
  // Head.
  ctx.beginPath();
  ctx.arc(x + 4.4, y - 4.4, 3.1, 0, Math.PI * 2);
  ctx.fillStyle = soft ? theme.bg : theme.ink;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = soft ? theme.ink : theme.bg;
  ctx.stroke();
  ctx.restore();
}

export default function Map2D(props: SceneProps) {
  const { payload, focus, layoutVersion, busy } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const goal = useRef<View | null>(null);
  const raf = useRef<number | null>(null);
  const labelBoxes = useRef<Box[]>([]);
  const measureCache = useRef(new Map<string, number>());

  // Fixed world frame: bounds over every node (not just visible ones) so group
  // toggles never move the map. Keyed on the node array, which keeps its
  // identity while positions change in place, so drags and re-arranges don't
  // re-fit the view either.
  const frame = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of payload.nodes) {
      minX = Math.min(minX, n.pos2d[0]);
      maxX = Math.max(maxX, n.pos2d[0]);
      minY = Math.min(minY, n.pos2d[1]);
      maxY = Math.max(maxY, n.pos2d[1]);
    }
    if (!Number.isFinite(minX)) {
      minX = -1;
      maxX = 1;
      minY = -1;
      maxY = 1;
    }
    const spanX = Math.max(maxX - minX, 0.2);
    const spanY = Math.max(maxY - minY, 0.2);
    // Contour grid: square cells over the bounds plus a margin for blob falloff.
    const margin = Math.max(spanX, spanY) * 0.25;
    const gs = (Math.max(spanX, spanY) + 2 * margin) / GRID;
    return {
      mx: (minX + maxX) / 2,
      my: (minY + maxY) / 2,
      spanX,
      spanY,
      gx0: (minX + maxX) / 2 - (GRID * gs) / 2,
      gy0: (minY + maxY) / 2 - (GRID * gs) / 2,
      gs,
    };
  }, [payload.nodes]);

  const rank = useMemo(() => {
    const order = [...payload.nodes].sort((a, b) => b.mass - a.mass);
    return new Map(order.map((n, i) => [n.key, i]));
  }, [payload.nodes]);

  // Per-group density blobs as Path2D in grid units (drawn via setTransform).
  // Recomputed when the layout settles: frozen while a drag or re-arrange runs
  // (a contour pass per group per frame is too slow), then caught up.
  const [blobVersion, setBlobVersion] = useState(layoutVersion);
  useEffect(() => {
    if (!busy) setBlobVersion(layoutVersion);
  }, [busy, layoutVersion]);
  const blobs = useMemo(() => {
    if (typeof Path2D === 'undefined') return [];
    return payload.groups.map((g) => {
      const members = payload.nodes
        .map((n) => ({ n, w: n.groups[g.id] ?? 0 }))
        .filter((m) => m.w > 0.05);
      if (members.length === 0) return { id: g.id, color: g.color, paths: [] as Path2D[] };
      const contours = contourDensity<{ n: TasteMapPayloadNode; w: number }>()
        .x((m) => (m.n.pos2d[0] - frame.gx0) / frame.gs)
        .y((m) => (m.n.pos2d[1] - frame.gy0) / frame.gs)
        .weight((m) => m.w * (0.5 + 0.5 * Math.sqrt(m.n.mass)))
        .size([GRID, GRID])
        .cellSize(4)
        .bandwidth(42)
        .thresholds(7)(members);
      const paths = contours.map((ct) => {
        const p = new Path2D();
        for (const poly of ct.coordinates) {
          for (const ring of poly) {
            ring.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
            p.closePath();
          }
        }
        return p;
      });
      return { id: g.id, color: g.color, paths };
    });
    // blobVersion stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.groups, payload.nodes, frame, blobVersion]);

  // ── Geometry helpers (read refs, so they're stable) ──
  const fitScale = () => {
    const { w, h } = size.current;
    const padX = Math.min(90, w * 0.14);
    const padY = Math.min(60, h * 0.1);
    return Math.max(1, Math.min((w - 2 * padX) / frame.spanX, (h - 2 * padY) / frame.spanY));
  };
  const toScreen = (x: number, y: number, v: View, F: number): [number, number] => {
    const { w, h } = size.current;
    return [w / 2 + v.tx + (x - frame.mx) * F * v.k, h / 2 + v.ty - (y - frame.my) * F * v.k];
  };
  const toPlaneXY = (sx: number, sy: number, v: View, F: number): [number, number] => {
    const { w, h } = size.current;
    return [frame.mx + (sx - w / 2 - v.tx) / (F * v.k), frame.my - (sy - h / 2 - v.ty) / (F * v.k)];
  };

  const draw = () => {
    raf.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = propsRef.current;
    const { w, h, dpr } = size.current;
    if (w === 0 || h === 0) return;

    // Ease toward a pending focus goal.
    if (goal.current) {
      const g = goal.current;
      const v = view.current;
      const t = 0.18;
      v.k += (g.k - v.k) * t;
      v.tx += (g.tx - v.tx) * t;
      v.ty += (g.ty - v.ty) * t;
      if (Math.abs(g.k - v.k) < 0.002 && Math.abs(g.tx - v.tx) < 0.3 && Math.abs(g.ty - v.ty) < 0.3) {
        view.current = { ...g };
        goal.current = null;
      }
    }
    const v = view.current;
    const F = fitScale();
    const { theme } = p;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    // Blobs — grid units → screen.
    const a = frame.gs * F * v.k;
    const cx = w / 2 + v.tx + (frame.gx0 - frame.mx) * F * v.k;
    const cy = h / 2 + v.ty - (frame.gy0 - frame.my) * F * v.k;
    ctx.save();
    ctx.setTransform(dpr * a, 0, 0, -dpr * a, dpr * cx, dpr * cy);
    const fillA = theme.dark ? 0.085 : 0.06;
    for (const b of blobs) {
      if (p.hiddenGroups.has(b.id)) continue;
      ctx.fillStyle = hexAlpha(b.color, fillA);
      for (const path of b.paths) ctx.fill(path);
      if (b.paths[1]) {
        ctx.strokeStyle = hexAlpha(b.color, theme.dark ? 0.35 : 0.28);
        ctx.lineWidth = 1 / a;
        ctx.stroke(b.paths[1]);
      }
    }
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodes = p.payload.nodes;
    const pos = new Map<NodeKey, [number, number]>();
    for (const n of nodes) if (p.visible.has(n.key)) pos.set(n.key, toScreen(n.pos2d[0], n.pos2d[1], v, F));

    const sel = p.selectedKey;
    const related = new Set<NodeKey>();
    if (sel) {
      related.add(sel);
      for (const nb of p.payload.neighbors[sel] ?? []) related.add(nb.key);
    }
    if (p.hoveredKey) related.add(p.hoveredKey);
    const dimOthers = sel != null;

    // Trails (dashed, chronological).
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = 0.8;
    for (const tr of p.payload.trails) {
      const pts = tr.keys.map((k) => pos.get(k)).filter((q): q is [number, number] => !!q);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Links from the selection to its neighbors.
    if (sel && pos.has(sel)) {
      const [sx, sy] = pos.get(sel)!;
      for (const nb of p.payload.neighbors[sel] ?? []) {
        const q = pos.get(nb.key);
        if (!q) continue;
        ctx.strokeStyle = theme.ink;
        ctx.globalAlpha = 0.12 + 0.35 * nb.sim;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Nodes, small first so big ones sit on top.
    const drawOrder = nodes
      .filter((n) => pos.has(n.key))
      .sort((x, y) => x.mass - y.mass);
    const L = theme.dark ? 0.72 : 0.62;
    for (const n of drawOrder) {
      const [x, y] = pos.get(n.key)!;
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      const r = nodeRadius(n.mass, v.k);
      ctx.globalAlpha = dimOthers && !related.has(n.key) ? 0.3 : 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.avgScore != null ? scoreColor(n.avgScore, L) : theme.muted;
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = theme.bg;
      ctx.stroke();
      if (n.key === sel || n.key === p.hoveredKey) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
        ctx.lineWidth = n.key === sel ? 2 : 1.25;
        ctx.strokeStyle = theme.ink;
        ctx.stroke();
      }
      const pin = p.pins.get(n.key);
      if (pin) drawPinBadge(ctx, x + r * 0.72, y - r * 0.72, pin.softZ, theme);
    }
    ctx.globalAlpha = 1;

    // Add-artist ghost: dashed lines to its anchors, then a translucent dashed circle.
    const gh = p.ghost;
    const ghostAt = gh ? toScreen(gh.pos2d[0], gh.pos2d[1], v, F) : null;
    const ghostR = nodeRadius(2, v.k) + 2;
    if (gh && ghostAt) {
      const [gx, gy] = ghostAt;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = theme.ink;
      ctx.globalAlpha = 0.5;
      for (const k of gh.anchors) {
        const q = pos.get(k);
        if (!q) continue;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      ctx.arc(gx, gy, ghostR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Labels — greedy placement by priority.
    const boxes: Box[] = [];
    const overlaps = (b: Box) =>
      boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const measure = (font: string, text: string) => {
      const key = `${font}|${text}`;
      let m = measureCache.current.get(key);
      if (m == null) {
        ctx.font = font;
        m = ctx.measureText(text).width;
        measureCache.current.set(key, m);
      }
      return m;
    };
    const fontFamily = theme.font;
    const placeText = (
      text: string,
      x: number,
      y: number,
      sizePx: number,
      weight: number,
      color: string,
      alpha: number,
      key: NodeKey | null,
      force: boolean,
    ) => {
      const font = `${weight} ${sizePx}px ${fontFamily}`;
      const tw = measure(font, text);
      const b: Box = { x: x - tw / 2 - 3, y: y - sizePx - 1, w: tw + 6, h: sizePx + 3, key };
      if (b.x + b.w < 0 || b.x > w || b.y + b.h < 0 || b.y > h) return;
      if (!force && overlaps(b)) return;
      boxes.push(b);
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = alpha;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.bg;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    };

    const prio = (n: TasteMapPayloadNode) =>
      n.key === sel ? 0 : n.key === p.hoveredKey ? 1 : related.has(n.key) ? 2 : 3;
    const labelOrder = nodes
      .filter((n) => pos.has(n.key))
      .sort((x, y) => prio(x) - prio(y) || (rank.get(x.key) ?? 0) - (rank.get(y.key) ?? 0));

    if (gh && ghostAt) {
      placeText(gh.label, ghostAt[0], ghostAt[1] - ghostR - 4, 13, 800, theme.ink, 1, null, true);
      placeText(gh.tag.toUpperCase(), ghostAt[0], ghostAt[1] + ghostR + 12, 9.5, 800, theme.muted, 1, null, true);
    }

    let groupLabelsDone = false;
    const drawGroupLabels = () => {
      groupLabelsDone = true;
      // Far zoom: one label per group, above its members' top edge.
      const ga = Math.max(0, Math.min(1, (1.9 - v.k) / 0.8));
      if (ga <= 0.02) return;
      for (const g of p.payload.groups) {
        if (p.hiddenGroups.has(g.id)) continue;
        let top = Infinity;
        let sx = 0;
        let sw = 0;
        for (const n of nodes) {
          const wgt = n.groups[g.id] ?? 0;
          const q = pos.get(n.key);
          if (wgt < 0.5 || !q) continue;
          top = Math.min(top, q[1] - nodeRadius(n.mass, v.k));
          sx += q[0] * wgt * n.mass;
          sw += wgt * n.mass;
        }
        if (!sw) continue;
        placeText(g.name, sx / sw, top - 22, 13, 800, g.color, ga, null, false);
      }
    };

    for (const n of labelOrder) {
      const pr = prio(n);
      if (pr === 3 && !groupLabelsDone) drawGroupLabels();
      const [x, y] = pos.get(n.key)!;
      const r = nodeRadius(n.mass, v.k);
      const sizePx = Math.round(Math.min(16, 10 + 1.3 * Math.sqrt(n.mass)) * Math.min(1.15, 0.9 + 0.1 * v.k));
      const text = n.eraLabel ? `${n.label} · ${n.eraLabel}` : n.label;
      const dim = dimOthers && !related.has(n.key);
      placeText(text, x, y - r - 4, sizePx, pr <= 1 ? 800 : 650, theme.ink, dim ? 0.4 : 1, n.key, pr <= 1);
    }
    if (!groupLabelsDone) drawGroupLabels();
    labelBoxes.current = boxes;

    if (goal.current) raf.current = requestAnimationFrame(() => drawRef.current());
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const requestDraw = () => {
    if (raf.current == null) raf.current = requestAnimationFrame(() => drawRef.current());
  };
  const requestDrawRef = useRef(requestDraw);
  requestDrawRef.current = requestDraw;

  // Redraw whenever anything the picture depends on changes.
  useEffect(() => {
    requestDrawRef.current();
  });

  // Frame a node: center it and zoom in a little (mode switch, inspector click).
  const focusNonce = focus?.nonce ?? null;
  useEffect(() => {
    if (!focus) return;
    const gh = propsRef.current.ghost;
    const n = propsRef.current.payload.nodes.find((m) => m.key === focus.key) ?? (gh?.key === focus.key ? gh : null);
    if (!n || size.current.w === 0) return;
    const F = fitScale();
    const k = Math.max(view.current.k, 1.8);
    goal.current = { k, tx: -(n.pos2d[0] - frame.mx) * F * k, ty: (n.pos2d[1] - frame.my) * F * k };
    requestDrawRef.current();
    // fitScale reads refs; frame is the only real dependency besides the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, frame]);

  // Size + DPR tracking.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (first && w > 0) {
        first = false;
        // Mounted with a selection (switched from 3D): open already framed on it.
        const f = propsRef.current.focus;
        const sel = f ? propsRef.current.payload.nodes.find((m) => m.key === f.key) : null;
        if (sel) {
          const F = fitScale();
          const k = 1.8;
          view.current = { k, tx: -(sel.pos2d[0] - frame.mx) * F * k, ty: (sel.pos2d[1] - frame.my) * F * k };
        }
      }
      requestDrawRef.current();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', measure);
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  // ── Pointer input: pan, pinch, wheel, hover, click ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number } | null = null;
    let moved = false;
    let pinchDist = 0;
    // Node drag: the node under the pointer at pointerdown, plus the plane
    // offset from the pointer to the node so it doesn't jump to the cursor.
    let drag: { key: NodeKey; dx: number; dy: number; started: boolean } | null = null;
    const endDrag = () => {
      const d = drag;
      drag = null;
      if (!d?.started) return;
      const n = propsRef.current.payload.nodes.find((m) => m.key === d.key);
      if (n) propsRef.current.onDragNode(d.key, 'end', { pos2d: [n.pos2d[0], n.pos2d[1]] });
    };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const zoomAt = (px: number, py: number, factor: number) => {
      const v = view.current;
      const { w, h } = size.current;
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const ux = (px - w / 2 - v.tx) / v.k;
      const uy = (py - h / 2 - v.ty) / v.k;
      view.current = { k, tx: px - w / 2 - ux * k, ty: py - h / 2 - uy * k };
    };
    const hitTest = (x: number, y: number): NodeKey | null => {
      for (const b of labelBoxes.current) {
        if (b.key && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
      }
      const p = propsRef.current;
      const F = fitScale();
      let best: NodeKey | null = null;
      let bestD = Infinity;
      for (const n of p.payload.nodes) {
        if (!p.visible.has(n.key)) continue;
        const [sx, sy] = toScreen(n.pos2d[0], n.pos2d[1], view.current, F);
        const d = Math.hypot(sx - x, sy - y);
        if (d <= nodeRadius(n.mass, view.current.k) + 6 && d < bestD) {
          bestD = d;
          best = n.key;
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const q = local(e);
      pointers.set(e.pointerId, q);
      goal.current = null;
      if (pointers.size === 1) {
        down = q;
        moved = false;
        const p = propsRef.current;
        const hit = p.editable ? hitTest(q.x, q.y) : null;
        const n = hit ? p.payload.nodes.find((m) => m.key === hit) : null;
        if (n) {
          const [wx, wy] = toPlaneXY(q.x, q.y, view.current, fitScale());
          drag = { key: n.key, dx: n.pos2d[0] - wx, dy: n.pos2d[1] - wy, started: false };
        }
      } else if (pointers.size === 2) {
        // A second finger turns a node drag into a pinch; drop the node where it is.
        endDrag();
        const [a, b] = Array.from(pointers.values());
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        moved = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      const q = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') {
          const hit = hitTest(q.x, q.y);
          if (hit !== propsRef.current.hoveredKey) propsRef.current.onHover(hit);
          canvas.style.cursor = hit ? 'pointer' : 'grab';
        }
        return;
      }
      pointers.set(e.pointerId, q);
      if (pointers.size === 1) {
        if (down && Math.hypot(q.x - down.x, q.y - down.y) > 4) moved = true;
        if (moved && drag) {
          const p = propsRef.current;
          if (!drag.started) {
            drag.started = true;
            p.onDragNode(drag.key, 'start', {});
          }
          const [wx, wy] = toPlaneXY(q.x, q.y, view.current, fitScale());
          p.onDragNode(drag.key, 'move', { pos2d: [wx + drag.dx, wy + drag.dy] });
          canvas.style.cursor = 'grabbing';
          requestDrawRef.current();
        } else if (moved) {
          view.current = { ...view.current, tx: view.current.tx + q.x - prev.x, ty: view.current.ty + q.y - prev.y };
          canvas.style.cursor = 'grabbing';
          requestDrawRef.current();
        }
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        requestDrawRef.current();
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
      if (wasSingle && drag) endDrag();
      if (wasSingle && !moved && e.type === 'pointerup') {
        const q = local(e);
        propsRef.current.onSelect(hitTest(q.x, q.y));
      }
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) down = null;
    };
    const onLeave = () => {
      if (pointers.size === 0 && propsRef.current.hoveredKey) propsRef.current.onHover(null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      goal.current = null;
      const q = local(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(q.x, q.y, Math.exp(-dy * 0.0015));
      requestDrawRef.current();
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
    // Handlers read everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block touch-none select-none" style={{ cursor: 'grab' }} aria-label="Taste map (2D)" role="img" />
    </div>
  );
}
