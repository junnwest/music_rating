'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { contourDensity, contours as gridContours } from 'd3-contour';
import { depthLightness, distortionRgb, GRAY, hueMap, nodeRgb, oklabToRgb, rgbCss, type MapLens, type Rgb } from '../../../lib/tasteMap/color';
import { colorField, spanningTree, tagGradients, type FieldPoint } from '../../../lib/tasteMap/fields';
import { toPlane } from '../../../lib/tasteMap/plane';
import { regionFields } from '../../../lib/tasteMap/regions';
import type { NodeKey, TasteMapPayloadNode, Vec2 } from '../../../lib/tasteMap/types';
import type { SceneGhost, SceneProps } from './TasteMapView';

/**
 * 2D taste map: a star chart of the payload's principal plane (`pos2d`), the
 * same canonical layout the 3D scene shows, flattened (plan D5). The stage is
 * always a dark sky, whatever the app theme; the shell around it is sillajuku.
 *
 * Layers, back to front:
 * - Graticule: a faint world-unit grid whose step snaps to 1/2/5 × 10ⁿ as you
 *   zoom, so scale stays legible.
 * - Color field (lib/tasteMap/fields colorField): a kernel-smoothed wash of the
 *   node colors under the current lens, opacity = listening density. Lens
 *   changes crossfade between two fields.
 * - Isodensity contours over every visible node (thin, topographic), and each
 *   group's outline at one density level in its own color.
 * - Constellation lines: the kNN graph's minimum spanning tree.
 * - Era trails (dashed), the selection's neighbor links (drawn on, 3b1b-style).
 * - Stars: additive glow + core, radius by mass. Color by lens (color.ts); in
 *   the genre lens, lightness = depth along the plane normal (lighter = nearer).
 * - Labels with greedy collision avoidance by priority; group names as
 *   spaced capitals at far zoom ("constellations").
 * - Compass (fields tagGradients): the directions the palette tags grow in.
 * - Countries (lib/tasteMap/regions.ts): kNN communities as density-clipped
 *   territories with a faint tint and a border, named in spaced italic
 *   capitals along each country's long axis, sized by area, under the stars.
 *   Bundled arcs join countries (one per pair, width = summed link weight),
 *   bent through the bridge artist when there is one; bridges are diamonds.
 * - Labels never go under the stage's overlay controls (reserved boxes). Group
 *   names are drawn only when there are fewer than two countries.
 * - Distortion lens (honest map, lib/tasteMap/honesty.ts): stars colored by how
 *   much of their real neighborhood the plane keeps, with a fuzzy halo that
 *   widens as it tears; on select, links to torn neighbors are dashed and
 *   intruders (drawn close, not similar) get a dotted ring.
 *
 * - Schematic scale (the default; lib/tasteMap/schematic.ts): the same stars
 *   moved to a subway-map diagram. Countries are discs set around a nucleus
 *   ("you") by VSEPR-style repulsion, members sit on orbital shells around
 *   their country's capital, faint bonds join the nucleus to each disc. The
 *   density layers (graticule, color field, contours, territories, group
 *   outlines) belong to the true plane and fade out; country names sit
 *   level above their discs. Switching scales morphs every star between its
 *   two positions. Dragging is off in the schematic (the shell sets editable).
 *
 * Interaction is unchanged: pan by dragging the background, wheel / pinch to
 * zoom, drag a node to move + pin it (D5: x, y fixed, depth soft), pin badges
 * (filled = full pin, hollow = 2D pin). Draws on demand; an animation (focus,
 * lens fade, link draw-on) keeps requesting frames only while it runs.
 */

const GRID = 1000;
const FIELD_N = 160;
const MIN_K = 0.5;
const MAX_K = 10;
const LENS_MS = 650;
const LINK_MS = 550;
const REGION_N = 120;
const MORPH_MS = 900;
const TAU = Math.PI * 2;

/** The sky. Fixed so the colors read the same in light and dark app themes. */
const SKY = {
  bg0: 'rgb(18, 21, 31)',
  bg1: 'rgb(7, 8, 13)',
  bg: 'rgb(10, 12, 18)',
  ink: 'rgb(234, 237, 245)',
  muted: 'rgb(140, 148, 168)',
  line: 'rgba(205, 218, 255, ',
};
const MATH_FONT = 'italic 11px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

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
  return (2.2 + 1.9 * Math.sqrt(Math.max(mass, 0))) * Math.min(1.6, 0.8 + 0.2 * Math.sqrt(k));
}

/** 3b1b's `smooth`: an ease with zero slope at both ends. */
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lighten = (c: Rgb, t: number): Rgb => lerpRgb(c, [255, 255, 255], t);

/** A country's tint: its palette hue in OKLCh, or the sky's line color. */
const tintOf = (hue: number | null, L: number, C: number): Rgb =>
  hue == null ? [205, 218, 255] : oklabToRgb(L, C * Math.cos((hue * Math.PI) / 180), C * Math.sin((hue * Math.PI) / 180));

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A small push-pin badge at a node's upper right: filled = full pin, hollow = 2D pin (depth free). */
function drawPinBadge(ctx: CanvasRenderingContext2D, x: number, y: number, soft: boolean) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3.2, y - 3.2);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = SKY.bg;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = SKY.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 4.4, y - 4.4, 3.1, 0, Math.PI * 2);
  ctx.fillStyle = soft ? SKY.bg : SKY.ink;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = soft ? SKY.ink : SKY.bg;
  ctx.stroke();
  ctx.restore();
}

