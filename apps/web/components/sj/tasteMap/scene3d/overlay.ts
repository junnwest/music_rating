/**
 * The 3D view's two 2D canvases, drawn every frame from the model's screen
 * projections:
 *
 * - back (under the WebGL stars, which add light onto it; the sky gradient is
 *   the stage's CSS background): country names as faint spaced capitals at each country's centroid (as in
 *   2D), era trails, the selection's links drawn outward, the orbit refocus's
 *   similarity shells, and the Add-artist preview's anchor lines.
 * - front: rings (selection, hover, ghosts, preview), pin badges, labels.
 *
 * Labels are level-of-detail: the selection, the hovered star, the
 * selection's neighbors and stars near the cursor always get one; the rest
 * compete by mass and depth for a budget that grows as you zoom in, placed
 * greedily (lib/tasteMap/scene3d placeLabels) off the stage chrome and off
 * other stars, fading in and out.
 */
import { oklabToRgb, rgbCss } from '../../../../lib/tasteMap/color';
import { RINGS, simRadius } from '../../../../lib/tasteMap/focus';
import type { Atlas } from '../../../../lib/tasteMap/regions';
import { labelBudget, placeLabels, slotBox, type Box, type LabelCandidate } from '../../../../lib/tasteMap/scene3d';
import type { NodeKey, TasteMapPayload } from '../../../../lib/tasteMap/types';
import type { SceneGhost } from '../TasteMapView';
import { cssOf, ppuAt, project, type Model } from './model';
import { approach, depthFade, MATH_FONT, SKY, smooth } from './sky';

const TAU = Math.PI * 2;
const LINK_MS = 650;

export interface PaintInput {
  payload: TasteMapPayload;
  atlas: Atlas;
  hiddenGroups: Set<string>;
  selectedKey: NodeKey | null;
  hoveredKey: NodeKey | null;
  ghost: SceneGhost | null;
  /** Ghost preview position in scene coordinates. */
  ghostAt: [number, number, number] | null;
  pins: Map<NodeKey, { softZ: boolean }>;
  font: string;
  lang: 'en' | 'ko';
  /** Stage chrome to keep labels off (CSS px boxes). */
  reserved: Box[];
  /** Neighbors of the selection: key → similarity. */
  neighborSim: Map<NodeKey, number>;
}

const pt = [0, 0, 0];

function setSpacing(ctx: CanvasRenderingContext2D, s: string) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = s;
}

const tintOf = (hue: number | null, L: number, C: number) =>
  hue == null ? SKY.ink : rgbCss(oklabToRgb(L, C * Math.cos((hue * Math.PI) / 180), C * Math.sin((hue * Math.PI) / 180)));

/** How much of the far-field lettering to show: 1 at the home framing, gone when zoomed well in. */
export const farField = (m: Model) => smooth((m.focusDist / m.homeDist - 0.32) / 0.3);

// ── Back ─────────────────────────────────────────────────────────────────────