/** Nice grid step (1, 2 or 5 × 10ⁿ) at least `raw` long. */
function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return p * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10);
}

export default function Map2D(props: SceneProps) {
  const { payload, focus, layoutVersion, busy, lens, basis, visible, honesty, atlas, scale, schematic } = props;
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

  // Lens crossfade and selection draw-on clocks (performance.now() ms).
  const lensAnim = useRef<{ from: MapLens; to: MapLens; t0: number }>({ from: lens, to: lens, t0: 0 });
  if (lensAnim.current.to !== lens) {
    lensAnim.current = { from: lensAnim.current.to, to: lens, t0: performance.now() };
  }
  const linkAnim = useRef<{ key: NodeKey | null; t0: number }>({ key: null, t0: 0 });
  if (linkAnim.current.key !== props.selectedKey) linkAnim.current = { key: props.selectedKey, t0: performance.now() };

  // Scale morph: s = 0 is the true plane, 1 the schematic. A toggle mid-morph starts from where it is.
  const sTarget = scale === 'schematic' && schematic ? 1 : 0;
  const morph = useRef({ s0: sTarget, s1: sTarget, t0: 0 });
  const morphAt = (now: number) => {
    const m = morph.current;
    return m.s0 === m.s1 ? m.s1 : m.s0 + (m.s1 - m.s0) * smooth((now - m.t0) / MORPH_MS);
  };
  if (morph.current.s1 !== sTarget) {
    const now = performance.now();
    morph.current = { s0: morphAt(now), s1: sTarget, t0: now };
  }
  // The morph as last drawn, for hit tests and drags between frames.
  const sNow = useRef(sTarget);

  /** Plane units per schematic slot: the diagram fitted to the stage at zoom 1. */
  const schScale = () => {
    const sch = propsRef.current.schematic;
    if (!sch) return 1;
    const { w, h } = size.current;
    const { padX, padY } = pads();
    const F = fitScale();
    // Height keeps room for the top disc's name above it.
    return Math.min((w - 2 * padX) / F / sch.extent[0], Math.max(40, h - 2 * padY - 36) / F / sch.extent[1]);
  };
  /** Schematic slots → plane coordinates, centered on the frame. */
  const schToPlane = (q: Vec2, g = schScale()): Vec2 => [frame.mx + q[0] * g, frame.my + q[1] * g];
  /** A node's plane position at morph `s`: its true `pos2d`, its schematic slot, or between. */
  const placeAt = (n: { key: NodeKey; pos2d: Vec2 }, s: number, g?: number): Vec2 => {
    const raw = s > 0 ? propsRef.current.schematic?.pos.get(n.key) : undefined;
    if (!raw) return n.pos2d;
    const q = schToPlane(raw, g);
    return s >= 1 ? q : [n.pos2d[0] + (q[0] - n.pos2d[0]) * s, n.pos2d[1] + (q[1] - n.pos2d[1]) * s];
  };
  /** The Add-artist ghost: in the schematic, just above its anchors' mean. */
  const ghostAt = (gh: SceneGhost, s: number): Vec2 => {
    const sch = propsRef.current.schematic;
    const qs = s > 0 && sch ? gh.anchors.map((k) => sch.pos.get(k)).filter((q): q is Vec2 => !!q) : [];
    if (!qs.length) return gh.pos2d;
    const q = schToPlane([qs.reduce((t, a) => t + a[0], 0) / qs.length, qs.reduce((t, a) => t + a[1], 0) / qs.length + 0.8]);
    return [gh.pos2d[0] + (q[0] - gh.pos2d[0]) * s, gh.pos2d[1] + (q[1] - gh.pos2d[1]) * s];
  };

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
    // Square grid cells over the bounds plus a margin for kernel falloff.
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

  const hues = useMemo(() => hueMap(payload.palette), [payload.palette]);

  // Per-node color under both lenses. Genre lightness follows depth, which a
  // 3D drag or a re-arrange changes, so this follows the layout.
  const colors = useMemo(() => {
    const z = payload.nodes.map((n) => toPlane(n.pos, basis)[2]);
    const mean = z.reduce((s, x) => s + x, 0) / Math.max(1, z.length);
    const sigma = Math.sqrt(z.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, z.length));
    const out = new Map<NodeKey, Record<MapLens, Rgb>>();
    payload.nodes.forEach((n, i) => {
      out.set(n.key, {
        genre: nodeRgb(n, 'genre', hues, depthLightness(z[i] - mean, sigma, 0.74, 0.14)),
        score: nodeRgb(n, 'score', hues, 0.72),
        distortion: nodeRgb(n, 'distortion', hues, 0.72, honesty.byKey.get(n.key)?.recall),
      });
    });
    return out;
    // layoutVersion stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.nodes, hues, basis, layoutVersion, honesty]);

  // Expensive per-layout geometry is frozen while a drag or re-arrange runs
  // (a field + contour pass per frame is too slow), then caught up.
  const [settled, setSettled] = useState(layoutVersion);
  useEffect(() => {
    if (!busy) setSettled(layoutVersion);
  }, [busy, layoutVersion]);

  const gridX = (x: number) => (x - frame.gx0) / frame.gs;
  const gridY = (y: number) => (y - frame.gy0) / frame.gs;

  // Color fields, one per lens, as offscreen canvases in grid space.
  const fields = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const shown = payload.nodes.filter((n) => visible.has(n.key));
    const cell = (GRID * frame.gs) / FIELD_N;
    const grid = { x0: frame.gx0 + cell / 2, y0: frame.gy0 + cell / 2, cell, nx: FIELD_N, ny: FIELD_N };
    const bandwidth = 40 * frame.gs;
    const make = (l: MapLens) => {
      const pts: FieldPoint[] = shown.map((n) => ({
        x: n.pos2d[0],
        y: n.pos2d[1],
        w: 0.5 + 0.5 * Math.sqrt(Math.max(n.mass, 0)),
        rgb: colors.get(n.key)?.[l] ?? GRAY,
      }));
      const data = colorField(pts, grid, bandwidth);
      const c = document.createElement('canvas');
      c.width = FIELD_N;
      c.height = FIELD_N;
      c.getContext('2d')?.putImageData(new ImageData(data, FIELD_N, FIELD_N), 0, 0);
      return c;
    };
    return { genre: make('genre'), score: make('score'), distortion: make('distortion') };
    // settled stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.nodes, visible, frame, settled, hues]);

  // Isodensity contours over every visible node, and one outline per group.
  const contours = useMemo(() => {
    if (typeof Path2D === 'undefined') return { all: [] as Path2D[], groups: [] as { id: string; color: string; path: Path2D | null }[] };
    const toPath = (coords: number[][][][]) => {
      const p = new Path2D();
      for (const poly of coords)
        for (const ring of poly) {
          ring.forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
          p.closePath();
        }
      return p;
    };
    const shown = payload.nodes.filter((n) => visible.has(n.key));
    const all = shown.length
      ? contourDensity<TasteMapPayloadNode>()
          .x((n) => gridX(n.pos2d[0]))
          .y((n) => gridY(n.pos2d[1]))
          .weight((n) => 0.5 + 0.5 * Math.sqrt(n.mass))
          .size([GRID, GRID])
          .cellSize(4)
          .bandwidth(36)
          .thresholds(9)(shown)
          .map((ct) => toPath(ct.coordinates))
      : [];
    const groups = payload.groups.map((g) => {
      const members = payload.nodes.map((n) => ({ n, w: n.groups[g.id] ?? 0 })).filter((m) => m.w > 0.05);
      if (!members.length) return { id: g.id, color: g.color, path: null };
      const cs = contourDensity<{ n: TasteMapPayloadNode; w: number }>()
        .x((m) => gridX(m.n.pos2d[0]))
        .y((m) => gridY(m.n.pos2d[1]))
        .weight((m) => m.w * (0.5 + 0.5 * Math.sqrt(m.n.mass)))
        .size([GRID, GRID])
        .cellSize(4)
        .bandwidth(42)
        .thresholds(7)(members);
      return { id: g.id, color: g.color, path: cs[1] ? toPath(cs[1].coordinates) : null };
    });
    return { all, groups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.groups, payload.nodes, visible, frame, settled]);

  // Country territories (grid-unit paths) and label geometry (world units).
  const regions = useMemo(() => {
    if (typeof Path2D === 'undefined') return [];
    const cell = (GRID * frame.gs) / REGION_N;
    const grid = { x0: frame.gx0 + cell / 2, y0: frame.gy0 + cell / 2, cell, nx: REGION_N, ny: REGION_N };
    const pts = payload.nodes
      .filter((n) => visible.has(n.key))
      .map((n) => ({ x: n.pos2d[0], y: n.pos2d[1], w: 0.5 + 0.5 * Math.sqrt(Math.max(n.mass, 0)), country: atlas.countryOf.get(n.key) ?? -1 }));
    const fields = regionFields(pts, grid, 48 * frame.gs, atlas.countries.length);
    const scale = GRID / REGION_N;
    return atlas.countries.flatMap((country) => {
      const ms = payload.nodes.filter((n) => visible.has(n.key) && atlas.countryOf.get(n.key) === country.id);
      if (ms.length < 2) return [];
      const f = fields[country.id];
      const [ct] = gridContours().size([REGION_N, REGION_N]).thresholds([0])(Array.from(f));
      const path = new Path2D();
      for (const poly of ct?.coordinates ?? [])
        for (const ring of poly) {
          ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x * scale, y * scale) : path.lineTo(x * scale, y * scale)));
          path.closePath();
        }
      let land = 0;
      for (let i = 0; i < f.length; i++) if (f[i] > 0) land++;
      // Mass-weighted centroid and long axis of the members.
      let sw = 0;
      let mx = 0;
      let my = 0;
      for (const n of ms) {
        sw += n.mass;
        mx += n.mass * n.pos2d[0];
        my += n.mass * n.pos2d[1];
      }
      mx /= sw;
      my /= sw;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const n of ms) {
        const dx = n.pos2d[0] - mx;
        const dy = n.pos2d[1] - my;
        sxx += n.mass * dx * dx;
        syy += n.mass * dy * dy;
        sxy += n.mass * dx * dy;
      }
      let axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (axis > Math.PI / 2) axis -= Math.PI;
      if (axis < -Math.PI / 2) axis += Math.PI;
      return [{ ...country, path, x: mx, y: my, axis: Math.max(-0.45, Math.min(0.45, axis)), area: land * cell * cell }];
    });
    // settled stands in for the in-place position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, payload.nodes, visible, frame, settled]);

  const tree = useMemo(() => spanningTree(payload.neighbors, visible), [payload.neighbors, visible]);

  const compass = useMemo(() => {
    if (!payload.palette?.length) return [];
    // On the view being shown: in the schematic, the directions sounds lie in
    // around you. Raw slots are fine: the fit is a uniform scale, which the
    // gradients (direction, strength per sd, r²) don't see.
    const pts = payload.nodes
      .filter((n) => visible.has(n.key))
      .map((n) => {
        const [x, y] = (sTarget && schematic?.pos.get(n.key)) || n.pos2d;
        return { x, y, w: Math.max(n.mass, 0.3), mix: n.mix };
      });
    return tagGradients(pts, payload.palette)
      .filter((g) => g.r2 >= 0.08)
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.palette, payload.nodes, visible, settled, sTarget, schematic]);

  // ── Geometry helpers (read refs, so they're stable) ──
  const pads = () => {
    const { w, h } = size.current;
    return { padX: Math.min(90, w * 0.14), padY: Math.min(60, h * 0.1) };
  };
  const fitScale = () => {
    const { w, h } = size.current;
    const { padX, padY } = pads();
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
    const now = performance.now();
    let animating = false;

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
      } else animating = true;
    }
    const v = view.current;
    const F = fitScale();
    const { theme } = p;

    const la = lensAnim.current;
    const lensT = la.from === la.to ? 1 : smooth((now - la.t0) / LENS_MS);
    if (lensT < 1) animating = true;
    // 0…1: how far the distortion lens is faded in (its halos and link styles).
    const distA = la.to === 'distortion' ? lensT : la.from === 'distortion' ? 1 - lensT : 0;
    const s = morphAt(now);
    sNow.current = s;
    if (morph.current.s0 !== morph.current.s1 && now - morph.current.t0 < MORPH_MS) animating = true;
    // How much of the true plane's density layers shows.
    const tTrue = 1 - s;
    const honestOf = (key: NodeKey) => p.honesty.byKey.get(key);
    const colorOf = (key: NodeKey): Rgb => {
      const c = colors.get(key);
      if (!c) return GRAY;
      return lensT >= 1 ? c[la.to] : lerpRgb(c[la.from], c[la.to], lensT);
    };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    sky.addColorStop(0, SKY.bg0);
    sky.addColorStop(1, SKY.bg1);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Graticule (a scale, so only to scale).
    const unit = F * v.k;
    const step = niceStep(90 / unit);
    const [wx0, wy1] = toPlaneXY(0, 0, v, F);
    const [wx1, wy0] = toPlaneXY(w, h, v, F);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `${SKY.line}${(0.05 * tTrue).toFixed(3)})`;
    ctx.beginPath();
    for (let x = Math.ceil(wx0 / step) * step; x <= wx1; x += step) {
      const sx = Math.round(toScreen(x, 0, v, F)[0]) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.ceil(wy0 / step) * step; y <= wy1; y += step) {
      const sy = Math.round(toScreen(0, y, v, F)[1]) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // Grid units → screen (y flipped).
    const a = frame.gs * F * v.k;
    const cx = w / 2 + v.tx + (frame.gx0 - frame.mx) * F * v.k;
    const cy = h / 2 + v.ty - (frame.gy0 - frame.my) * F * v.k;
    ctx.save();
    ctx.setTransform(dpr * a, 0, 0, -dpr * a, dpr * cx, dpr * cy);
    if (fields && tTrue > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // Thinner as you zoom in, where the stars should carry the detail.
      const fieldA = 1 / (1 + 0.35 * Math.max(0, v.k - 1));
      if (lensT < 1) {
        ctx.globalAlpha = (1 - lensT) * fieldA * tTrue;
        ctx.drawImage(fields[la.from], 0, 0, GRID, GRID);
      }
      ctx.globalAlpha = lensT * fieldA * tTrue;
      ctx.drawImage(fields[la.to], 0, 0, GRID, GRID);
    }
    // Contours, territories and group outlines fade with the true plane.
    ctx.globalAlpha = tTrue;
    ctx.lineWidth = 1 / a;
    contours.all.forEach((path, i) => {
      ctx.strokeStyle = `${SKY.line}${(0.05 + 0.012 * i).toFixed(3)})`;
      ctx.stroke(path);
    });
    for (const r of regions) {
      const tint: Rgb = r.hue == null ? [205, 218, 255] : oklabToRgb(0.72, 0.12 * Math.cos((r.hue * Math.PI) / 180), 0.12 * Math.sin((r.hue * Math.PI) / 180));
      ctx.fillStyle = rgbCss(tint, 0.05);
      ctx.fill(r.path);
      ctx.lineWidth = 1.1 / a;
      ctx.strokeStyle = rgbCss(tint, 0.3);
      ctx.stroke(r.path);
    }
    ctx.lineWidth = 1.25 / a;
    ctx.setLineDash([5 / a, 4 / a]);
    for (const g of contours.groups) {
      if (!g.path || p.hiddenGroups.has(g.id)) continue;
      ctx.strokeStyle = hexAlpha(g.color, 0.55);
      ctx.stroke(g.path);
    }
    ctx.setLineDash([]);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Schematic: bonds from the nucleus, then each country's disc and orbital shells.
    const sch = p.schematic;
    const px = F * v.k;
    const g = schScale();
    // Schematic geometry in screen space: slots → plane → screen.
    const schScreen = (q: Vec2) => {
      const [x, y] = schToPlane(q, g);
      return toScreen(x, y, v, F);
    };
    const gpx = g * px;
    if (sch && s > 0) {
      ctx.save();
      ctx.globalAlpha = s;
      if (sch.nucleus) {
        const [nx, ny] = schScreen(sch.nucleus);
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = `${SKY.line}0.18)`;
        ctx.beginPath();
        for (const c of sch.countries) {
          const [x, y] = schScreen(c.center);
          const d = Math.hypot(x - nx, y - ny);
          const r = c.radius * gpx;
          if (d <= r + 8) continue;
          ctx.moveTo(nx + ((x - nx) / d) * 8, ny + ((y - ny) / d) * 8);
          ctx.lineTo(x - ((x - nx) / d) * r, y - ((y - ny) / d) * r);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(nx, ny, 5, 0, TAU);
        ctx.strokeStyle = `${SKY.line}0.5)`;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(nx, ny, 1.8, 0, TAU);
        ctx.fillStyle = SKY.ink;
        ctx.fill();
      }
      for (const c of sch.countries) {
        const tint = tintOf(atlas.countries[c.id]?.hue ?? null, 0.72, 0.12);
        const [x, y] = schScreen(c.center);
        ctx.beginPath();
        ctx.arc(x, y, c.radius * gpx, 0, TAU);
        ctx.fillStyle = rgbCss(tint, 0.06);
        ctx.fill();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = rgbCss(tint, 0.34);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgbCss(tint, 0.14);
        for (const r of c.shells) {
          ctx.beginPath();
          ctx.arc(x, y, r * gpx, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // letterSpacing is newer canvas API; skip where it's missing.
    const setSpacing = (s: string) => {
      if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = s;
    };

    const nodes = p.payload.nodes;
    const pos = new Map<NodeKey, [number, number]>();
    for (const n of nodes)
      if (p.visible.has(n.key)) {
        const q = placeAt(n, s, g);
        pos.set(n.key, toScreen(q[0], q[1], v, F));
      }

    const sel = p.selectedKey;
    const related = new Set<NodeKey>();
    if (sel) {
      related.add(sel);
      for (const nb of p.payload.neighbors[sel] ?? []) related.add(nb.key);
    }
    if (p.hoveredKey) related.add(p.hoveredKey);
    const dimOthers = sel != null;
    const focusKey = p.hoveredKey ?? sel;

    // Country names: the map's background lettering, under every star. To
    // scale, along each territory's long axis; in the schematic, level above
    // its disc (a country of one is named by its star's own label).
    const nameA = Math.max(0.3, Math.min(0.62, (3.2 - v.k) / 2.5));
    const regionOf = new Map(regions.map((r) => [r.id, r]));
    const schemOf = new Map((sch?.countries ?? []).map((c) => [c.id, c]));
    const nameBoxes: Box[] = [];
    let names = 0;
    for (const country of atlas.countries) {
      const r = regionOf.get(country.id);
      const sc = schemOf.get(country.id);
      const named = sc && sc.shells.length > 0 ? sc : undefined;
      // Each view's share of this name: both → slide between them, one → fade it.
      const wt = r ? tTrue : 0;
      const ws = named ? s : 0;
      if (wt + ws < 0.02) continue;
      if ((r ? 1 : 0) * tTrue + (named ? 1 : 0) * s >= 0.5) names++;
      const trueAt = r ? toScreen(r.x, r.y, v, F) : null;
      const trueSize = r ? Math.max(11, Math.min(24, Math.sqrt(r.area) * px * 0.085)) : 0;
      const schemSize = named ? Math.max(11, Math.min(20, named.radius * gpx * 0.2)) : 0;
      const schemAt = named ? schScreen([named.center[0], named.center[1] + named.radius]) : null;
      if (schemAt) schemAt[1] -= schemSize * 0.6 + 6;
      let x: number;
      let y: number;
      let rot: number;
      let size: number;
      let fade: number;
      if (r && trueAt && schemAt) {
        x = trueAt[0] + (schemAt[0] - trueAt[0]) * s;
        y = trueAt[1] + (schemAt[1] - trueAt[1]) * s;
        rot = -r.axis * tTrue;
        size = trueSize + (schemSize - trueSize) * s;
        fade = 1;
      } else if (r && trueAt) {
        [x, y] = trueAt;
        rot = -r.axis;
        size = trueSize;
        fade = wt;
      } else {
        [x, y] = schemAt!;
        rot = 0;
        size = schemSize;
        fade = ws;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.font = `italic 600 ${size.toFixed(1)}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
      setSpacing(`${(size * 0.32).toFixed(1)}px`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = country.name.toUpperCase();
      // Level schematic names are kept clear of star labels.
      if (named && s > 0.5) {
        const tw = ctx.measureText(text).width;
        nameBoxes.push({ x: x - tw / 2 - 3, y: y - size * 0.6, w: tw + 6, h: size * 1.2, key: null });
      }
      ctx.globalAlpha = nameA * (dimOthers ? 0.6 : 1) * fade;
      ctx.fillStyle = country.hue == null ? SKY.ink : rgbCss(tintOf(country.hue, 0.86, 0.07));
      ctx.fillText(text, 0, 0);
      setSpacing('0px');
      ctx.restore();
    }

    // Bundled links between countries, bent through the bridge between them.
    // Anchors slide from the territory centroid to the disc center; in the
    // schematic each end stops at its disc's rim.
    const at = new Map<number, { q: [number, number]; trim: number }>();
    for (const country of atlas.countries) {
      const r = regionOf.get(country.id);
      const sc = schemOf.get(country.id);
      if (!r && (s <= 0 || !sc)) continue;
      if (s >= 1 && !sc) continue;
      const sq: Vec2 | null = sc ? schToPlane(sc.center, g) : null;
      const t: Vec2 = r ? [r.x, r.y] : sq!;
      const e = sq ?? t;
      at.set(country.id, {
        q: toScreen(t[0] + (e[0] - t[0]) * s, t[1] + (e[1] - t[1]) * s, v, F),
        trim: sc ? sc.radius * gpx * s : 0,
      });
    }
    if (at.size > 1) {
      const maxW = Math.max(...atlas.links.map((l) => l.w));
      for (const l of atlas.links) {
        const ea = at.get(l.a);
        const eb = at.get(l.b);
        if (!ea || !eb) continue;
        const d = Math.hypot(eb.q[0] - ea.q[0], eb.q[1] - ea.q[1]);
        if (d <= ea.trim + eb.trim + 2) continue;
        const ux = (eb.q[0] - ea.q[0]) / d;
        const uy = (eb.q[1] - ea.q[1]) / d;
        const qa: [number, number] = [ea.q[0] + ux * ea.trim, ea.q[1] + uy * ea.trim];
        const qb: [number, number] = [eb.q[0] - ux * eb.trim, eb.q[1] - uy * eb.trim];
        const via = [...atlas.bridges.values()]
          .filter((b) => b.countries.includes(l.a) && b.countries.includes(l.b) && pos.has(b.key))
          .sort((x, y) => y.score - x.score)[0];
        const mid: [number, number] = [(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2];
        let cx2: number;
        let cy2: number;
        if (via) {
          // Quadratic through the bridge at t = ½.
          const q = pos.get(via.key)!;
          cx2 = 2 * q[0] - mid[0];
          cy2 = 2 * q[1] - mid[1];
        } else {
          cx2 = mid[0] - (qb[1] - qa[1]) * 0.18;
          cy2 = mid[1] + (qb[0] - qa[0]) * 0.18;
        }
        ctx.lineCap = 'round';
        ctx.lineWidth = 1 + 5 * (l.w / maxW);
        ctx.strokeStyle = `${SKY.line}${dimOthers ? 0.04 : 0.09})`;
        ctx.beginPath();
        ctx.moveTo(qa[0], qa[1]);
        ctx.quadraticCurveTo(cx2, cy2, qb[0], qb[1]);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // Constellation lines.
    ctx.lineWidth = 1;
    for (const e of tree) {
      const qa = pos.get(e.a);
      const qb = pos.get(e.b);
      if (!qa || !qb) continue;
      const lit = focusKey != null && (e.a === focusKey || e.b === focusKey);
      ctx.strokeStyle = `${SKY.line}${lit ? 0.5 : dimOthers ? 0.07 : 0.16})`;
      ctx.beginPath();
      ctx.moveTo(qa[0], qa[1]);
      ctx.lineTo(qb[0], qb[1]);
      ctx.stroke();
    }

    // Trails (dashed, chronological).
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = SKY.muted;
    ctx.globalAlpha = 0.75;
    for (const tr of p.payload.trails) {
      const pts = tr.keys.map((k) => pos.get(k)).filter((q): q is [number, number] => !!q);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Links from the selection to its neighbors, drawn outward on select.
    if (sel && pos.has(sel)) {
      const [sx, sy] = pos.get(sel)!;
      const list = p.payload.neighbors[sel] ?? [];
      const base = (now - linkAnim.current.t0) / LINK_MS;
      if (base < 1 + 0.12 * list.length) animating = true;
      const torn = new Set(distA > 0.5 ? honestOf(sel)?.torn ?? [] : []);
      list.forEach((nb, i) => {
        const q = pos.get(nb.key);
        if (!q) return;
        const t = smooth(base - 0.12 * i);
        if (t <= 0) return;
        const ex = sx + (q[0] - sx) * t;
        const ey = sy + (q[1] - sy) * t;
        const grad = ctx.createLinearGradient(sx, sy, q[0], q[1]);
        grad.addColorStop(0, rgbCss(lighten(colorOf(sel), 0.3), 0.9));
        grad.addColorStop(1, rgbCss(lighten(colorOf(nb.key), 0.3), 0.9));
        // Distortion lens: a torn link (really close, drawn far) is dashed in the torn color.
        ctx.strokeStyle = torn.has(nb.key) ? rgbCss(distortionRgb(0, 0.78)) : grad;
        ctx.setLineDash(torn.has(nb.key) ? [5, 4] : []);
        ctx.globalAlpha = 0.25 + 0.6 * nb.sim;
        ctx.lineWidth = 1 + 1.6 * nb.sim;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // Intruders: drawn among the nearest, but not true neighbors.
      if (distA > 0) {
        ctx.setLineDash([1.5, 3]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = SKY.muted;
        ctx.globalAlpha = 0.9 * distA;
        for (const k of honestOf(sel)?.intruders ?? []) {
          const q = pos.get(k);
          if (!q) continue;
          const n = nodes.find((m) => m.key === k);
          ctx.beginPath();
          ctx.arc(q[0], q[1], nodeRadius(n?.mass ?? 1, v.k) + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // Stars, small first so big ones sit on top. Glow is additive.
    const drawOrder = nodes.filter((n) => pos.has(n.key)).sort((x, y) => x.mass - y.mass);
    for (const n of drawOrder) {
      const [x, y] = pos.get(n.key)!;
      const r = nodeRadius(n.mass, v.k);
      if (x < -4 * r || y < -4 * r || x > w + 4 * r || y > h + 4 * r) continue;
      const c = colorOf(n.key);
      const dim = dimOthers && !related.has(n.key);
      const alpha = dim ? 0.28 : 1;
      ctx.globalCompositeOperation = 'lighter';
      // Distortion lens: the less of its neighborhood the plane keeps, the wider
      // and fainter the halo, so torn stars read as out of focus.
      const fuzz = distA * (1 - (honestOf(n.key)?.recall ?? 1));
      const haloR = r * (3.4 + 4.5 * fuzz);
      const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, haloR);
      halo.addColorStop(0, rgbCss(c, (0.42 - 0.12 * fuzz) * alpha));
      halo.addColorStop(1, rgbCss(c, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      const bridge = atlas.bridges.has(n.key);
      // A bridge is a diamond with an outline, so it reads as a crossing, not a star.
      const shape = (rr: number) => {
        ctx.beginPath();
        if (!bridge) return ctx.arc(x, y, rr, 0, Math.PI * 2);
        const d = rr * 1.3;
        ctx.moveTo(x, y - d);
        ctx.lineTo(x + d, y);
        ctx.lineTo(x, y + d);
        ctx.lineTo(x - d, y);
        ctx.closePath();
      };
      shape(r);
      ctx.fillStyle = rgbCss(c);
      ctx.fill();
      shape(Math.max(1, r * 0.36));
      ctx.fillStyle = rgbCss(lighten(c, 0.75), 0.9);
      ctx.fill();
      if (bridge) {
        shape(r + 4);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = rgbCss(lighten(c, 0.5), 0.75);
        ctx.stroke();
      }
      if (n.key === sel || n.key === p.hoveredKey) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.lineWidth = n.key === sel ? 1.8 : 1.1;
        ctx.strokeStyle = SKY.ink;
        ctx.stroke();
      }
      const pin = p.pins.get(n.key);
      if (pin) drawPinBadge(ctx, x + r * 0.72, y - r * 0.72, pin.softZ);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Add-artist ghost: dashed lines to its anchors, then a translucent dashed circle.
    const gh = p.ghost;
    const ghostWorld = gh ? ghostAt(gh, s) : null;
    const ghostXY = ghostWorld ? toScreen(ghostWorld[0], ghostWorld[1], v, F) : null;
    const ghostR = nodeRadius(2, v.k) + 2;
    if (gh && ghostXY) {
      const [gx, gy] = ghostXY;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = SKY.ink;
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
      ctx.fillStyle = SKY.ink;
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

    // Labels — greedy placement by priority, never under the stage's overlay
    // controls (fullscreen top left, lens switch top right, legend bottom right,
    // compass bottom left).
    const boxes: Box[] = [
      { x: 0, y: 0, w: 340, h: 46, key: null },
      ...nameBoxes,
      { x: w - 250, y: 0, w: 250, h: 46, key: null },
      { x: w - 345, y: h - 64, w: 345, h: 64, key: null },
      ...(compass.length && w >= 320 ? [{ x: 0, y: h - 116, w: 230, h: 116, key: null }] : []),
    ];
    const overlaps = (b: Box) =>
      boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const measure = (font: string, text: string, spacing: string) => {
      const key = `${font}|${spacing}|${text}`;
      let m = measureCache.current.get(key);
      if (m == null) {
        ctx.font = font;
        setSpacing(spacing);
        m = ctx.measureText(text).width;
        setSpacing('0px');
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
      spacing = '0px',
    ) => {
      const font = `${weight} ${sizePx}px ${fontFamily}`;
      const tw = measure(font, text, spacing);
      const b: Box = { x: x - tw / 2 - 3, y: y - sizePx - 1, w: tw + 6, h: sizePx + 3, key };
      if (b.x + b.w < 0 || b.x > w || b.y + b.h < 0 || b.y > h) return;
      if (!force && overlaps(b)) return;
      boxes.push(b);
      ctx.font = font;
      setSpacing(spacing);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = alpha;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 9, 14, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
      setSpacing('0px');
    };

    const prio = (n: TasteMapPayloadNode) =>
      n.key === sel ? 0 : n.key === p.hoveredKey ? 1 : related.has(n.key) ? 2 : 3;
    const labelOrder = nodes
      .filter((n) => pos.has(n.key))
      .sort((x, y) => prio(x) - prio(y) || (rank.get(x.key) ?? 0) - (rank.get(y.key) ?? 0));

    if (gh && ghostXY) {
      placeText(gh.label, ghostXY[0], ghostXY[1] - ghostR - 4, 13, 800, SKY.ink, 1, null, true);
      placeText(gh.tag.toUpperCase(), ghostXY[0], ghostXY[1] + ghostR + 12, 9.5, 800, SKY.muted, 1, null, true);
    }
    if (sch?.nucleus && s > 0.3) {
      const [nx, ny] = schScreen(sch.nucleus);
      placeText(p.nucleusLabel, nx, ny - 10, 9.5, 800, SKY.muted, s, null, true, '2px');
    }

    let groupLabelsDone = false;
    const drawGroupLabels = () => {
      groupLabelsDone = true;
      // Countries name the map once there are two; group names would repeat them.
      if (names >= 2) return;
      // Far zoom: one constellation name per group, at its members' weighted center.
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
        placeText(g.name.toUpperCase(), sx / sw, top - 22, 11.5, 700, hexAlpha(g.color, 1), 0.9 * ga, null, false, '2.5px');
      }
    };

    for (const n of labelOrder) {
      const pr = prio(n);
      if (pr === 3 && !groupLabelsDone) drawGroupLabels();
      const [x, y] = pos.get(n.key)!;
      const r = nodeRadius(n.mass, v.k);
      const sizePx = Math.round(Math.min(15, 9.5 + 1.2 * Math.sqrt(n.mass)) * Math.min(1.15, 0.9 + 0.1 * v.k));
      const text = n.eraLabel ? `${n.label} · ${n.eraLabel}` : n.label;
      const dim = dimOthers && !related.has(n.key);
      placeText(text, x, y - r - 5, sizePx, pr <= 1 ? 750 : 550, pr <= 1 ? SKY.ink : 'rgb(205, 211, 226)', dim ? 0.35 : 1, n.key, pr <= 1);
    }
    if (!groupLabelsDone) drawGroupLabels();
    labelBoxes.current = boxes;

    // Compass: which way each defining tag grows across the map.
    if (compass.length && w >= 320) {
      const R = 38;
      const ox = 16 + R + 6;
      const oy = h - 16 - R - 6;
      ctx.beginPath();
      ctx.arc(ox, oy, R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 9, 14, 0.55)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${SKY.line}0.14)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox - R, oy);
      ctx.lineTo(ox + R, oy);
      ctx.moveTo(ox, oy - R);
      ctx.lineTo(ox, oy + R);
      ctx.strokeStyle = `${SKY.line}0.06)`;
      ctx.stroke();
      // Arrows in the dial; their names in a key beside it (tips would clip and collide).
      const arrow = (x0: number, y0: number, x1: number, y1: number, head: number) => {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const ang = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(ang - 0.42), y1 - head * Math.sin(ang - 0.42));
        ctx.lineTo(x1 - head * Math.cos(ang + 0.42), y1 - head * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
      };
      ctx.font = MATH_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const rowH = 15;
      const ky0 = oy - ((compass.length - 1) * rowH) / 2;
      compass.forEach((g, i) => {
        const len = R * (0.45 + 0.55 * Math.min(1, g.strength / 0.25));
        const col = rgbCss(oklabToRgb(0.8, 0.15 * Math.cos((g.hue * Math.PI) / 180), 0.15 * Math.sin((g.hue * Math.PI) / 180)));
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, g.r2 * 2);
        arrow(ox, oy, ox + g.dx * len, oy - g.dy * len, 6);
        const kx = ox + R + 12;
        const ky = ky0 + i * rowH;
        ctx.lineWidth = 1.3;
        arrow(kx + 6 - g.dx * 6, ky + g.dy * 6, kx + 6 + g.dx * 6, ky - g.dy * 6, 4);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 9, 14, 0.85)';
        ctx.strokeText(g.label, kx + 18, ky);
        ctx.fillText(g.label, kx + 18, ky);
      });
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }

    if (animating) raf.current = requestAnimationFrame(() => drawRef.current());
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
    const n = propsRef.current.payload.nodes.find((m) => m.key === focus.key);
    const q = n ? placeAt(n, sTarget) : gh?.key === focus.key ? ghostAt(gh, sTarget) : null;
    if (!q || size.current.w === 0) return;
    const F = fitScale();
    const k = Math.max(view.current.k, 1.8);
    goal.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
    requestDrawRef.current();
    // fitScale reads refs; frame is the only real dependency besides the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, frame]);

  // Switching scales re-frames while the stars morph: on the selection, else the whole map.
  const shownScale = useRef(sTarget);
  useEffect(() => {
    if (shownScale.current === sTarget) return;
    shownScale.current = sTarget;
    const sel = propsRef.current.payload.nodes.find((m) => m.key === propsRef.current.selectedKey);
    if (sel && size.current.w > 0) {
      const F = fitScale();
      const k = Math.max(view.current.k, 1.8);
      const q = placeAt(sel, sTarget);
      goal.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
    } else goal.current = { k: 1, tx: 0, ty: 0 };
    requestDrawRef.current();
    // fitScale / placeAt read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sTarget, frame]);

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
      // The schematic stretches to the box it is fitted into (see schScale).
      if (w > 0 && h > 0) {
        const { padX, padY } = pads();
        propsRef.current.onStageAspect(Math.round(((w - 2 * padX) / Math.max(1, h - 2 * padY)) * 10) / 10);
      }
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
          const q = placeAt(sel, sTarget);
          view.current = { k, tx: -(q[0] - frame.mx) * F * k, ty: (q[1] - frame.my) * F * k };
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
        const q = placeAt(n, sNow.current);
        const [sx, sy] = toScreen(q[0], q[1], view.current, F);
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
        const hit = p.editable && sNow.current === 0 ? hitTest(q.x, q.y) : null;
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
    <div ref={wrapRef} className="absolute inset-0" style={{ background: SKY.bg }}>
      <canvas ref={canvasRef} className="block touch-none select-none" style={{ cursor: 'grab' }} aria-label="Taste map (2D)" role="img" />
    </div>
  );
}