export function paintBack(ctx: CanvasRenderingContext2D, m: Model, p: PaintInput, now: number) {
  // The sky gradient itself is the stage's CSS background (SKY_CSS): free to draw.
  ctx.clearRect(0, 0, m.w, m.h);

  const sel = p.selectedKey != null ? m.index.get(p.selectedKey) : undefined;
  paintRegionNames(ctx, m, p);

  // Era trails: dashed, chronological.
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = SKY.muted;
  for (const tr of p.payload.trails) {
    const idx = tr.keys.map((k) => m.index.get(k)).filter((i): i is number => i != null && !!m.show[i] && !!m.front[i]);
    if (idx.length < 2) continue;
    ctx.globalAlpha = 0.6 * Math.min(...idx.map((i) => m.alpha[i])) * (1 - 0.7 * m.orbitT);
    ctx.beginPath();
    idx.forEach((i, k) => (k === 0 ? ctx.moveTo(m.sx[i], m.sy[i]) : ctx.lineTo(m.sx[i], m.sy[i])));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Orbit refocus: similarity shells around the selection (sphere outlines).
  if (sel != null && m.orbit && m.orbitT > 0.01 && m.front[sel]) {
    const cx = m.sx[sel];
    const cy = m.sy[sel];
    const ppu = ppuAt(m, m.depth[sel]);
    ctx.font = `italic 11px ${MATH_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    RINGS.forEach((s, k) => {
      const r = simRadius(s) * m.orbit!.R * ppu * smooth(m.orbitT * 1.2 - k * 0.06);
      if (r < 6) return;
      const a = m.orbitT * (0.3 - k * 0.035);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.setLineDash([2, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${SKY.line}${a.toFixed(3)})`;
      ctx.stroke();
      ctx.setLineDash([]);
      // Faint inner wash so nested shells read as volumes.
      const tx = cx + r * Math.cos(-0.72);
      const ty = cy + r * Math.sin(-0.72);
      ctx.globalAlpha = Math.min(1, m.orbitT * 0.85);
      ctx.fillStyle = 'rgba(8, 9, 14, 0.75)';
      const label = s.toFixed(1);
      const tw = ctx.measureText(label).width;
      ctx.fillRect(tx + 2, ty - 7, tw + 6, 14);
      ctx.fillStyle = SKY.muted;
      ctx.fillText(label, tx + 5, ty);
      ctx.globalAlpha = 1;
    });
    ctx.textBaseline = 'alphabetic';
  }

  // The selection's neighbor links, drawn outward on select (3b1b-style).
  if (sel != null && m.show[sel] && m.front[sel]) {
    const list = p.payload.neighbors[p.selectedKey!] ?? [];
    const base = (now - m.selAt) / LINK_MS;
    if (base < 1 + 0.12 * list.length) m.moving = true;
    list.forEach((nb, k) => {
      const j = m.index.get(nb.key);
      if (j == null || !m.show[j] || !m.front[j]) return;
      const t = smooth(base - 0.12 * k);
      if (t <= 0) return;
      const x0 = m.sx[sel];
      const y0 = m.sy[sel];
      const x1 = x0 + (m.sx[j] - x0) * t;
      const y1 = y0 + (m.sy[j] - y0) * t;
      const grad = ctx.createLinearGradient(x0, y0, m.sx[j], m.sy[j]);
      grad.addColorStop(0, cssOf(m.col, sel, 0.3, 0.95));
      grad.addColorStop(1, cssOf(m.col, j, 0.3, 0.95));
      ctx.strokeStyle = grad;
      ctx.globalAlpha = (0.25 + 0.65 * Math.min(1, nb.sim / 0.7)) * depthFade(m.depth[j], m.focusDist);
      ctx.lineWidth = 1 + 1.6 * nb.sim;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  // Add-artist preview: dashed lines to its anchors.
  if (p.ghost && p.ghostAt) {
    project(m, p.ghostAt[0], p.ghostAt[1], p.ghostAt[2], pt);
    if (pt[2] > 0) {
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = SKY.ink;
      ctx.globalAlpha = 0.5;
      for (const k of p.ghost.anchors) {
        const j = m.index.get(k);
        if (j == null || !m.show[j] || !m.front[j]) continue;
        ctx.beginPath();
        ctx.moveTo(pt[0], pt[1]);
        ctx.lineTo(m.sx[j], m.sy[j]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }
}

/** Country names (or group names when the map has fewer than two countries) at member centroids. */
function paintRegionNames(ctx: CanvasRenderingContext2D, m: Model, p: PaintInput) {
  const far = farField(m) * (1 - m.orbitT);
  if (far <= 0.02) return;
  const dim = p.selectedKey ? 0.4 : 1;
  const regions: { name: string; color: string; members: { i: number; w: number }[] }[] = [];
  if (p.atlas.countries.length >= 2) {
    // The heaviest few only, so a big map isn't papered with captions.
    const cap = Math.round(Math.min(8, Math.max(3, (m.w * m.h) / 60000)));
    const seen = new Set<string>();
    for (const c of [...p.atlas.countries].sort((a, b) => b.mass - a.mass)) {
      if (regions.length >= cap || seen.has(c.name)) continue;
      const members = c.members
        .map((k) => m.index.get(k))
        .filter((i): i is number => i != null)
        .map((i) => ({ i, w: 0.5 + Math.sqrt(m.nodes[i].mass) }));
      if (members.length < 2) continue;
      seen.add(c.name);
      regions.push({ name: c.name, color: tintOf(c.hue, 0.86, 0.07), members });
    }
  } else {
    for (const g of p.payload.groups) {
      if (p.hiddenGroups.has(g.id)) continue;
      const members: { i: number; w: number }[] = [];
      m.nodes.forEach((n, i) => {
        const wt = n.groups[g.id] ?? 0;
        if (wt >= 0.5) members.push({ i, w: wt * (0.5 + Math.sqrt(n.mass)) });
      });
      regions.push({ name: g.name, color: g.color, members });
    }
  }
  const placed: Box[] = [];
  m.regionBoxes = placed;
  for (const r of regions) {
    // A caption under the constellation: centered on the members' centroid,
    // just below the lowest of them on screen.
    let sw = 0;
    let x = 0;
    let bottom = -Infinity;
    let spread = 0;
    let cnt = 0;
    let zs = 0;
    for (const { i, w } of r.members) {
      if (!m.show[i] || m.ghost[i] || !m.front[i]) continue;
      x += m.sx[i] * w;
      zs += m.depth[i] * w;
      sw += w;
      bottom = Math.max(bottom, m.sy[i] + m.rpx[i]);
    }
    if (sw === 0) continue;
    let cx = x / sw;
    let cy = 0;
    for (const { i, w } of r.members) {
      if (!m.show[i] || m.ghost[i] || !m.front[i]) continue;
      cy += m.sy[i] * w;
    }
    cy /= sw;
    for (const { i } of r.members) {
      if (!m.show[i] || m.ghost[i] || !m.front[i]) continue;
      spread += (m.sx[i] - cx) ** 2 + (m.sy[i] - cy) ** 2;
      cnt++;
    }
    const rms = Math.sqrt(spread / Math.max(1, cnt));
    const size = Math.max(10.5, Math.min(18, 9.5 + rms * 0.07));
    ctx.font = `italic 600 ${size.toFixed(1)}px ${MATH_FONT}`;
    setSpacing(ctx, `${(size * 0.3).toFixed(1)}px`);
    const text = r.name.toUpperCase();
    const tw = ctx.measureText(text).width;
    // Keep the caption on the stage (it may sit off its centroid near an edge).
    const cx0 = cx;
    cx = Math.min(m.w - 8 - tw / 2, Math.max(8 + tw / 2, cx));
    if (Math.abs(cx - cx0) > tw * 0.6) {
      setSpacing(ctx, '0px');
      continue;
    }
    // Under the constellation, else above it; never over another caption, and
    // preferably not over stars (a caption that can't avoid them goes fainter).
    let top = Infinity;
    for (const { i } of r.members) if (m.show[i] && !m.ghost[i] && m.front[i]) top = Math.min(top, m.sy[i] - m.rpx[i]);
    const clash = (b: Box) => placed.some((o) => b.x < o.x + o.w + 10 && b.x + b.w + 10 > o.x && b.y < o.y + o.h + 4 && b.y + b.h + 4 > o.y);
    const onStars = (b: Box) => {
      for (let i = 0; i < m.n; i++) {
        if (!m.show[i] || !m.front[i] || m.alpha[i] < 0.2) continue;
        const r = m.rpx[i] + 2;
        if (m.sx[i] > b.x - r && m.sx[i] < b.x + b.w + r && m.sy[i] > b.y - r && m.sy[i] < b.y + b.h + r) return true;
      }
      return false;
    };
    const tries = [bottom + 12, bottom + 12 + size + 6, top - 12 - size, bottom + 12 + 2 * (size + 6)];
    const fits = (y: number) => y > 4 && y + size < m.h - 4;
    let box: Box | null = null;
    let faint = false;
    for (const y of tries) {
      const b = { x: cx - tw / 2, y, w: tw, h: size };
      if (fits(y) && !clash(b) && !onStars(b)) {
        box = b;
        break;
      }
    }
    if (!box) {
      for (const y of tries) {
        const b = { x: cx - tw / 2, y, w: tw, h: size };
        if (fits(y) && !clash(b)) {
          box = b;
          faint = true;
          break;
        }
      }
    }
    if (!box) {
      setSpacing(ctx, '0px');
      continue;
    }
    placed.push(box);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.62 * far * dim * depthFade(zs / sw, m.focusDist) * (faint ? 0.5 : 1);
    ctx.fillStyle = r.color;
    ctx.fillText(text, cx, box.y);
    setSpacing(ctx, '0px');
  }
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
}

// ── Front ────────────────────────────────────────────────────────────────────

/** A small push-pin at a star's upper right: filled = full pin, hollow = 2D pin (depth free). Same as Map2D. */
function pinBadge(ctx: CanvasRenderingContext2D, x: number, y: number, soft: boolean, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 3.2, y - 3.2);
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = SKY.bg1;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = SKY.ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 4.4, y - 4.4, 3.1, 0, TAU);
  ctx.fillStyle = soft ? SKY.bg1 : SKY.ink;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = soft ? SKY.ink : SKY.bg1;
  ctx.stroke();
  ctx.restore();
}

const measureCache = new Map<string, number>();
function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let v = measureCache.get(key);
  if (v == null) {
    ctx.font = font;
    v = ctx.measureText(text).width;
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, v);
  }
  return v;
}

const COPY = {
  en: { albums: (n: number) => `${n} ${n === 1 ? 'album' : 'albums'}`, preview: 'preview', unplaced: 'unplaced' },
  ko: { albums: (n: number) => `앨범 ${n}장`, preview: '미리보기', unplaced: '자리 미정' },
};

export function paintFront(ctx: CanvasRenderingContext2D, m: Model, p: PaintInput, dt: number) {
  const { w, h } = m;
  ctx.clearRect(0, 0, w, h);
  const copy = COPY[p.lang];
  const sel = p.selectedKey != null ? m.index.get(p.selectedKey) ?? -1 : -1;
  const hov = p.hoveredKey != null ? m.index.get(p.hoveredKey) ?? -1 : -1;

  // Rings: ghosts (dashed, faint), hover, selection.
  for (let i = 0; i < m.n; i++) {
    if (!m.show[i] || !m.front[i] || m.alpha[i] < 0.02) continue;
    const x = m.sx[i];
    const y = m.sy[i];
    const r = m.rpx[i];
    if (m.ghost[i]) {
      ctx.setLineDash([2.5, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = SKY.ink;
      ctx.globalAlpha = 0.45 * m.alpha[i] * depthFade(m.depth[i], m.focusDist);
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (i === sel || i === hov) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = i === sel ? 1.7 : 1.1;
      ctx.strokeStyle = SKY.ink;
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, TAU);
      ctx.stroke();
    }
    const pin = p.pins.get(m.nodes[i].key);
    if (pin) pinBadge(ctx, x + r * 0.72, y - r * 0.72, pin.softZ, Math.min(1, m.alpha[i] * 1.2));
  }
  ctx.globalAlpha = 1;

  const reserved = [...p.reserved, ...m.regionBoxes];

  // Add-artist preview: a hollow dashed star with its name and a tag.
  if (p.ghost && p.ghostAt) {
    project(m, p.ghostAt[0], p.ghostAt[1], p.ghostAt[2], pt);
    if (pt[2] > 0) {
      const r = 9;
      ctx.fillStyle = 'rgba(234, 237, 245, 0.12)';
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, TAU);
      ctx.fill();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = SKY.ink;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      text(ctx, p.ghost.label, pt[0], pt[1] - r - 6, `800 13px ${p.font}`, SKY.ink, 1);
      text(ctx, p.ghost.tag.toUpperCase(), pt[0], pt[1] + r + 14, `800 9.5px ${p.font}`, SKY.muted, 1, '1.5px');
      reserved.push({ x: pt[0] - 70, y: pt[1] - r - 22, w: 140, h: 2 * r + 40 });
    }
  }

  // ── Labels ──
  const zoom = m.homeDist / Math.max(1e-3, m.focusDist);
  const budget = sel >= 0 ? 0 : labelBudget(w * h, zoom);
  const cands: LabelCandidate[] = [];
  const lines: Map<number, { name: string; sub: string | null; size: number; weight: number }> = new Map();
  const stars: number[] = [];
  for (let i = 0; i < m.n; i++) {
    if (!m.show[i] || !m.front[i] || m.alpha[i] < 0.05) continue;
    const x = m.sx[i];
    const y = m.sy[i];
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
    stars.push(x, y, m.rpx[i] + 2);
    const rel = m.rel[i];
    const prox = m.prox[i];
    const ghost = !!m.ghost[i];
    const force = rel === 2;
    const reveal = prox > 0.45;
    if (!force && rel !== 1 && !reveal && (ghost || sel >= 0)) continue;
    const n = m.nodes[i];
    const df = depthFade(m.depth[i], m.focusDist);
    let prio: number;
    if (i === sel) prio = 1e9;
    else if (i === hov) prio = 1e8;
    else if (rel === 1) prio = 1e6 + (p.neighborSim.get(n.key) ?? 0) * 1e3;
    else if (reveal) prio = 1e5 + prox * 1e3;
    else prio = (0.35 + 0.65 * m.importance[i]) * df + (m.labelA[i] > 0.5 ? 0.3 : 0) + 0.15 * prox;
    const size = force ? 13.5 : Math.min(13, 10.5 + 0.9 * Math.sqrt(n.mass)) * (0.92 + 0.12 * df);
    const weight = force ? 750 : rel === 1 || reveal ? 650 : 560;
    const name = n.eraLabel && !force ? `${n.label} · ${n.eraLabel}` : n.label;
    let sub: string | null = null;
    if (force) {
      const bits = [n.eraLabel, n.avgScore != null ? `★ ${n.avgScore.toFixed(1)}` : null, copy.albums(n.mass), ghost ? copy.unplaced : null];
      sub = bits.filter(Boolean).join(' · ');
    }
    const font = `${weight} ${size.toFixed(1)}px ${p.font}`;
    let tw = measure(ctx, font, name);
    const subFont = `600 10.5px ${p.font}`;
    if (sub) tw = Math.max(tw, measure(ctx, subFont, sub));
    const bh = size + 3 + (sub ? 13 : 0);
    lines.set(i, { name, sub, size, weight });
    cands.push({
      i,
      prio,
      x,
      y,
      r: m.rpx[i] + (force ? 5 : 1),
      w: tw + 6,
      h: bh,
      force,
      optional: !force && rel !== 1 && !reveal,
      prev: m.labelSlot[i],
    });
  }
  const chosen = placeLabels(cands, reserved, { w, h }, budget, stars);
  const candOf = new Map(cands.map((c) => [c.i, c]));
  const fade = approach(dt, 12);
  const boxes: number[] = [];
  for (let i = 0; i < m.n; i++) {
    const slot = chosen.get(i);
    const goal = slot != null ? 1 : 0;
    if (slot != null) m.labelSlot[i] = slot;
    const a0 = m.labelA[i];
    m.labelA[i] = m.rel[i] === 2 && goal ? 1 : a0 + (goal - a0) * fade;
    if (Math.abs(m.labelA[i] - goal) > 0.01) m.moving = true;
    if (m.labelA[i] < 0.02 || !m.show[i] || !m.front[i]) {
      if (goal === 0 && m.labelA[i] < 0.02) m.labelSlot[i] = -1;
      continue;
    }
    const L = lines.get(i);
    if (!L) continue;
    const c = candOf.get(i);
    if (!c) continue;
    const b = slotBox(c, Math.max(0, m.labelSlot[i]));
    const dimmed = sel >= 0 && m.rel[i] === 0 ? 0.55 : 1;
    const alpha = m.labelA[i] * Math.min(1, m.alpha[i] * 1.6) * dimmed * (m.rel[i] ? 1 : 0.55 + 0.45 * depthFade(m.depth[i], m.focusDist));
    const cx = b.x + b.w / 2;
    const color = m.rel[i] === 2 ? SKY.ink : m.ghost[i] ? SKY.muted : SKY.label;
    text(ctx, L.name, cx, b.y + L.size, `${L.weight} ${L.size.toFixed(1)}px ${p.font}`, color, alpha);
    if (L.sub) text(ctx, L.sub, cx, b.y + L.size + 13, `600 10.5px ${p.font}`, SKY.muted, alpha);
    boxes.push(b.x, b.y, b.w, b.h, i);
  }
  m.labelBoxes = boxes;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, alpha: number, spacing = '0px') {
  ctx.font = font;
  setSpacing(ctx, spacing);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = SKY.halo;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
  setSpacing(ctx, '0px');
}
